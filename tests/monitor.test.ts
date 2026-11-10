import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openMonitorDb, queryErrors, queryHistory, queryServiceRoutes, saveMetricsHistory } from "../src/db.js";
import { collectNginxFromText } from "../src/collector.js";
import type { MetricsSnapshot } from "../src/types.js";

test("Nginx parser keeps service identity and request timing", () => {
  const line = `127.0.0.1 - - [10/Nov/2026:12:00:00 +0000] "GET /api/cards?id=123456789012345678 HTTP/1.1" 200 120 "-" "Mozilla/5.0" "-" rt=0.125`;
  const parsed = collectNginxFromText(line, "app-souls-dev");
  assert.equal(parsed.snapshot.totalRequests, 1);
  assert.equal(parsed.rollups[0]?.service, "app-souls-dev");
  assert.equal(parsed.rollups[0]?.requestTimeMsTotal, 125);
  assert.equal(parsed.snapshot.topRoutes[0]?.route, "/api/cards");
});

test("SQLite stores real host, service and traffic history", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "souls-monitor-"));
  try {
    const db = openMonitorDb(path.join(directory, "monitor.sqlite"));
    const timestamp = new Date().toISOString();
    const snapshot: MetricsSnapshot = {
      schemaVersion: 2,
      host: { hostname: "test-host", generatedAt: timestamp, uptimeSeconds: 10, loadAverage: [0, 0, 0], cpuPercent: 12, memory: { totalBytes: 1000, freeBytes: 400, availableBytes: 400, usedBytes: 600, usedPercent: 60 }, disks: [] },
      services: [{ id: "app-souls-dev", name: "app-souls dev", environment: "development", kind: "pm2", status: "online", health: "ok", processStatus: "online", cpuPercent: 2, memoryBytes: 100, probe: { url: "https://app-dev.soulsinxtinction.com/", ok: true, statusCode: 200, latencyMs: 80, checkedAt: timestamp } }],
      nginx: { analyzedLines: 1, totalRequests: 1, totalBytes: 120, statusCounts: { "200": 1 }, methodCounts: { GET: 1 }, topRoutes: [], suspiciousUserAgents: [] },
      storage: { paths: [], dockerSummary: [] }, alerts: [],
    };
    saveMetricsHistory(db, snapshot, [{ bucket: timestamp, service: "app-souls-dev", route: "/", statusCode: 200, method: "GET", bytes: 120, requestTimeMsTotal: 80, requestTimeSamples: 1, userAgentType: "real", userAgent: "test", requests: 1 }]);
    const history = queryHistory(db, new URLSearchParams("range=24h&service=app-souls-dev"));
    assert.equal(history.host.length, 1);
    assert.equal(history.services[0]?.service, "app-souls-dev");
    assert.equal(history.traffic[0]?.requests, 1);
    assert.equal(queryErrors(db, new URLSearchParams("range=24h&service=app-souls-dev")).errorRate, 0);
    assert.equal(queryErrors(db, new URLSearchParams("range=24h&service=souls-monitor")).errorRate, null);
    assert.deepEqual(queryServiceRoutes(db, new URLSearchParams("range=24h&service=app-souls-dev")), [{ route: "/", requests: 1, bytes: 120, errors: 0, averageRequestTimeMs: 80 }]);
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
