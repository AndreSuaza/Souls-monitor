import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AlertItem, MetricsSnapshot } from "./types.js";

export type ServiceId = "app-souls" | "openclaw" | "souls-monitor" | "souls-simulador";
export type UserAgentType = "real" | "known_bot" | "suspicious";

export interface HttpRollupInput {
  bucket: string;
  service: ServiceId;
  route: string;
  statusCode: number;
  method: string;
  bytes: number;
  userAgentType: UserAgentType;
  userAgent: string;
  requests: number;
}

export interface AlertInput {
  timestamp: string;
  service: ServiceId;
  severity: AlertItem["severity"];
  title: string;
  message: string;
}

export interface ErrorsResponse {
  range: string;
  service: string;
  severity: string;
  totalRequests: number;
  totalBytes: number;
  statusGroups: Record<"2xx" | "3xx" | "4xx" | "5xx", number>;
  errorRate: number;
  topErrorEndpoints: Array<{ route: string; errors: number; error4xx: number; error5xx: number; severity: "warn" | "crit" }>;
  matrix: Array<{ service: ServiceId; buckets: Array<{ bucket: string; status: "ok" | "warn" | "crit" | "idle" }> }>;
}

export interface BotsResponse {
  range: string;
  type: string;
  search: string;
  totalRequests: number;
  composition: Array<{ type: "real" | "known_bot" | "suspicious"; label: string; requests: number; percent: number }>;
  agents: Array<{ userAgent: string; type: "bot" | "suspicious"; requests: number; lastSeen: string; action: "Permitir" | "Revisar" | "Bloquear" }>;
}

export interface AlertsResponse {
  range: string;
  service: string;
  severity: string;
  alerts: Array<{ timestamp: string; service: ServiceId; severity: AlertItem["severity"]; title: string; message: string }>;
}

const allowedRanges: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const serviceIds: ServiceId[] = ["app-souls", "openclaw", "souls-monitor", "souls-simulador"];

let connection: Database.Database | null = null;

