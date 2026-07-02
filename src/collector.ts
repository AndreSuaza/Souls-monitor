import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AlertItem, HostSnapshot, MetricsSnapshot, NginxSnapshot, ServiceSnapshot, StorageSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);

const OUTPUT_PATH = process.env.COLLECTOR_OUTPUT || "/opt/souls-monitor/runtime/metrics.json";
const NGINX_ACCESS_LOG = process.env.NGINX_ACCESS_LOG || "/var/log/nginx/app-souls.access.log";
const NGINX_ACCESS_LOG_PREVIOUS = process.env.NGINX_ACCESS_LOG_PREVIOUS || "/var/log/nginx/app-souls.access.log.1";
const MAX_LOG_BYTES = Number(process.env.MAX_LOG_BYTES || 3_000_000);

async function run(command: string, args: string[], options: { timeout?: number } = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout ?? 10_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

function parseBytes(value: string): number | null {
  const raw = value.trim();
  const match = raw.match(/^([\d.]+)\s*([KMGTPE]?i?B|B)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = (match[2] || "B").toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };
  return Math.round(number * (multipliers[unit] ?? 1));
}

function parseDockerNet(value: string): { rx: number | null; tx: number | null } {
  const [rxRaw, txRaw] = value.split("/").map((part) => part?.trim() || "");
  return { rx: parseBytes(rxRaw), tx: parseBytes(txRaw) };
}

async function collectHost(): Promise<HostSnapshot> {
  const meminfo = await fs.readFile("/proc/meminfo", "utf8").catch(() => "");
  const values = new Map<string, number>();
  for (const line of meminfo.split("\n")) {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const totalBytes = values.get("MemTotal") ?? os.totalmem();
  const freeBytes = values.get("MemFree") ?? os.freemem();
  const availableBytes = values.get("MemAvailable") ?? freeBytes;
  const usedBytes = totalBytes - availableBytes;
  const dfOutput = await run("df", ["-B1", "--output=target,size,used,avail,pcent", "/", "/opt", "/var"]);
  const disks = dfOutput
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 5)
    .map(([mount, size, used, available, percent]) => ({
      mount,
      sizeBytes: Number(size),
      usedBytes: Number(used),
      availableBytes: Number(available),
      usedPercent: Number(percent.replace("%", "")),
    }));

  return {
    hostname: os.hostname(),
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(os.uptime()),
    loadAverage: os.loadavg(),
    memory: {
      totalBytes,
      freeBytes,
      availableBytes,
      usedBytes,
      usedPercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
    },
    disks,
  };
}

async function collectPm2(): Promise<ServiceSnapshot[]> {
  const stdout = await run("runuser", ["-u", "deploy", "--", "env", "PM2_HOME=/home/deploy/.pm2", "pm2", "jlist"]);
  if (!stdout) return [];
  try {
    const processes = JSON.parse(stdout) as Array<any>;
    return processes.map((proc) => ({
      name: proc.name || "unknown-pm2",
      kind: "pm2",
      status: proc.pm2_env?.status || "unknown",
      cpuPercent: typeof proc.monit?.cpu === "number" ? proc.monit.cpu : null,
      memoryBytes: typeof proc.monit?.memory === "number" ? proc.monit.memory : null,
      restarts: typeof proc.pm2_env?.restart_time === "number" ? proc.pm2_env.restart_time : undefined,
      uptimeMs: typeof proc.pm2_env?.pm_uptime === "number" ? Date.now() - proc.pm2_env.pm_uptime : undefined,
    }));
  } catch {
    return [];
  }
}

async function collectDocker(): Promise<ServiceSnapshot[]> {
  const stdout = await run("docker", [
    "stats",
    "--no-stream",
    "--format",
    "{{json .}}",
  ]);
  if (!stdout) return [];
  return stdout
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, string>;
      } catch {
        return null;
      }
    })
    .filter((item): item is Record<string, string> => Boolean(item))
    .map((item) => {
      const net = parseDockerNet(item.NetIO || "");
      return {
        name: item.Name || "unknown-container",
        kind: "docker",
        status: "running",
        cpuPercent: Number((item.CPUPerc || "").replace("%", "")),
        memoryBytes: parseBytes((item.MemUsage || "").split("/")[0] || ""),
        networkRxBytes: net.rx,
        networkTxBytes: net.tx,
      };
    });
}

