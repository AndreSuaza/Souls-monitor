const state = {
  overview: null,
  history: null,
  alerts: null,
  errors: null,
  docs: [],
  detail: null,
  detailKey: "",
  detailLoadingKey: "",
  detailError: null,
  error: null,
  doc: null,
  range: "24h",
  loading: true,
  loadPromise: null,
};

const app = document.querySelector("#app");
const $ = (selector) => document.querySelector(selector);
const sidebarKey = "souls-monitor-sidebar";
let loadingCount = 0;
let chartCounter = 0;

const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const number = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? "—" : new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(Number(value));
const percent = (value) => value == null || !Number.isFinite(Number(value)) ? "Sin datos" : `${number(value, 1)}%`;
const bytes = (value) => { if (value == null || !Number.isFinite(Number(value))) return "Sin datos"; const units = ["B", "KB", "MB", "GB", "TB"]; let index = 0; let current = Number(value); while (current >= 1000 && index < units.length - 1) { current /= 1000; index += 1; } return `${number(current, current < 10 && index > 0 ? 1 : 0)} ${units[index]}`; };
const date = (value) => value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "Sin timestamp";
const time = (value) => value ? new Intl.DateTimeFormat("es-CO", { timeStyle: "short" }).format(new Date(value)) : "Sin datos";
const healthLabel = (value) => ({ ok: "Operativo", warn: "Advertencia", critical: "Crítico", unknown: "Desconocido" }[value] || "Desconocido");
const healthClass = (value) => `status-${value || "unknown"}`;
const valueOrNoData = (value) => value == null || value === "" ? "Sin datos" : value;

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function setGlobalLoading(active, label = "Actualizando datos…") {
  loadingCount = Math.max(0, loadingCount + (active ? 1 : -1));
  const loader = $("#global-loader");
  const refresh = $("#refresh-button");
  if (!loader || !refresh) return;
  loader.hidden = loadingCount === 0;
  loader.setAttribute("aria-hidden", String(loadingCount === 0));
  $("#global-loader-label").textContent = label;
  refresh.classList.toggle("is-loading", loadingCount > 0);
  refresh.setAttribute("aria-busy", String(loadingCount > 0));
  app.setAttribute("aria-busy", String(loadingCount > 0));
}

async function withLoading(label, task) {
  setGlobalLoading(true, label);
  try { return await task(); } finally { setGlobalLoading(false); }
}

function routeParts() { return (location.hash.slice(1) || "dashboard").split("/"); }
function routeServiceId() { const parts = routeParts(); return parts[0] === "services" && parts[1] ? decodeURIComponent(parts[1]) : null; }

async function load() {
  if (state.loadPromise) return state.loadPromise;
  state.loading = true;
  state.error = null;
  state.loadPromise = withLoading("Actualizando monitor…", async () => {
    const query = `?range=${encodeURIComponent(state.range)}`;
    const [overview, history, alerts, errors, docs] = await Promise.all([
      getJson("/api/overview"), getJson(`/api/history${query}`), getJson(`/api/alerts${query}`), getJson(`/api/errors${query}`), getJson("/api/docs"),
    ]);
    state.overview = overview; state.history = history; state.alerts = alerts; state.errors = errors; state.docs = docs;
    state.detail = null; state.detailKey = "";
    render();
    if (routeServiceId()) void loadServiceDetail(routeServiceId());
  }).catch((error) => { state.error = error; render(); }).finally(() => { state.loading = false; state.loadPromise = null; });
  return state.loadPromise;
}

async function loadServiceDetail(id) {
  const key = `${id}:${state.range}`;
  if (state.detailKey === key && state.detail) return state.detail;
  if (state.detailLoadingKey === key) return null;
  state.detailLoadingKey = key; state.detailError = null; render();
  try {
    const detail = await withLoading("Cargando detalle del servicio…", () => getJson(`/api/services/${encodeURIComponent(id)}?range=${encodeURIComponent(state.range)}`));
    state.detail = detail; state.detailKey = key; return detail;
  } catch (error) { state.detail = null; state.detailError = error; return null; }
  finally { state.detailLoadingKey = ""; render(); }
}

