export type Severity = "ok" | "warn" | "critical";

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
  name: string;
  kind: "pm2" | "docker" | "systemd";
  status: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  restarts?: number;
  uptimeMs?: number;
  image?: string;
  pid?: number | null;
  networkRxBytes?: number | null;
  networkTxBytes?: number | null;
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
  host: HostSnapshot;
  services: ServiceSnapshot[];
  nginx: NginxSnapshot;
  storage: StorageSnapshot;
  alerts: AlertItem[];
}
