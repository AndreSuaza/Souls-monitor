import type { Environment, ServiceHealth, ServiceKind } from "./types.js";

export interface ServiceDefinition {
  id: string;
  name: string;
  environment: Environment;
  kind: ServiceKind;
  port?: number;
  url?: string;
  probeUrl?: string;
  pm2Name?: string;
  systemdUnit?: string;
  dockerName?: string;
  logFiles?: string[];
  storagePaths?: string[];
}

export const SERVICE_CATALOG: ServiceDefinition[] = [
  {
    id: "app-souls",
    name: "app-souls",
    environment: "production",
    kind: "pm2",
    port: 3000,
    url: "https://soulsinxtinction.com/",
    probeUrl: "https://soulsinxtinction.com/",
    pm2Name: "app-souls",
    logFiles: ["/var/log/nginx/app-souls.access.log"],
    storagePaths: ["/opt/apps/app-souls"],
  },
  {
    id: "app-souls-dev",
    name: "app-souls dev",
    environment: "development",
    kind: "pm2",
    port: 3001,
    url: "https://app-dev.soulsinxtinction.com/",
    probeUrl: "https://app-dev.soulsinxtinction.com/",
    pm2Name: "app-souls-dev",
    logFiles: ["/var/log/nginx/app-souls-dev.access.log"],
    storagePaths: ["/opt/apps/app-souls-dev"],
  },
  {
    id: "souls-simulador",
    name: "Souls Simulador",
    environment: "production",
    kind: "systemd",
    port: 2567,
    url: "https://simulador.soulsinxtinction.com/",
    probeUrl: "https://simulador.soulsinxtinction.com/",
    systemdUnit: "souls-simulador.service",
    logFiles: ["/var/log/nginx/souls-simulador.access.log"],
    storagePaths: ["/opt/apps/souls-simulador"],
  },
  {
    id: "souls-simulador-dev",
    name: "Souls Simulador dev",
    environment: "development",
    kind: "systemd",
    port: 2568,
    url: "https://simulador-dev.soulsinxtinction.com/",
    probeUrl: "https://simulador-dev.soulsinxtinction.com/",
    systemdUnit: "souls-simulador-dev.service",
    logFiles: ["/var/log/nginx/souls-simulador-dev.access.log"],
    storagePaths: ["/opt/apps/souls-simulador-dev"],
  },
  {
    id: "souls-monitor",
    name: "Souls Monitor",
    environment: "infrastructure",
    kind: "systemd",
    port: 3101,
    url: "https://monitor.soulsinxtinction.com/",
    probeUrl: "http://127.0.0.1:3101/healthz",
    systemdUnit: "souls-monitor.service",
    logFiles: ["/var/log/nginx/souls-monitor.access.log"],
    storagePaths: ["/opt/apps/souls-monitor"],
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    environment: "infrastructure",
    kind: "docker",
    url: "https://openclaw.soulsinxtinction.com/",
    probeUrl: "https://openclaw.soulsinxtinction.com/",
    dockerName: "openclaw-hgga-openclaw-1",
    logFiles: ["/var/log/nginx/openclaw.access.log"],
    storagePaths: ["/opt/openclaw-hgga/data"],
  },
];

export const SERVICE_IDS = SERVICE_CATALOG.map((service) => service.id);

export function serviceDefinition(id: string) {
  return SERVICE_CATALOG.find((service) => service.id === id) || null;
}

export function serviceIdForProcess(name: string) {
  const normalized = name.toLowerCase();
  return SERVICE_CATALOG.find((service) =>
    [service.id, service.name, service.pm2Name, service.systemdUnit, service.dockerName]
      .filter(Boolean)
      .some((candidate) => normalized === candidate!.toLowerCase()),
  )?.id || null;
}

export function serviceIdForLogPath(filePath: string) {
  return SERVICE_CATALOG.find((service) => service.logFiles?.includes(filePath))?.id || null;
}

export function healthFromSignals(processStatus: string | null, probeOk: boolean | null): ServiceHealth {
  const processKnown = processStatus !== null;
  const processOk = processKnown && /online|running|active|ok/i.test(processStatus || "");
  if (processKnown && !processOk) return "critical";
  if (probeOk === false) return "critical";
  if (!processKnown && probeOk === null) return "unknown";
  if (!processKnown || probeOk === null) return "warn";
  return "ok";
}