function stale(timestamp) { return !timestamp || Date.now() - new Date(timestamp).getTime() > 3 * 60 * 1000; }
function kpi(label, value, meta, source, className = "") { const tooltip = `${source || "Fuente no disponible"} · ${meta || "Sin detalle"}`; return `<article class="kpi" title="${esc(tooltip)}"><div class="kpi-label"><span>${esc(label)}</span><span class="kpi-help" aria-hidden="true">i</span></div><div class="kpi-value ${className}">${value}</div><div class="kpi-meta">${esc(meta || "Sin datos")}</div></article>`; }
function section(title, note, content, className = "") { return `<section class="page-section ${className}"><div class="section-head"><div><h2>${esc(title)}</h2>${note ? `<p>${esc(note)}</p>` : ""}</div></div>${content}</section>`; }

function serviceCard(service) {
  const probe = service.probe; const latest = probe?.checkedAt || state.overview?.host?.generatedAt;
  return `<article class="card service-card" data-service="${esc(service.id)}" role="button" tabindex="0" aria-label="Ver detalle de ${esc(service.name)}" title="Fuente: ${esc(probe?.url || service.kind)} · Muestra: ${esc(date(latest))}"><div class="service-top"><div><div class="service-name">${esc(service.name)}</div><div class="service-env">${esc(service.environment)} · ${esc(service.kind)}</div></div><span class="pill ${healthClass(service.health)}">${healthLabel(service.health)}</span></div><div class="service-details"><div><span class="metric-label">Proceso</span><span class="metric-value">${esc(valueOrNoData(service.processStatus))}</span></div><div><span class="metric-label">Probe</span><span class="metric-value">${probe ? (probe.ok ? `${number(probe.latencyMs)} ms` : "Fallido") : "Sin datos"}</span></div><div><span class="metric-label">Muestra</span><span class="metric-value">${stale(latest) ? "Obsoleta" : esc(time(latest))}</span></div></div></article>`;
}

function serviceGroup(environment, services) {
  if (!services.length) return "";
  const title = environment === "production" ? "Producción" : environment === "development" ? "Desarrollo" : "Infraestructura";
  return `<div class="service-group"><div class="service-group-head"><h3>${title}</h3><span>${services.length} ${services.length === 1 ? "servicio" : "servicios"}</span></div><div class="service-grid">${services.map(serviceCard).join("")}</div></div>`;
}
function groupServices(services) { return `<div class="service-groups">${["production", "development", "infrastructure"].map((environment) => serviceGroup(environment, services.filter((service) => service.environment === environment))).join("")}</div>`; }

function downsample(points, maximum = 120) {
  if (points.length <= maximum) return points;
  const result = []; for (let index = 0; index < maximum; index += 1) result.push(points[Math.round(index * (points.length - 1) / (maximum - 1))]);
  return result.filter((point, index) => index === 0 || point.timestamp !== result[index - 1].timestamp);
}

