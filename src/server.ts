import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openMonitorDb, queryAlerts, queryBots, queryErrors, queryHistory, queryServiceRoutes } from "./db.js";
import { listDocs, readDoc } from "./docs.js";
import { serviceDefinition } from "./services.js";
import type { MetricsSnapshot, ServiceDetailResponse } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3101);
const metricsPath = process.env.METRICS_PATH || "/opt/souls-monitor/runtime/metrics.json";
const sqlitePath = process.env.SQLITE_PATH || "/opt/souls-monitor/runtime/monitor.sqlite";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

async function serveFile(urlPath: string) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const resolved = path.normalize(path.join(publicDir, safePath));
  if (!resolved.startsWith(publicDir)) return null;
  const data = await fs.readFile(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "EISDIR") return null;
    throw error;
  });
  if (!data) return null;
  const ext = path.extname(resolved);
  return { data, contentType: contentTypes[ext] || "application/octet-stream" };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/overview") {
      const json = await fs.readFile(metricsPath, "utf8");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(json);
      return;
    }
    if (url.pathname === "/api/errors" || url.pathname === "/api/bots" || url.pathname === "/api/alerts") {
      const db = openMonitorDb(sqlitePath);
      const body =
        url.pathname === "/api/errors"
          ? queryErrors(db, url.searchParams)
          : url.pathname === "/api/bots"
            ? queryBots(db, url.searchParams)
            : queryAlerts(db, url.searchParams);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
      return;
    }
    if (url.pathname === "/api/history") {
      const body = queryHistory(openMonitorDb(sqlitePath), url.searchParams);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
      return;
    }
    const serviceMatch = url.pathname.match(/^\/api\/services\/([^/]+)$/);
    if (serviceMatch) {
      const serviceId = decodeURIComponent(serviceMatch[1]);
      const definition = serviceDefinition(serviceId);
      if (!definition) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Service not found" }));
        return;
      }
      const params = new URLSearchParams(url.searchParams);
      params.set("service", serviceId);
      const db = openMonitorDb(sqlitePath);
      const history = queryHistory(db, params);
      const current = await fs.readFile(metricsPath, "utf8").then((value) => JSON.parse(value) as MetricsSnapshot).catch(() => null);
      const detail: ServiceDetailResponse = {
        range: history.range,
        service: current?.services.find((service) => service.id === serviceId) || null,
        history: {
          service: serviceId,
          buckets: history.services.find((item) => item.service === serviceId)?.buckets || [],
          traffic: history.traffic,
        },
        routes: queryServiceRoutes(db, params),
        alerts: queryAlerts(db, params),
        errors: queryErrors(db, params),
        storage: (current?.storage.paths || []).filter((item) => definition.storagePaths?.includes(item.path)),
      };
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(detail));
      return;
    }
    if (url.pathname === "/api/docs") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(await listDocs()));
      return;
    }
    const docMatch = url.pathname.match(/^\/api\/docs\/([^/]+?)(\.md)?$/);
    if (docMatch) {
      const document = await readDoc(docMatch[1]);
      if (!document) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Document not found" }));
        return;
      }
      const download = Boolean(docMatch[2]);
      res.writeHead(200, {
        "content-type": download ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...(download ? { "content-disposition": `attachment; filename="${document.fileName}"` } : {}),
      });
      res.end(download ? document.markdown : JSON.stringify(document));
      return;
    }
    const file = await serveFile(url.pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": file.contentType, "cache-control": "no-store" });
    res.end(file.data);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "unknown error" }));
  }
});

server.listen(port, host, () => {
  console.log(`Souls Monitor listening on http://${host}:${port}`);
});
