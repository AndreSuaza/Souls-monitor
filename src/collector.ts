import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { openMonitorDb, saveMetricsHistory, type HttpRollupInput, type UserAgentType } from "./db.js";
import { healthFromSignals, SERVICE_CATALOG, serviceDefinition, serviceIdForProcess } from "./services.js";
import type { AlertItem, HostSnapshot, MetricsSnapshot, NginxSnapshot, ProbeSnapshot, ServiceSnapshot, StorageSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const OUTPUT_PATH = process.env.COLLECTOR_OUTPUT || "/opt/souls-monitor/runtime/metrics.json";
const SQLITE_PATH = process.env.SQLITE_PATH || "/opt/souls-monitor/runtime/monitor.sqlite";
const MAX_LOG_BYTES = Number(process.env.MAX_LOG_BYTES || 3_000_000);
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 8_000);

async function run(command: string, args: string[], timeout = 10_000) {
  try {
    const result = await execFileAsync(command, args, { timeout, maxBuffer: 16 * 1024 * 1024 });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

function parseBytes(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)\s*([KMGTPE]?i?B|B)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = (match[2] || "B").toUpperCase();
  const multipliers: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  return Math.round(number * (multipliers[unit] ?? 1));
}

function parseDockerNet(value: string) {
  const [rx, tx] = value.split("/").map((part) => parseBytes(part || ""));
  return { rx, tx };
}

async function readCpuSample() {
  const first = (await fs.readFile("/proc/stat", "utf8").catch(() => "")).split("\n")[0] || "";
  const parts = first.trim().split(/\s+/).slice(1).map(Number);
  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) return null;
  return { idle: (parts[3] || 0) + (parts[4] || 0), total: parts.reduce((sum, value) => sum + value, 0) };
}

async function collectCpuPercent() {
  const before = await readCpuSample();
  if (!before) return null;
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await readCpuSample();
  if (!after) return null;
  const idleDelta = after.idle - before.idle;
  const totalDelta = after.total - before.total;
  return totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10 : null;
}

async function collectHost(): Promise<HostSnapshot> {
  const [cpuPercent, meminfo, dfOutput] = await Promise.all([
    collectCpuPercent(),
    fs.readFile("/proc/meminfo", "utf8").catch(() => ""),
    run("df", ["-B1", "--output=target,size,used,avail,pcent", "/", "/opt", "/var"]),
  ]);
  const values = new Map<string, number>();
  for (const line of meminfo.split("\n")) {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const totalBytes = values.get("MemTotal") ?? os.totalmem();
  const availableBytes = values.get("MemAvailable") ?? values.get("MemFree") ?? os.freemem();
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const disks = dfOutput.split("\n").slice(1).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length >= 5).map(([mount, size, used, available, percent]) => ({
    mount, sizeBytes: Number(size), usedBytes: Number(used), availableBytes: Number(available), usedPercent: Number(percent.replace("%", "")),
  })).filter((disk) => Number.isFinite(disk.sizeBytes));
  return {
    hostname: os.hostname(), generatedAt: new Date().toISOString(), uptimeSeconds: Math.round(os.uptime()), loadAverage: os.loadavg(), cpuPercent,
    memory: { totalBytes, freeBytes: values.get("MemFree") ?? availableBytes, availableBytes, usedBytes, usedPercent: Math.round((usedBytes / totalBytes) * 1000) / 10 },
    disks,
  };
}

async function collectPm2(): Promise<ServiceSnapshot[]> {
  const output = await run("runuser", ["-u", "deploy", "--", "env", "PM2_HOME=/home/deploy/.pm2", "pm2", "jlist"]);
  if (!output) return [];
  try {
    const processes = JSON.parse(output) as Array<Record<string, any>>;
    return processes.map((proc): ServiceSnapshot | null => {
      const name = String(proc.name || "");
      const id = serviceIdForProcess(name);
      if (!id) return null;
      const definition = serviceDefinition(id)!;
      return {
        id, name: definition.name, environment: definition.environment, kind: "pm2" as const, status: proc.pm2_env?.status || "unknown", processStatus: proc.pm2_env?.status || null,
        health: healthFromSignals(proc.pm2_env?.status || null, null), url: definition.url, port: definition.port,
        cpuPercent: typeof proc.monit?.cpu === "number" ? proc.monit.cpu : null, memoryBytes: typeof proc.monit?.memory === "number" ? proc.monit.memory : null,
        restarts: typeof proc.pm2_env?.restart_time === "number" ? proc.pm2_env.restart_time : undefined, uptimeMs: typeof proc.pm2_env?.pm_uptime === "number" ? Date.now() - proc.pm2_env.pm_uptime : undefined, pid: typeof proc.pid === "number" ? proc.pid : null,
      } satisfies ServiceSnapshot;
    }).filter((item): item is ServiceSnapshot => item !== null);
  } catch {
    return [];
  }
}