function chart(title, points, formatter, options = {}) {
  const valid = points.filter((point) => point.value != null && Number.isFinite(Number(point.value)));
  if (!valid.length) return `<article class="card chart-card"><div class="section-head"><h2>${esc(title)}</h2></div><div class="empty">Sin datos históricos en este rango.</div></article>`;
  const visible = downsample(valid); const width = 720; const height = 180; const values = visible.map((point) => Number(point.value)); const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
  const plotted = visible.map((point, index) => ({ ...point, x: (index / Math.max(visible.length - 1, 1)) * width, y: height - 12 - ((Number(point.value) - min) / span) * (height - 24) }));
  const id = `chart-${++chartCounter}`; const coords = plotted.map((point) => `${point.x},${point.y}`).join(" "); const latest = valid[valid.length - 1]; const source = options.source || "SQLite histórico"; const unit = options.unit || ""; const data = esc(JSON.stringify(plotted.map((point) => ({ timestamp: point.timestamp, value: Number(point.value), x: point.x, y: point.y }))));
  return `<article class="card chart-card"><div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(formatter(latest.value))} · ${esc(time(latest.timestamp))}</p></div><span class="source-note">${esc(source)}</span></div><div class="chart-shell" data-chart-points='${data}' data-chart-source="${esc(source)}" data-chart-unit="${esc(unit)}"><svg id="${id}" class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" tabindex="0"><title>${esc(title)}: ${esc(formatter(latest.value))}</title><line class="chart-grid" x1="0" y1="25" x2="${width}" y2="25"/><line class="chart-grid" x1="0" y1="90" x2="${width}" y2="90"/><line class="chart-grid" x1="0" y1="155" x2="${width}" y2="155"/><line class="chart-crosshair" x1="0" y1="8" x2="0" y2="${height - 8}" hidden/><circle class="chart-point" cx="0" cy="0" r="4" hidden/><polyline points="${coords}"/><rect class="chart-hit-area" x="0" y="0" width="${width}" height="${height}"/></svg><div class="chart-tooltip" role="tooltip" hidden></div></div><div class="chart-labels"><span>${esc(time(valid[0].timestamp))}</span><span>${esc(time(latest.timestamp))}</span></div></article>`;
}

function attachCharts() {
  document.querySelectorAll("[data-chart-points]").forEach((shell) => {
    const svg = shell.querySelector("svg"); const hitArea = shell.querySelector(".chart-hit-area"); const tooltip = shell.querySelector(".chart-tooltip"); const crosshair = shell.querySelector(".chart-crosshair"); const marker = shell.querySelector(".chart-point"); const points = JSON.parse(shell.dataset.chartPoints || "[]"); let activeIndex = points.length - 1;
    const show = (index, clientX = null) => {
      if (!points.length) return; activeIndex = Math.max(0, Math.min(points.length - 1, index)); const point = points[activeIndex]; const rect = svg.getBoundingClientRect(); const xRatio = point.x / 720; const x = clientX == null ? xRatio * rect.width : Math.max(0, Math.min(rect.width, clientX - rect.left));
      crosshair.setAttribute("x1", String(point.x)); crosshair.setAttribute("x2", String(point.x)); crosshair.hidden = false; marker.setAttribute("cx", String(point.x)); marker.setAttribute("cy", String(point.y)); marker.hidden = false;
      const formatter = shell.dataset.chartUnit === "%" ? percent : shell.dataset.chartUnit === "ms" ? (value) => `${number(value)} ms` : shell.dataset.chartUnit === "bytes" ? bytes : (value) => number(value);
      tooltip.innerHTML = `<strong>${esc(date(point.timestamp))}</strong><span>${esc(formatter(point.value))}</span><small>${esc(shell.dataset.chartSource || "Fuente no disponible")}</small>`; tooltip.hidden = false; tooltip.style.left = `${Math.max(8, Math.min(rect.width - 150, x + 10))}px`; tooltip.style.top = `${Math.max(18, Math.min(rect.height - 18, (point.y / 180) * rect.height))}px`;
    };
    hitArea.addEventListener("pointermove", (event) => { const rect = svg.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); show(Math.round(ratio * (points.length - 1)), event.clientX); });
    hitArea.addEventListener("pointerleave", () => { if (document.activeElement !== svg) { tooltip.hidden = true; crosshair.hidden = true; marker.hidden = true; } });
    svg.addEventListener("focus", () => show(activeIndex)); svg.addEventListener("blur", () => { tooltip.hidden = true; crosshair.hidden = true; marker.hidden = true; });
    svg.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); if (event.key === "ArrowLeft") activeIndex -= 1; if (event.key === "ArrowRight") activeIndex += 1; if (event.key === "Home") activeIndex = 0; if (event.key === "End") activeIndex = points.length - 1; show(activeIndex); });
  });
}

