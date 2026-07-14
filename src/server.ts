import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openMonitorDb, queryAlerts, queryBots, queryErrors } from "./db.js";

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