function parseSystemctlShow(output: string) {
  const values = new Map<string, string>();
  for (const line of output.split("\n")) { const index = line.indexOf("="); if (index > -1) values.set(line.slice(0, index), line.slice(index + 1)); }
  return values;
}

async function collectSystemd(): Promise<ServiceSnapshot[]> {
  const definitions = SERVICE_CATALOG.filter((service) => service.systemdUnit);
  return (await Promise.all(definitions.map(async (definition): Promise<ServiceSnapshot | null> => {
    const output = await run("systemctl", ["show", definition.systemdUnit!, "--property=Id,ActiveState,SubState,MainPID,NRestarts,MemoryCurrent"]);
    if (!output) return null;
    const values = parseSystemctlShow(output);
    const processStatus = values.get("ActiveState") || values.get("SubState") || null;
    const memory = Number(values.get("MemoryCurrent"));
    const restarts = Number(values.get("NRestarts"));
    const pid = Number(values.get("MainPID"));
    return { id: definition.id, name: definition.name, environment: definition.environment, kind: "systemd" as const, status: processStatus || "unknown", processStatus, health: healthFromSignals(processStatus, null), url: definition.url, port: definition.port, cpuPercent: null, memoryBytes: Number.isFinite(memory) && memory > 0 ? memory : null, restarts: Number.isFinite(restarts) ? restarts : undefined, pid: Number.isFinite(pid) && pid > 0 ? pid : null } satisfies ServiceSnapshot;
  }))).filter((item): item is ServiceSnapshot => item !== null);
}

async function collectDocker(): Promise<ServiceSnapshot[]> {
  const output = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}"]);
  if (!output) return [];
  return output.split("\n").map((line) => { try { return JSON.parse(line) as Record<string, string>; } catch { return null; } }).filter((item): item is Record<string, string> => Boolean(item)).map((item): ServiceSnapshot | null => {
    const id = serviceIdForProcess(item.Name || "");
    if (!id) return null;
    const definition = serviceDefinition(id)!;
    const net = parseDockerNet(item.NetIO || "");
    return { id, name: definition.name, environment: definition.environment, kind: "docker" as const, status: "running", processStatus: "running", health: healthFromSignals("running", null), url: definition.url, cpuPercent: Number((item.CPUPerc || "").replace("%", "")) || null, memoryBytes: parseBytes((item.MemUsage || "").split("/")[0] || ""), networkRxBytes: net.rx, networkTxBytes: net.tx } satisfies ServiceSnapshot;
  }).filter((item): item is ServiceSnapshot => item !== null);
}

async function probe(definition: typeof SERVICE_CATALOG[number]): Promise<ProbeSnapshot | null> {
  if (!definition.probeUrl) return null;
  const checkedAt = new Date().toISOString();
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(definition.probeUrl, { signal: controller.signal, redirect: "manual" });
    return { url: definition.probeUrl, ok: response.status >= 200 && response.status < 400, statusCode: response.status, latencyMs: Math.round(performance.now() - started), checkedAt };
  } catch (error) {
    return { url: definition.probeUrl, ok: false, statusCode: null, latencyMs: null, checkedAt, error: error instanceof Error ? error.message : "probe failed" };
  } finally { clearTimeout(timeout); }
}

async function enrichServices(collected: ServiceSnapshot[]): Promise<ServiceSnapshot[]> {
  const byId = new Map(collected.map((service) => [service.id, service]));
  return Promise.all(SERVICE_CATALOG.map(async (definition) => {
    const current = byId.get(definition.id);
    const probeResult = await probe(definition);
    const processStatus = current?.processStatus ?? null;
    return { id: definition.id, name: definition.name, environment: definition.environment, kind: definition.kind, status: current?.status || (probeResult ? (probeResult.ok ? "probe-only" : "unreachable") : "unknown"), processStatus, health: healthFromSignals(processStatus, probeResult?.ok ?? null), url: definition.url, port: definition.port, probe: probeResult, cpuPercent: current?.cpuPercent ?? null, memoryBytes: current?.memoryBytes ?? null, restarts: current?.restarts, uptimeMs: current?.uptimeMs, image: current?.image, pid: current?.pid, networkRxBytes: current?.networkRxBytes, networkTxBytes: current?.networkTxBytes } satisfies ServiceSnapshot;
  }));
}

async function readTail(filePath: string) {
  try {
    const stat = await fs.stat(filePath); const start = Math.max(0, stat.size - MAX_LOG_BYTES); const handle = await fs.open(filePath, "r"); const buffer = Buffer.alloc(stat.size - start); await handle.read(buffer, 0, buffer.length, start); await handle.close(); return buffer.toString("utf8");
  } catch { return ""; }
}