function alertList(alerts) { if (!alerts?.length) return `<div class="empty">Sin datos de alertas.</div>`; return `<div class="alert-list">${alerts.slice(0, 8).map((alert) => `<div class="alert"><i class="alert-marker ${esc(alert.severity)}"></i><div><strong>${esc(alert.title)}</strong><span>${esc(alert.message)} · ${esc(date(alert.timestamp))}</span></div></div>`).join("")}</div>`; }
function table(headers, rows, empty = "Sin datos disponibles.") { return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`; }

function dashboard() {
  const overview = state.overview || {}; const services = overview.services || []; const host = overview.host || {}; const traffic = overview.nginx || {}; const total = services.length; const healthy = services.filter((service) => service.health === "ok").length; const last = host.generatedAt; const memory = host.memory?.usedPercent; const disk = host.disks?.find((item) => item.mount === "/") || host.disks?.[0]; const errorRate = state.errors?.errorRate; const gpu = host.gpu?.utilizationPercent;
  const resources = [
    kpi("RAM del host", memory != null ? percent(memory) : "Sin datos", host.memory ? `${bytes(host.memory.usedBytes)} usados · ${bytes(host.memory.totalBytes)} total` : "Fuente no disponible", `Collector · ${date(last)}`, memory >= 85 ? "status-critical" : memory >= 75 ? "status-warn" : ""),
    kpi("Disco principal", disk?.usedPercent != null ? percent(disk.usedPercent) : "Sin datos", disk ? `${bytes(disk.usedBytes)} usados · ${disk.mount}` : "Fuente no disponible", `Collector · ${date(last)}`, disk?.usedPercent >= 90 ? "status-critical" : disk?.usedPercent >= 75 ? "status-warn" : ""),
    kpi("CPU del host", host.cpuPercent != null ? percent(host.cpuPercent) : "Sin datos", host.loadAverage?.length ? `Carga ${number(host.loadAverage[0], 2)}` : "Fuente no disponible", `Collector · ${date(last)}`),
  ];
  if (gpu != null) resources.push(kpi("GPU del host", percent(gpu), host.gpu.memoryUsedBytes != null ? `${bytes(host.gpu.memoryUsedBytes)} de ${bytes(host.gpu.memoryTotalBytes)}` : "Utilización actual", `Collector · ${date(last)}`));
  const operational = [kpi("Servicios operativos", total ? `${healthy}/${total}` : "Sin datos", total ? "Catálogo monitorizado" : "Fuente no disponible", `Collector · ${date(last)}`, healthy === total && total ? "status-ok" : "status-warn"), kpi("Requests observadas", traffic.totalRequests != null ? number(traffic.totalRequests) : "Sin datos", traffic.analyzedLines != null ? `${number(traffic.analyzedLines)} líneas analizadas` : "Fuente no disponible", `Nginx · ${date(last)}`), kpi("Tasa de error", errorRate != null ? `${number(errorRate, 2)}%` : "Sin datos", state.errors?.totalRequests != null ? `${number(state.errors.totalRequests)} requests en SQLite` : "Fuente no disponible", `SQLite · ${date(last)}`, errorRate > 5 ? "status-critical" : "")];
  const freshness = stale(last) ? "Obsoleto" : `Actualizado ${time(last)}`;
  return `<div class="dashboard-stack">${section("Recursos del host", `RAM, disco y CPU · ${freshness}`, `<div class="kpi-grid resource-kpis">${resources.join("")}</div>`)}${section("Indicadores operativos", "Estado general del monitor y sus servicios", `<div class="kpi-grid operational-kpis">${operational.join("")}</div>`)}${section("Salud por entorno", "Cada tarjeta conserva proceso, probe y timestamp", groupServices(services))}<div class="grid-2 chart-row">${chart("CPU del host", (state.history?.host || []).map((item) => ({ timestamp: item.timestamp, value: item.cpuPercent })), (value) => percent(value), { unit: "%" })}${chart("Requests por minuto", (state.history?.traffic || []).map((item) => ({ timestamp: item.timestamp, value: item.requests })), (value) => number(value), { unit: "" })}</div><div class="grid-2 content-row">${section("Alertas recientes", "Generadas por señales reales", `<article class="card">${alertList(state.alerts?.alerts || overview.alerts || [])}</article>`)}${section("Fuente de la muestra", "Trazabilidad operativa", `<article class="card source-card"><p class="muted">Host: <strong>${esc(host.hostname || "Sin datos")}</strong></p><p class="muted">Última muestra: <strong>${esc(date(last))}</strong></p><p class="muted">Retención histórica: <strong>7 días</strong></p></article>`)}</div></div>`;
}
function servicesView() { const services = state.overview?.services || []; return section("Servicios catalogados", "Haz clic en una tarjeta para abrir su dashboard interno", services.length ? groupServices(services) : `<div class="empty">Sin datos de servicios.</div>`); }
function alertsView() { return section("Alertas", `Rango ${state.range}`, `<article class="card">${alertList(state.alerts?.alerts || [])}</article>`); }
function trafficView() { const nginx = state.overview?.nginx || {}; const top = nginx.topRoutes || []; const rows = top.map((route) => `<tr><td>${esc(route.route)}</td><td>${number(route.requests)}</td><td>${bytes(route.bytes)}</td><td>${route.averageRequestTimeMs == null ? "Sin datos" : `${number(route.averageRequestTimeMs)} ms`}</td><td>${number(route.error4xx + route.error5xx)}</td></tr>`); return `${section("Tráfico y latencia", "Logs de acceso Nginx + rollups SQLite", `<div class="grid-2 chart-row">${chart("Requests por minuto", (state.history?.traffic || []).map((item) => ({ timestamp: item.timestamp, value: item.requests })), (value) => number(value), { unit: "" })}${chart("Latencia media", (state.history?.traffic || []).map((item) => ({ timestamp: item.timestamp, value: item.averageRequestTimeMs })), (value) => `${number(value)} ms`, { unit: "ms" })}</div>`)}<article class="card table-wrap traffic-table">${table(["Ruta", "Requests", "Bytes", "Latencia", "Errores"], rows, "Sin datos de tráfico.")}</article>`; }

function serviceDetailView(id) {
  if (state.detailLoadingKey || !state.detail || state.detailKey !== `${id}:${state.range}`) return `<div class="loading-state">${state.detailError ? `No fue posible cargar el detalle.<br><small>${esc(state.detailError.message)}</small>` : "Cargando detalle del servicio…"}</div>`;
  const detail = state.detail; const service = detail.service; if (!service) return `<div class="error-state">Fuente no disponible para este servicio.</div>`;
  const latest = service.probe?.checkedAt || state.overview?.host?.generatedAt; const buckets = detail.history.buckets || []; const traffic = detail.history.traffic || []; const routes = detail.routes || []; const storage = detail.storage || [];
  const runtimeRows = [`<tr><td>Proceso</td><td>${esc(valueOrNoData(service.processStatus))}</td></tr>`, `<tr><td>PID</td><td>${valueOrNoData(service.pid)}</td></tr>`, `<tr><td>Puerto</td><td>${valueOrNoData(service.port)}</td></tr>`, `<tr><td>Reinicios</td><td>${valueOrNoData(service.restarts)}</td></tr>`, `<tr><td>Uptime</td><td>${service.uptimeMs == null ? "Sin datos" : esc(formatUptime(service.uptimeMs))}</td></tr>`];
  const probeMeta = service.probe ? `${service.probe.ok ? "OK" : "Fallido"} · ${service.probe.latencyMs == null ? "Sin latencia" : `${number(service.probe.latencyMs)} ms`} · HTTP ${valueOrNoData(service.probe.statusCode)}` : "Fuente no disponible";
  return `<div class="service-detail-page"><a class="back-link" href="#services">← Volver a servicios</a><article class="card detail-header"><div class="detail-heading"><div><p class="eyebrow">${esc(service.environment)} · ${esc(service.kind)}</p><h2>${esc(service.name)}</h2><p class="muted">Detalle operativo con fuentes reales del collector.</p></div><div class="detail-actions"><span class="pill ${healthClass(service.health)}">${healthLabel(service.health)}</span>${service.url ? `<a class="button secondary" href="${esc(service.url)}" target="_blank" rel="noopener noreferrer"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Abrir sitio</span></a>` : ""}</div></div><div class="detail-url">${service.url ? esc(service.url) : "URL no configurada"}</div><div class="detail-summary"><div><span class="metric-label">Probe</span><strong>${esc(probeMeta)}</strong></div><div><span class="metric-label">Muestra</span><strong>${stale(latest) ? "Obsoleta" : esc(date(latest))}</strong></div><div><span class="metric-label">CPU</span><strong>${service.cpuPercent == null ? "Sin datos" : percent(service.cpuPercent)}</strong></div><div><span class="metric-label">Memoria</span><strong>${bytes(service.memoryBytes)}</strong></div></div></article>${section("Performance", `Históricos reales · ${state.range}`, `<div class="grid-2 chart-row">${chart("CPU del servicio", buckets.map((item) => ({ timestamp: item.timestamp, value: item.cpuPercent })), (value) => percent(value), { unit: "%" })}${chart("Memoria del servicio", buckets.map((item) => ({ timestamp: item.timestamp, value: item.memoryBytes })), (value) => bytes(value), { unit: "bytes" })}</div><article class="card runtime-card">${table(["Campo", "Valor"], runtimeRows)}</article>`)}${section("Tráfico HTTP", "Rutas y rollups del servicio", `<div class="grid-2 chart-row">${chart("Requests por minuto", traffic.map((item) => ({ timestamp: item.timestamp, value: item.requests })), (value) => number(value), { unit: "" })}${chart("Latencia media", traffic.map((item) => ({ timestamp: item.timestamp, value: item.averageRequestTimeMs })), (value) => `${number(value)} ms`, { unit: "ms" })}</div><article class="card table-wrap traffic-table">${table(["Ruta", "Requests", "Bytes", "Latencia", "Errores"], routes.map((route) => `<tr><td>${esc(route.route)}</td><td>${number(route.requests)}</td><td>${bytes(route.bytes)}</td><td>${route.averageRequestTimeMs == null ? "Sin datos" : `${number(route.averageRequestTimeMs)} ms`}</td><td>${number(route.errors)}</td></tr>`), "Sin datos de tráfico para este servicio.")}</article>`)}<div class="grid-2 content-row">${section("Alertas y errores", "Filtrados por servicio", `<article class="card">${alertList(detail.alerts?.alerts || [])}<div class="detail-error-rate">Tasa de error: <strong>${detail.errors?.errorRate == null ? "Sin datos" : `${number(detail.errors.errorRate, 2)}%`}</strong></div></article>`)}${section("Almacenamiento", "Rutas configuradas para el servicio", `<article class="card">${table(["Ruta", "Tamaño"], storage.map((item) => `<tr><td><code>${esc(item.path)}</code></td><td>${bytes(item.bytes)}</td></tr>`), "Sin datos de almacenamiento.")}</article>`)}</div></div>`;
}

function renderMarkdown(markdown) {
  let html = ""; let inCode = false; let code = []; let listType = null; let tableRows = [];
  const lines = markdown.replace(/^---[\s\S]*?---\s*/, "").split("\n"); const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } }; const flushTable = () => { if (!tableRows.length) return; const rows = tableRows.map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim())); const hasHeader = rows.length > 1 && rows[1].every((cell) => /^:?-{3,}:?$/.test(cell)); const header = hasHeader ? rows.shift() : null; if (hasHeader) rows.shift(); html += "<table>"; if (header) html += `<thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`; html += `<tbody>${rows.filter((row) => row.some(Boolean)).map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`; tableRows = []; };
  for (const raw of lines) { const rawLine = raw.trimEnd(); const line = inCode ? rawLine : rawLine.trim(); if (line.startsWith("```")) { if (inCode) { html += `<pre><code>${esc(code.join("\n"))}</code></pre>`; code = []; inCode = false; } else { closeList(); flushTable(); inCode = true; } continue; } if (inCode) { code.push(line); continue; } if (/^\|/.test(line)) { closeList(); tableRows.push(line); continue; } flushTable(); if (!line) { closeList(); continue; } if (line.startsWith("### ")) { closeList(); html += `<h3>${inline(line.slice(4))}</h3>`; } else if (line.startsWith("## ")) { closeList(); html += `<h2>${inline(line.slice(3))}</h2>`; } else if (line.startsWith("# ")) { closeList(); html += `<h1>${inline(line.slice(2))}</h1>`; } else if (/^- /.test(line)) { if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; } html += `<li>${inline(line.slice(2))}</li>`; } else if (/^\d+\. /.test(line)) { if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; } html += `<li>${inline(line.replace(/^\d+\. /, ""))}</li>`; } else if (/^> /.test(line)) { closeList(); html += `<blockquote>${inline(line.slice(2))}</blockquote>`; } else { closeList(); html += `<p>${inline(line)}</p>`; } }
  if (inCode) html += `<pre><code>${esc(code.join("\n"))}</code></pre>`; flushTable(); closeList(); return html;
}
function inline(value) { return esc(value).replace(/!\[([^\]]+)\]\((\/assets\/[A-Za-z0-9._/-]+)\)/g, '<img src="$2" alt="$1" loading="lazy" style="max-width:100%;border:1px solid var(--line);border-radius:8px">').replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>'); }
function docsView() { const docs = state.docs || []; const selected = state.doc || docs[0]; if (!selected) return section("Documentación", "Markdown versionado", `<div class="empty">Sin documentación disponible.</div>`); return `<div class="docs-layout"><aside class="doc-list">${docs.map((doc) => `<a class="doc-link ${selected.slug === doc.slug ? "active" : ""}" href="#docs/${esc(doc.slug)}">${esc(doc.title)}<small>${esc(doc.category)}</small></a>`).join("")}</aside><article class="card doc-content"><div class="doc-toolbar"><div><div class="eyebrow">${esc(selected.category)}</div><div class="source-note">${esc(selected.description)}</div></div><a class="button primary download-button" href="/api/docs/${encodeURIComponent(selected.slug)}.md" title="Descargar Markdown"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Descargar</span></a></div>${renderMarkdown(selected.markdown)}</article></div>`; }

function bindServiceCards() { document.querySelectorAll("[data-service]").forEach((card) => { const open = () => { location.hash = `services/${encodeURIComponent(card.dataset.service)}`; }; card.addEventListener("click", open); card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }); }); }