async function readTail(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const start = Math.max(0, stat.size - MAX_LOG_BYTES);
    const handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(stat.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    await handle.close();
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function normalizeRoute(rawPath: string): string {
  const noQuery = rawPath.split("?")[0] || "/";
  return noQuery
    .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/:id")
    .replace(/\/\d{4,}(?=\/|$)/g, "/:id")
    .replace(/\/[A-Za-z0-9_-]{18,}(?=\/|$)/g, "/:slug");
}

function collectNginxFromText(text: string): NginxSnapshot {
  const routes = new Map<string, { requests: number; bytes: number; error4xx: number; error5xx: number; requestTimes: number[] }>();
  const statusCounts: Record<string, number> = {};
  const methodCounts: Record<string, number> = {};
  const suspicious = new Map<string, number>();
  let analyzedLines = 0;
  let totalRequests = 0;
  let totalBytes = 0;

  const pattern = /^\S+ - \S+ \[[^\]]+\] "([A-Z]+) ([^" ]+) [^"]*" (\d{3}) (\d+) "[^"]*" "([^"]*)" "[^"]*" rt=([\d.-]+)/;
  for (const line of text.split("\n")) {
    const match = line.match(pattern);
    if (!match) continue;
    analyzedLines += 1;
    totalRequests += 1;
    const method = match[1];
    const route = normalizeRoute(match[2]);
    const status = match[3];
    const bytes = Number(match[4]) || 0;
    const userAgent = match[5] || "-";
    const requestTimeMs = Number(match[6]) * 1000;
    totalBytes += bytes;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    methodCounts[method] = (methodCounts[method] || 0) + 1;
    const entry = routes.get(route) || { requests: 0, bytes: 0, error4xx: 0, error5xx: 0, requestTimes: [] };
    entry.requests += 1;
    entry.bytes += bytes;
    if (status.startsWith("4")) entry.error4xx += 1;
    if (status.startsWith("5")) entry.error5xx += 1;
    if (Number.isFinite(requestTimeMs)) entry.requestTimes.push(requestTimeMs);
    routes.set(route, entry);
    if (/bot|crawl|spider|curl|wget|python|scrapy|httpclient|semrush|ahrefs|bytespider|zgrab|sqlmap/i.test(userAgent)) {
      suspicious.set(userAgent, (suspicious.get(userAgent) || 0) + 1);
    }
  }

  const topRoutes = [...routes.entries()]
    .map(([route, entry]) => ({
      route,
      requests: entry.requests,
      bytes: entry.bytes,
      error4xx: entry.error4xx,
      error5xx: entry.error5xx,
      averageRequestTimeMs: entry.requestTimes.length
        ? Math.round(entry.requestTimes.reduce((sum, value) => sum + value, 0) / entry.requestTimes.length)
        : null,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 20);

  return {
    analyzedLines,
    totalRequests,
    totalBytes,
    statusCounts,
    methodCounts,
    topRoutes,
    suspiciousUserAgents: [...suspicious.entries()]
      .map(([userAgent, requests]) => ({ userAgent, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 20),
  };
}

async function collectNginx(): Promise<NginxSnapshot> {
  const [current, previous] = await Promise.all([readTail(NGINX_ACCESS_LOG), readTail(NGINX_ACCESS_LOG_PREVIOUS)]);
  return collectNginxFromText(`${previous}\n${current}`);
}

async function collectStorage(): Promise<StorageSnapshot> {
  const paths = await Promise.all(
    ["/opt/apps/app-souls", "/opt/openclaw-hgga", "/var/log/nginx", "/home/deploy/.pm2/logs"].map(async (target) => {
      const stdout = await run("du", ["-sb", target]);
      const bytes = Number(stdout.split(/\s+/)[0]);
      return { path: target, bytes: Number.isFinite(bytes) ? bytes : null };
    }),
  );
  const dockerSummary = (await run("docker", ["system", "df"])).split("\n").filter(Boolean);
  return { paths, dockerSummary };
}

function buildAlerts(snapshot: Omit<MetricsSnapshot, "alerts">): AlertItem[] {
  const alerts: AlertItem[] = [];
  if (snapshot.host.memory.usedPercent >= 85) {
    alerts.push({ severity: "critical", title: "RAM alta", message: `Uso de RAM en ${snapshot.host.memory.usedPercent}%.` });
  } else if (snapshot.host.memory.usedPercent >= 75) {
    alerts.push({ severity: "warn", title: "RAM en observacion", message: `Uso de RAM en ${snapshot.host.memory.usedPercent}%.` });
  }
  for (const disk of snapshot.host.disks) {
    if (disk.usedPercent >= 90) alerts.push({ severity: "critical", title: `Disco ${disk.mount} critico`, message: `${disk.usedPercent}% usado.` });
    else if (disk.usedPercent >= 75) alerts.push({ severity: "warn", title: `Disco ${disk.mount} alto`, message: `${disk.usedPercent}% usado.` });
  }
  for (const service of snapshot.services) {
    if (!/online|running/i.test(service.status)) {
      alerts.push({ severity: "critical", title: `${service.name} no esta activo`, message: `Estado actual: ${service.status}.` });
    }
  }
  const fiveHundreds = Object.entries(snapshot.nginx.statusCounts)
    .filter(([status]) => status.startsWith("5"))
    .reduce((sum, [, count]) => sum + count, 0);
  if (fiveHundreds > 0) {
    alerts.push({ severity: "warn", title: "Errores 5xx detectados", message: `${fiveHundreds} respuestas 5xx en la ventana analizada.` });
  }
  if (snapshot.nginx.suspiciousUserAgents.length > 0) {
    alerts.push({
      severity: "warn",
      title: "Trafico sospechoso",
      message: `${snapshot.nginx.suspiciousUserAgents[0].requests} requests del user-agent sospechoso principal.`,
    });
  }
  if (alerts.length === 0) alerts.push({ severity: "ok", title: "Sin alertas criticas", message: "Host, servicios y errores estan dentro de rangos normales." });
  return alerts;
}

async function main() {
  const [host, pm2, docker, nginx, storage] = await Promise.all([
    collectHost(),
    collectPm2(),
    collectDocker(),
    collectNginx(),
    collectStorage(),
  ]);
  const withoutAlerts = {
    host,
    services: [...pm2, ...docker],
    nginx,
    storage,
  };
  const snapshot: MetricsSnapshot = {
    ...withoutAlerts,
    alerts: buildAlerts(withoutAlerts),
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const tmp = `${OUTPUT_PATH}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.rename(tmp, OUTPUT_PATH);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