function normalizeRoute(rawPath: string) { return (rawPath.split("?")[0] || "/").replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/:id").replace(/\/\d{4,}(?=\/|$)/g, "/:id").replace(/\/[A-Za-z0-9_-]{18,}(?=\/|$)/g, "/:slug"); }
function parseNginxTimestamp(value: string) { const match = value.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/); if (!match) return null; const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[2]); if (month < 0) return null; const date = new Date(`${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1]}T${match[4]}:${match[5]}:${match[6]}${match[7].slice(0, 3)}:${match[7].slice(3)}`); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function minuteBucket(iso: string) { const date = new Date(iso); date.setUTCSeconds(0, 0); return date.toISOString(); }
function classifyUserAgent(userAgent: string): UserAgentType { if (/googlebot|bingbot|duckduckbot|baiduspider|yandexbot|slurp|facebookexternalhit|twitterbot|linkedinbot/i.test(userAgent)) return "known_bot"; if (/bot|crawl|spider|curl|wget|python|scrapy|httpclient|semrush|ahrefs|bytespider|zgrab|sqlmap/i.test(userAgent)) return "suspicious"; return "real"; }

export function collectNginxFromText(text: string, service: string): { snapshot: NginxSnapshot; rollups: HttpRollupInput[] } {
  const routes = new Map<string, { requests: number; bytes: number; error4xx: number; error5xx: number; timeTotal: number; timeSamples: number }>();
  const rollups = new Map<string, HttpRollupInput>(); const statusCounts: Record<string, number> = {}; const methodCounts: Record<string, number> = {}; const suspicious = new Map<string, number>();
  let analyzedLines = 0; let totalRequests = 0; let totalBytes = 0;
  const pattern = /\[([^\]]+)\] "([A-Z]+) ([^" ]+) [^"]*" (\d{3}) (\d+) "[^"]*" "([^"]*)" "[^"]*" rt=([\d.-]+)/;
  for (const line of text.split("\n")) {
    const match = line.match(pattern); if (!match) continue;
    analyzedLines += 1; totalRequests += 1; const timestamp = parseNginxTimestamp(match[1]); const method = match[2]; const route = normalizeRoute(match[3]); const statusCode = Number(match[4]); const status = match[4]; const bytes = Number(match[5]) || 0; const userAgent = match[6] || "-"; const requestTimeMs = Number(match[7]) * 1000; const userAgentType = classifyUserAgent(userAgent);
    totalBytes += bytes; statusCounts[status] = (statusCounts[status] || 0) + 1; methodCounts[method] = (methodCounts[method] || 0) + 1;
    const entry = routes.get(route) || { requests: 0, bytes: 0, error4xx: 0, error5xx: 0, timeTotal: 0, timeSamples: 0 }; entry.requests += 1; entry.bytes += bytes; if (status.startsWith("4")) entry.error4xx += 1; if (status.startsWith("5")) entry.error5xx += 1; if (Number.isFinite(requestTimeMs)) { entry.timeTotal += requestTimeMs; entry.timeSamples += 1; } routes.set(route, entry);
    if (timestamp) { const bucket = minuteBucket(timestamp); const key = [service, bucket, route, status, method, userAgentType, userAgent].join("\u0000"); const current = rollups.get(key) || { bucket, service, route, statusCode, method, userAgentType, userAgent, requests: 0, bytes: 0, requestTimeMsTotal: 0, requestTimeSamples: 0 }; current.requests += 1; current.bytes += bytes; if (Number.isFinite(requestTimeMs)) { current.requestTimeMsTotal += requestTimeMs; current.requestTimeSamples += 1; } rollups.set(key, current); }
    if (userAgentType !== "real") suspicious.set(userAgent, (suspicious.get(userAgent) || 0) + 1);
  }
  const topRoutes = [...routes.entries()].map(([route, entry]) => ({ route, requests: entry.requests, bytes: entry.bytes, error4xx: entry.error4xx, error5xx: entry.error5xx, averageRequestTimeMs: entry.timeSamples ? Math.round(entry.timeTotal / entry.timeSamples) : null })).sort((a, b) => b.bytes - a.bytes).slice(0, 20);
  return { snapshot: { analyzedLines, totalRequests, totalBytes, statusCounts, methodCounts, topRoutes, suspiciousUserAgents: [...suspicious.entries()].map(([userAgent, requests]) => ({ userAgent, requests })).sort((a, b) => b.requests - a.requests).slice(0, 20) }, rollups: [...rollups.values()] };
}