function render() {
  const parts = (location.hash.slice(1) || "dashboard").split("/"); const view = parts[0]; const detailId = view === "services" && parts[1] ? decodeURIComponent(parts[1]) : null; chartCounter = 0;
  const titles = { dashboard: ["Resumen del sistema", "Estado consolidado de servicios, host y tráfico."], services: [detailId ? "Detalle del servicio" : "Servicios", detailId ? "Performance, tráfico y fuentes del servicio." : "Catálogo vivo por ambiente y fuente."], alerts: ["Alertas", "Incidentes y umbrales detectados por el collector."], traffic: ["Tráfico", "Requests, errores y latencia desde Nginx."], docs: ["Documentación", "Guías operativas versionadas y descargables."] };
  const title = titles[view] || titles.dashboard; $("#page-title").textContent = title[0]; $("#page-subtitle").textContent = title[1]; document.querySelectorAll(".nav a").forEach((link) => link.classList.toggle("active", link.dataset.view === view)); $("#refresh-label").textContent = "· 30 s";
  if (state.error && !state.overview) app.innerHTML = `<div class="error-state">Fuente no disponible.<br><small>${esc(state.error.message)}</small></div>`;
  else if (view === "services" && detailId) app.innerHTML = serviceDetailView(detailId);
  else if (view === "services") app.innerHTML = servicesView();
  else if (view === "alerts") app.innerHTML = alertsView();
  else if (view === "traffic") app.innerHTML = trafficView();
  else if (view === "docs") { const docs = state.docs || []; const slug = parts[1] || docs[0]?.slug; state.doc = state.doc?.slug === slug && state.doc.markdown ? state.doc : docs.find((doc) => doc.slug === slug) || null; app.innerHTML = state.doc && !state.doc.markdown ? `<div class="docs-layout"><aside class="doc-list">${docs.map((doc) => `<a class="doc-link ${state.doc.slug === doc.slug ? "active" : ""}" href="#docs/${esc(doc.slug)}">${esc(doc.title)}<small>${esc(doc.category)}</small></a>`).join("")}</aside><article class="card empty">Cargando guía…</article></div>` : docsView(); if (state.doc && !state.doc.markdown) void loadDoc(state.doc.slug); }
  else app.innerHTML = state.overview ? dashboard() : `<div class="loading-state">Cargando señales operativas…</div>`;
  attachCharts(); bindServiceCards();
  if (view === "services" && detailId && !state.detail && !state.detailLoadingKey && state.overview) void loadServiceDetail(detailId);
}

