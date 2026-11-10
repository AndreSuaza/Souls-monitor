export type Severity = "ok" | "warn" | "critical";
export type Environment = "production" | "development" | "infrastructure";
export type ServiceKind = "pm2" | "docker" | "systemd";
export type ServiceHealth = "ok" | "warn" | "critical" | "unknown";

export interface AlertItem {
  severity: Severity;
  title: string;
  message: string;
}

export interface HostSnapshot {
  hostname: string;
  generatedAt: string;
  uptimeSeconds: number;
  loadAverage: number[];
  cpuPercent?: number | null;
  memory: {
    totalBytes: number;
    freeBytes: number;
    availableBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disks: Array<{
    mount: string;
    sizeBytes: number;
    usedBytes: number;
    availableBytes: number;
    usedPercent: number;
  }>;
}

export interface ServiceSnapshot {
  id: string;
  name: string;
  environment: Environment;
  kind: ServiceKind;
  status: string;
  health: ServiceHealth;
  url?: string;
  port?: number;
  processStatus?: string | null;
  probe?: ProbeSnapshot | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  restarts?: number;
  uptimeMs?: number;
  image?: string;
  pid?: number | null;
  networkRxBytes?: number | null;
  networkTxBytes?: number | null;
}

export interface ProbeSnapshot {
  url: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  checkedAt: string;
  error?: string | null;
}

export interface RouteTraffic {
  route: string;
  requests: number;
  bytes: number;
  error4xx: number;
  error5xx: number;
  averageRequestTimeMs: number | null;
}

export interface NginxSnapshot {
  analyzedLines: number;
  totalRequests: number;
  totalBytes: number;
  statusCounts: Record<string, number>;
  methodCounts: Record<string, number>;
  topRoutes: RouteTraffic[];
  suspiciousUserAgents: Array<{ userAgent: string; requests: number }>;
}

export interface StorageSnapshot {
  paths: Array<{ path: string; bytes: number | null }>;
  dockerSummary: string[];
}

export interface MetricsSnapshot {
  schemaVersion: 2;
  host: HostSnapshot;
  services: ServiceSnapshot[];
  nginx: NginxSnapshot;
  storage: StorageSnapshot;
  alerts: AlertItem[];
}

export interface HistoryResponse {
  range: string;
  service: string;
  host: Array<{
    timestamp: string;
    cpuPercent: number | null;
    memoryUsedPercent: number | null;
    diskUsedPercent: number | null;
  }>;
  services: Array<{
    service: string;
    buckets: Array<{
      timestamp: string;
      health: ServiceHealth;
      cpuPercent: number | null;
      memoryBytes: number | null;
      probeLatencyMs: number | null;
    }>;
  }>;
  traffic: Array<{
    timestamp: string;
    service: string;
    requests: number;
    bytes: number;
    error4xx: number;
    error5xx: number;
    averageRequestTimeMs: number | null;
  }>;
}