async function collectNginx() {
  const entries = SERVICE_CATALOG.flatMap((service) => (service.logFiles || []).map((filePath) => ({ service: service.id, filePath })));
  const parsed = await Promise.all(entries.map(async ({ service, filePath }) => ({ service, result: collectNginxFromText(`${await readTail(`${filePath}.1`)}\n${await readTail(filePath)}`, service) })));
  const combined: NginxSnapshot = { analyzedLines: 0, totalRequests: 0, totalBytes: 0, statusCounts: {}, methodCounts: {}, topRoutes: [], suspiciousUserAgents: [] }; const rollups: HttpRollupInput[] = [];
  for (const item of parsed) { combined.analyzedLines += item.result.snapshot.analyzedLines; combined.totalRequests += item.result.snapshot.totalRequests; combined.totalBytes += item.result.snapshot.totalBytes; for (const [key, value] of Object.entries(item.result.snapshot.statusCounts)) combined.statusCounts[key] = (combined.statusCounts[key] || 0) + value; for (const [key, value] of Object.entries(item.result.snapshot.methodCounts)) combined.methodCounts[key] = (combined.methodCounts[key] || 0) + value; combined.topRoutes.push(...item.result.snapshot.topRoutes); combined.suspiciousUserAgents.push(...item.result.snapshot.suspiciousUserAgents); rollups.push(...item.result.rollups); }
  combined.topRoutes = combined.topRoutes.sort((a, b) => b.bytes - a.bytes).slice(0, 20); combined.suspiciousUserAgents = combined.suspiciousUserAgents.sort((a, b) => b.requests - a.requests).slice(0, 20); return { snapshot: combined, rollups };
}

async function collectStorage(): Promise<StorageSnapshot> {
  const targets = [...new Set([...SERVICE_CATALOG.flatMap((service) => service.storagePaths || []), "/var/log/nginx"])];
  const paths = await Promise.all(targets.map(async (target) => { const output = await run("du", ["-sb", target]); const bytes = Number(output.split(/\s+/)[0]); return { path: target, bytes: Number.isFinite(bytes) ? bytes : null }; }));
  return { paths, dockerSummary: (await run("docker", ["system", "df"])).split("\n").filter(Boolean) };
}

function buildAlerts(snapshot: Omit<MetricsSnapshot, "alerts">): AlertItem[] {
  const alerts: AlertItem[] = [];
  if (snapshot.host.memory.usedPercent >= 85) alerts.push({ severity: "critical", title: "RAM alta", message: `Uso de RAM en ${snapshot.host.memory.usedPercent}%.` }); else if (snapshot.host.memory.usedPercent >= 75) alerts.push({ severity: "warn", title: "RAM en observación", message: `Uso de RAM en ${snapshot.host.memory.usedPercent}%.` });
  for (const disk of snapshot.host.disks) { if (disk.usedPercent >= 90) alerts.push({ severity: "critical", title: `Disco ${disk.mount} crítico`, message: `${disk.usedPercent}% usado.` }); else if (disk.usedPercent >= 75) alerts.push({ severity: "warn", title: `Disco ${disk.mount} alto`, message: `${disk.usedPercent}% usado.` }); }
  for (const service of snapshot.services) { if (service.health === "critical") alerts.push({ severity: "critical", title: `${service.name} no saludable`, message: service.probe?.error || `Estado actual: ${service.status}.` }); else if (service.health === "unknown") alerts.push({ severity: "warn", title: `${service.name} sin fuente`, message: "No fue posible obtener estado de proceso ni probe." }); }
  const fiveHundreds = Object.entries(snapshot.nginx.statusCounts).filter(([status]) => status.startsWith("5")).reduce((sum, [, count]) => sum + count, 0); if (fiveHundreds > 0) alerts.push({ severity: "warn", title: "Errores 5xx detectados", message: `${fiveHundreds} respuestas 5xx en la ventana analizada.` });
  if (!alerts.length) alerts.push({ severity: "ok", title: "Sin alertas activas", message: "No se detectaron umbrales críticos con las fuentes disponibles." });
  return alerts;
}

async function main() {
  const host = await collectHost();
  const [pm2, docker, systemd, nginx, storage] = await Promise.all([collectPm2(), collectDocker(), collectSystemd(), collectNginx(), collectStorage()]);
  const withoutAlerts = { schemaVersion: 2 as const, host, services: await enrichServices([...pm2, ...docker, ...systemd]), nginx: nginx.snapshot, storage };
  const snapshot: MetricsSnapshot = { ...withoutAlerts, alerts: buildAlerts(withoutAlerts) };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true }); const temporary = `${OUTPUT_PATH}.tmp`; await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"); await fs.rename(temporary, OUTPUT_PATH);
  saveMetricsHistory(openMonitorDb(SQLITE_PATH), snapshot, nginx.rollups);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) main().catch((error) => { console.error(error); process.exitCode = 1; });