export function openMonitorDb(sqlitePath: string): Database.Database {
  if (connection) return connection;
  mkdirSync(path.dirname(sqlitePath), { recursive: true });
  connection = new Database(sqlitePath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("synchronous = NORMAL");
  connection.pragma("busy_timeout = 5000");
  initSchema(connection);
  return connection;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS http_rollups (
      bucket TEXT NOT NULL,
      service TEXT NOT NULL,
      route TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      method TEXT NOT NULL,
      user_agent_type TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      requests INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      PRIMARY KEY (bucket, service, route, status_code, method, user_agent_type, user_agent)
    );

    CREATE INDEX IF NOT EXISTS idx_http_rollups_bucket ON http_rollups(bucket);
    CREATE INDEX IF NOT EXISTS idx_http_rollups_service ON http_rollups(service);
    CREATE INDEX IF NOT EXISTS idx_http_rollups_status ON http_rollups(status_code);
    CREATE INDEX IF NOT EXISTS idx_http_rollups_ua_type ON http_rollups(user_agent_type);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      service TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_service ON alerts(service);
    CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

    CREATE TABLE IF NOT EXISTS host_snapshots (
      timestamp TEXT PRIMARY KEY,
      cpu_percent REAL,
      memory_used_percent REAL,
      disk_used_percent REAL
    );
  `);
}

export function saveMetricsHistory(db: Database.Database, snapshot: MetricsSnapshot, rollups: HttpRollupInput[]) {
  const insertRollup = db.prepare(`
    INSERT OR REPLACE INTO http_rollups (
      bucket, service, route, status_code, method, user_agent_type, user_agent, requests, bytes
    ) VALUES (
      @bucket, @service, @route, @statusCode, @method, @userAgentType, @userAgent, @requests, @bytes
    )
  `);
  const insertAlert = db.prepare(`
    INSERT INTO alerts (timestamp, service, severity, title, message)
    VALUES (@timestamp, @service, @severity, @title, @message)
  `);
  const insertHost = db.prepare(`
    INSERT OR REPLACE INTO host_snapshots (timestamp, cpu_percent, memory_used_percent, disk_used_percent)
    VALUES (@timestamp, @cpuPercent, @memoryUsedPercent, @diskUsedPercent)
  `);

  const transaction = db.transaction(() => {
    for (const rollup of rollups) insertRollup.run(rollup);
    for (const alert of buildAlertInputs(snapshot)) insertAlert.run(alert);
    insertHost.run({
      timestamp: snapshot.host.generatedAt,
      cpuPercent: snapshot.host.cpuPercent ?? null,
      memoryUsedPercent: snapshot.host.memory.usedPercent,
      diskUsedPercent: snapshot.host.disks[0]?.usedPercent ?? null,
    });
    cleanupHistory(db);
  });

  transaction();
}

export function queryErrors(db: Database.Database, params: URLSearchParams): ErrorsResponse {
  const range = normalizeRange(params.get("range"));
  const service = normalizeService(params.get("service"));
  const severity = normalizeSeverityFilter(params.get("severity"));
  const since = sinceIso(range);
  const filters = buildHttpFilters({ since, service, severity });

  const groupRows = db.prepare(`
    SELECT status_code AS statusCode, SUM(requests) AS requests, SUM(bytes) AS bytes
    FROM http_rollups
    ${filters.where}
    GROUP BY status_code
  `).all(filters.values) as Array<{ statusCode: number; requests: number; bytes: number }>;

  const statusGroups = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  let totalRequests = 0;
  let totalBytes = 0;
  for (const row of groupRows) {
    const key = `${Math.floor(row.statusCode / 100)}xx` as keyof typeof statusGroups;
    if (key in statusGroups) statusGroups[key] += Number(row.requests || 0);
    totalRequests += Number(row.requests || 0);
    totalBytes += Number(row.bytes || 0);
  }

  const endpointRows = db.prepare(`
    SELECT route,
      SUM(CASE WHEN status_code BETWEEN 400 AND 499 THEN requests ELSE 0 END) AS error4xx,
      SUM(CASE WHEN status_code >= 500 THEN requests ELSE 0 END) AS error5xx
    FROM http_rollups
    ${filters.where}
    GROUP BY route
    HAVING error4xx + error5xx > 0
    ORDER BY error5xx DESC, error4xx DESC
    LIMIT 5
  `).all(filters.values) as Array<{ route: string; error4xx: number; error5xx: number }>;

  return {
    range,
    service,
    severity,
    totalRequests,
    totalBytes,
    statusGroups,
    errorRate: totalRequests ? Number((((statusGroups["4xx"] + statusGroups["5xx"]) / totalRequests) * 100).toFixed(2)) : 0,
    topErrorEndpoints: endpointRows.map((row) => ({
      route: row.route,
      errors: Number(row.error4xx || 0) + Number(row.error5xx || 0),
      error4xx: Number(row.error4xx || 0),
      error5xx: Number(row.error5xx || 0),
      severity: Number(row.error5xx || 0) > 0 ? "crit" : "warn",
    })),
    matrix: buildStatusMatrix(db, since, service, severity),
  };
}

export function queryBots(db: Database.Database, params: URLSearchParams): BotsResponse {
  const range = normalizeRange(params.get("range"));
  const type = normalizeBotType(params.get("type"));
  const search = String(params.get("search") || "").trim();
  const since = sinceIso(range);
  const filters = ["bucket >= @since"];
  const values: Record<string, string> = { since };
  if (type === "bot") filters.push("user_agent_type = 'known_bot'");
  if (type === "suspicious") filters.push("user_agent_type = 'suspicious'");
  if (search) {
    filters.push("LOWER(user_agent) LIKE @search");
    values.search = `%${search.toLowerCase()}%`;
  }
  const where = `WHERE ${filters.join(" AND ")}`;

  const compositionRows = db.prepare(`
    SELECT user_agent_type AS type, SUM(requests) AS requests
    FROM http_rollups
    WHERE bucket >= @since
    GROUP BY user_agent_type
  `).all({ since }) as Array<{ type: UserAgentType; requests: number }>;
  const compositionTotal = compositionRows.reduce((sum, row) => sum + Number(row.requests || 0), 0);
  const byType = new Map(compositionRows.map((row) => [row.type, Number(row.requests || 0)]));

  const agentRows = db.prepare(`
    SELECT user_agent AS userAgent, user_agent_type AS userAgentType, SUM(requests) AS requests, MAX(bucket) AS lastSeen
    FROM http_rollups
    ${where}
    AND user_agent_type IN ('known_bot', 'suspicious')
    GROUP BY user_agent, user_agent_type
    ORDER BY requests DESC
    LIMIT 30
  `).all(values) as Array<{ userAgent: string; userAgentType: UserAgentType; requests: number; lastSeen: string }>;

  return {
    range,
    type,
    search,
    totalRequests: compositionTotal,
    composition: [
      compositionItem("real", "Usuarios reales", byType.get("real") || 0, compositionTotal),
      compositionItem("known_bot", "Bots conocidos", byType.get("known_bot") || 0, compositionTotal),
      compositionItem("suspicious", "Sospechosos", byType.get("suspicious") || 0, compositionTotal),
    ],
    agents: agentRows.map((row) => ({
      userAgent: row.userAgent,
      type: row.userAgentType === "known_bot" ? "bot" : "suspicious",
      requests: Number(row.requests || 0),
      lastSeen: row.lastSeen,
      action: row.userAgentType === "known_bot" ? "Permitir" : Number(row.requests || 0) > 100 ? "Bloquear" : "Revisar",
    })),
  };
}

export function queryAlerts(db: Database.Database, params: URLSearchParams): AlertsResponse {
  const range = normalizeRange(params.get("range"));
  const service = normalizeService(params.get("service"));
  const severity = normalizeAlertSeverity(params.get("severity"));
  const values: Record<string, string> = { since: sinceIso(range) };
  const filters = ["timestamp >= @since"];
  if (service !== "all") {
    filters.push("service = @service");
    values.service = service;
  }
  if (severity !== "all") {
    filters.push("severity = @severity");
    values.severity = severity;
  }

  const rows = db.prepare(`
    SELECT timestamp, service, severity, title, message
    FROM alerts
    WHERE ${filters.join(" AND ")}
    ORDER BY timestamp DESC
    LIMIT 50
  `).all(values) as Array<{ timestamp: string; service: ServiceId; severity: AlertItem["severity"]; title: string; message: string }>;

  return { range, service, severity, alerts: rows };
}

function buildStatusMatrix(db: Database.Database, since: string, service: string, severity: string): ErrorsResponse["matrix"] {
  const services = service === "all" ? serviceIds : [service as ServiceId];
  const values: Record<string, string> = { since };
  const filters = ["bucket >= @since"];
  if (service !== "all") {
    filters.push("service = @service");
    values.service = service;
  }
  if (severity !== "all") filters.push(statusSeveritySql(severity));
  const rows = db.prepare(`
    SELECT service, strftime('%Y-%m-%dT%H:00:00.000Z', bucket) AS hour,
      SUM(requests) AS requests,
      SUM(CASE WHEN status_code BETWEEN 400 AND 499 THEN requests ELSE 0 END) AS warn,
      SUM(CASE WHEN status_code >= 500 THEN requests ELSE 0 END) AS crit
    FROM http_rollups
    WHERE ${filters.join(" AND ")}
    GROUP BY service, hour
    ORDER BY hour ASC
  `).all(values) as Array<{ service: ServiceId; hour: string; requests: number; warn: number; crit: number }>;

  const hourKeys = lastHours(24);
  const keyed = new Map(rows.map((row) => [`${row.service}:${row.hour}`, row]));
  return services.map((svc) => ({
    service: svc,
    buckets: hourKeys.map((hour) => {
      const row = keyed.get(`${svc}:${hour}`);
      if (!row || Number(row.requests || 0) === 0) return { bucket: hour, status: "idle" };
      if (Number(row.crit || 0) > 0) return { bucket: hour, status: "crit" };
      if (Number(row.warn || 0) > 0) return { bucket: hour, status: "warn" };
      return { bucket: hour, status: "ok" };
    }),
  }));
}

function cleanupHistory(db: Database.Database) {
  db.prepare("DELETE FROM http_rollups WHERE bucket < @cutoff").run({ cutoff: new Date(Date.now() - allowedRanges["7d"]).toISOString() });
  db.prepare("DELETE FROM alerts WHERE timestamp < @cutoff").run({ cutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() });
  db.prepare("DELETE FROM host_snapshots WHERE timestamp < @cutoff").run({ cutoff: new Date(Date.now() - allowedRanges["7d"]).toISOString() });
}

function buildAlertInputs(snapshot: MetricsSnapshot): AlertInput[] {
  return snapshot.alerts.map((alert) => ({
    timestamp: snapshot.host.generatedAt,
    service: inferService(alert),
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
  }));
}

function inferService(alert: AlertItem): ServiceId {
  const text = `${alert.title} ${alert.message}`.toLowerCase();
  if (text.includes("simulador") || text.includes("colyseus")) return "souls-simulador";
  if (text.includes("openclaw")) return "openclaw";
  if (text.includes("monitor") || text.includes("sospechoso")) return "souls-monitor";
  return "app-souls";
}

function buildHttpFilters(options: { since: string; service: string; severity: string }) {
  const values: Record<string, string> = { since: options.since };
  const filters = ["bucket >= @since"];
  if (options.service !== "all") {
    filters.push("service = @service");
    values.service = options.service;
  }
  if (options.severity !== "all") filters.push(statusSeveritySql(options.severity));
  return { where: `WHERE ${filters.join(" AND ")}`, values };
}

function statusSeveritySql(severity: string) {
  if (severity === "ok") return "status_code < 400";
  if (severity === "warn") return "status_code BETWEEN 400 AND 499";
  if (severity === "critical") return "status_code >= 500";
  return "1 = 1";
}

function normalizeRange(value: string | null) {
  return value && value in allowedRanges ? value : "24h";
}

function normalizeService(value: string | null) {
  return value && (value === "all" || serviceIds.includes(value as ServiceId)) ? value : "all";
}

function normalizeSeverityFilter(value: string | null) {
  if (value === "crit") return "critical";
  return value && ["all", "ok", "warn", "critical"].includes(value) ? value : "all";
}

function normalizeAlertSeverity(value: string | null) {
  if (value === "crit") return "critical";
  return value && ["all", "ok", "warn", "critical"].includes(value) ? value : "all";
}

function normalizeBotType(value: string | null) {
  if (value === "susp") return "suspicious";
  return value && ["all", "bot", "suspicious"].includes(value) ? value : "all";
}

function sinceIso(range: string) {
  return new Date(Date.now() - allowedRanges[range]).toISOString();
}

function compositionItem(type: UserAgentType, label: string, requests: number, total: number) {
  return { type, label, requests, percent: total ? Math.round((requests / total) * 100) : 0 };
}

function lastHours(count: number) {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const hours: string[] = [];
  for (let index = count - 1; index >= 0; index--) {
    hours.push(new Date(now.getTime() - index * 60 * 60 * 1000).toISOString());
  }
  return hours;
}