async function loadDoc(slug) { try { state.doc = await withLoading("Cargando documentación…", () => getJson(`/api/docs/${encodeURIComponent(slug)}`)); } catch { state.doc = null; } finally { render(); } }
function formatUptime(value) { const totalMinutes = Math.max(0, Math.round(Number(value) / 60000)); const days = Math.floor(totalMinutes / 1440); const hours = Math.floor((totalMinutes % 1440) / 60); const minutes = totalMinutes % 60; return `${days}d ${hours}h ${minutes}m`; }

function setupSidebar() {
  const mobileQuery = window.matchMedia("(max-width: 720px)"); let sidebarOpen = !mobileQuery.matches && localStorage.getItem(sidebarKey) !== "collapsed";
  const sync = () => { const mobile = mobileQuery.matches; document.body.classList.toggle("sidebar-collapsed", !mobile && !sidebarOpen); document.body.classList.toggle("mobile-sidebar-open", mobile && sidebarOpen); $("#sidebar-toggle").setAttribute("aria-expanded", String(sidebarOpen)); $("#sidebar-toggle").setAttribute("aria-label", mobile ? "Cerrar menú" : sidebarOpen ? "Contraer menú" : "Expandir menú"); $("#mobile-menu-toggle").setAttribute("aria-expanded", String(mobile && sidebarOpen)); };
  const setOpen = (open, persist = true) => { sidebarOpen = open; if (persist && !mobileQuery.matches) localStorage.setItem(sidebarKey, open ? "open" : "collapsed"); sync(); };
  $("#sidebar-toggle").addEventListener("click", () => setOpen(!sidebarOpen)); $("#mobile-menu-toggle").addEventListener("click", () => setOpen(true, false)); $("#sidebar-backdrop").addEventListener("click", () => setOpen(false, false)); document.querySelectorAll(".nav a").forEach((link) => link.addEventListener("click", () => { if (mobileQuery.matches) setOpen(false, false); })); mobileQuery.addEventListener("change", () => { sidebarOpen = !mobileQuery.matches && localStorage.getItem(sidebarKey) !== "collapsed"; sync(); }); sync();
}

setupSidebar(); $("#range-select").addEventListener("change", (event) => { state.range = event.target.value; state.detail = null; state.detailKey = ""; load(); }); $("#refresh-button").addEventListener("click", () => load()); window.addEventListener("hashchange", render); render(); load(); setInterval(load, 30_000);
