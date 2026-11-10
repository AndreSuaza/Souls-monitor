const state = { overview: null, history: null, alerts: null, errors: null, docs: [], view: location.hash.slice(1) || "dashboard", range: "24h", doc: null, docLoading: false, loading: true };
const app = document.querySelector("#app");
const $ = (selector) => document.querySelector(selector);
const sidebarKey = "souls-monitor-sidebar";
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const number = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? "—" : new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(Number(value));
const percent = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : `${number(value, 1)}%`;
const bytes = (value) => { if (value == null || !Number.isFinite(Number(value))) return "—"; const units = ["B", "KB", "MB", "GB", "TB"]; let index = 0; let current = Number(value); while (current >= 1000 && index < units.length - 1) { current /= 1000; index += 1; } return `${number(current, current < 10 && index > 0 ? 1 : 0)} ${units[index]}`; };
const date = (value) => value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "Sin timestamp";
const time = (value) => value ? new Intl.DateTimeFormat("es-CO", { timeStyle: "short" }).format(new Date(value)) : "—";
const healthLabel = (value) => ({ ok: "Operativo", warn: "Advertencia", critical: "Crítico", unknown: "Desconocido" }[value] || "Desconocido");

async function getJson(url) { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json(); }
async function load() {
  state.loading = true;
  try {
    const query = `?range=${encodeURIComponent(state.range)}`;
    const [overview, history, alerts, errors, docs] = await Promise.all([getJson("/api/overview"), getJson(`/api/history${query}`), getJson(`/api/alerts${query}`), getJson(`/api/errors${query}`), getJson("/api/docs")]);
    state.overview = overview; state.history = history; state.alerts = alerts; state.errors = errors; state.docs = docs;
    if (state.doc && !state.docs.some((doc) => doc.slug === state.doc.slug)) state.doc = null;
    render();
  } catch (error) { app.innerHTML = `<div class="error-state">Fuente no disponible.<br><small>${esc(error.message)}</small></div>`; }
  finally { state.loading = false; }
}

function statusClass(health) { return `status-${health || "unknown"}`; }
function stale(timestamp) { return !timestamp || Date.now() - new Date(timestamp).getTime() > 3 * 60 * 1000; }
function kpi(label, value, meta, className = "") { return `<article class="kpi" title="${esc(meta)}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value ${className}">${value}</div><div class="kpi-meta">${meta}</div></article>`; }
function section(title, note, content) { return `<section><div class="section-head"><div><h2>${esc(title)}</h2>${note ? `<p>${esc(note)}</p>` : ""}</div></div>${content}</section>`; }

function serviceCard(service) {
  const probe = service.probe;
  const latest = probe?.checkedAt || state.overview?.host?.generatedAt;
  return `<article class="card service-card" data-service="${esc(service.id)}" title="Fuente: ${esc(probe?.url || service.kind)} · Muestra: ${esc(date(latest))}"><div class="service-top"><div><div class="service-name">${esc(service.name)}</div><div class="service-env">${esc(service.environment)} · ${esc(service.kind)}</div></div><span class="pill ${statusClass(service.health)}">${healthLabel(service.health)}</span></div><div class="service-details"><div><span class="metric-label">Proceso</span><span class="metric-value">${esc(service.processStatus || "Sin datos")}</span></div><div><span class="metric-label">Probe</span><span class="metric-value">${probe ? (probe.ok ? `${number(probe.latencyMs)} ms` : "Fallido") : "Sin datos"}</span></div><div><span class="metric-label">Muestra</span><span class="metric-value">${stale(latest) ? "Obsoleta" : esc(time(latest))}</span></div></div></article>`;
}

function groupServices(services) { return ["production", "development", "infrastructure"].map((environment) => { const items = services.filter((service) => service.environment === environment); if (!items.length) return ""; const title = environment === "production" ? "Producción" : environment === "development" ? "Desarrollo" : "Infraestructura"; return section(title, `${items.length} servicios catalogados`, `<div class="service-grid">${items.map(serviceCard).join("")}</div>`); }).join(""); }

function chart(title, points, field, formatter) {
  const valid = points.filter((point) => point[field] != null && Number.isFinite(Number(point[field])));
  if (!valid.length) return `<article class="card chart-card"><div class="section-head"><h2>${esc(title)}</h2></div><div class="empty">Sin datos históricos en este rango.</div></article>`;
  const width = 720; const height = 180; const values = valid.map((point) => Number(point[field])); const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
  const coords = valid.map((point, index) => `${(index / Math.max(valid.length - 1, 1)) * width},${height - 12 - ((Number(point[field]) - min) / span) * (height - 24)}`).join(" ");
  const latest = valid[valid.length - 1];
  return `<article class="card chart-card"><div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(formatter(latest[field]))} · ${esc(time(latest.timestamp))}</p></div><span class="source-note">SQLite histórico</span></div><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}: ${esc(formatter(latest[field]))}</title><line class="chart-grid" x1="0" y1="25" x2="${width}" y2="25"/><line class="chart-grid" x1="0" y1="90" x2="${width}" y2="90"/><line class="chart-grid" x1="0" y1="155" x2="${width}" y2="155"/><polyline points="${coords}"/></svg><div class="chart-labels"><span>${esc(time(valid[0].timestamp))}</span><span>${esc(time(latest.timestamp))}</span></div></article>`;
}

function alertList(alerts) { if (!alerts?.length) return `<div class="empty">Sin datos de alertas.</div>`; return `<div class="alert-list">${alerts.slice(0, 8).map((alert) => `<div class="alert"><i class="alert-marker ${esc(alert.severity)}"></i><div><strong>${esc(alert.title)}</strong><span>${esc(alert.message)} · ${esc(date(alert.timestamp))}</span></div></div>`).join("")}</div>`; }

function dashboard() {
  const overview = state.overview || {}; const services = overview.services || []; const host = overview.host || {}; const traffic = overview.nginx || {}; const total = services.length; const healthy = services.filter((service) => service.health === "ok").length; const last = host.generatedAt;
  const errorRate = state.errors?.errorRate; const memory = host.memory?.usedPercent; const requests = traffic.totalRequests; const freshness = stale(last) ? "Obsoleto" : `Actualizado ${time(last)}`;
  return `${section("Indicadores principales", `Rango ${state.range} · ${freshness}`, `<div class="kpi-grid">${kpi("Servicios operativos", total ? `${healthy}/${total}` : "Sin datos", total ? "Catálogo monitorizado" : "Fuente no disponible", healthy === total && total ? "status-ok" : "")}${kpi("Requests observadas", requests != null ? number(requests) : "Sin datos", traffic.analyzedLines != null ? `${number(traffic.analyzedLines)} líneas analizadas` : "Sin datos")}${kpi("Tasa de error", errorRate != null ? `${number(errorRate, 2)}%` : "Sin datos", state.errors?.totalRequests != null ? `${number(state.errors.totalRequests)} requests en SQLite` : "Sin datos", errorRate > 5 ? "status-critical" : "")}${kpi("RAM del host", memory != null ? percent(memory) : "Sin datos", host.memory ? `${bytes(host.memory.usedBytes)} usados` : "Fuente no disponible", memory >= 85 ? "status-critical" : "")}</div>`)}${section("Salud por entorno", "Cada tarjeta conserva proceso, probe y timestamp", groupServices(services))}<div class="grid-2">${chart("CPU del host", (state.history?.host || []).map((item) => ({ ...item, value: item.cpuPercent })), "value", (value) => percent(value))}${chart("Requests por minuto", (state.history?.traffic || []).map((item) => ({ ...item, value: item.requests })), "value", (value) => number(value))}</div><div class="grid-2">${section("Alertas recientes", "Generadas por señales reales", `<article class="card">${alertList(state.alerts?.alerts || overview.alerts || [])}</article>`)}${section("Fuente de la muestra", "Trazabilidad operativa", `<article class="card"><p class="muted">Host: <strong>${esc(host.hostname || "Sin datos")}</strong></p><p class="muted">Última muestra: <strong>${esc(date(last))}</strong></p><p class="muted">Retención histórica: <strong>7 días</strong></p></article>`)}</div>`;
}

function servicesView() { const services = state.overview?.services || []; return `${section("Servicios catalogados", "Producción, desarrollo e infraestructura", `<div class="service-grid">${services.length ? services.map(serviceCard).join("") : `<div class="empty">Sin datos de servicios.</div>`}</div>`)}`; }
function alertsView() { return section("Alertas", `Rango ${state.range}`, `<article class="card">${alertList(state.alerts?.alerts || [])}</article>`); }
function trafficView() { const nginx = state.overview?.nginx || {}; const top = nginx.topRoutes || []; const rows = top.length ? top.map((route) => `<tr><td>${esc(route.route)}</td><td>${number(route.requests)}</td><td>${bytes(route.bytes)}</td><td>${number(route.averageRequestTimeMs)} ms</td><td>${number(route.error4xx + route.error5xx)}</td></tr>`).join("") : `<tr><td colspan="5">Sin datos de tráfico.</td></tr>`; return `${section("Tráfico y latencia", "Logs de acceso Nginx + rollups SQLite", `<div class="grid-2">${chart("Requests por minuto", (state.history?.traffic || []).map((item) => ({ ...item, value: item.requests })), "value", (value) => number(value))}${chart("Latencia media", (state.history?.traffic || []).map((item) => ({ ...item, value: item.averageRequestTimeMs })), "value", (value) => `${number(value)} ms`)}</div>`)}<article class="card table-wrap traffic-table"><table class="data-table"><thead><tr><th>Ruta</th><th>Requests</th><th>Bytes</th><th>Latencia</th><th>Errores</th></tr></thead><tbody>${rows}</tbody></table></article>`; }

function renderMarkdown(markdown) {
  let html = ""; let inCode = false; let code = []; let listType = null; let tableRows = [];
  const lines = markdown.replace(/^---[\s\S]*?---\s*/, "").split("\n");
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  const flushTable = () => {
    if (!tableRows.length) return;
    const rows = tableRows.map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
    const hasHeader = rows.length > 1 && rows[1].every((cell) => /^:?-{3,}:?$/.test(cell));
    const header = hasHeader ? rows.shift() : null;
    if (hasHeader) rows.shift();
    html += "<table>";
    if (header) html += `<thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`;
    html += `<tbody>${rows.filter((row) => row.some(Boolean)).map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    tableRows = [];
  };
  for (const raw of lines) {
    const rawLine = raw.trimEnd();
    const line = inCode ? rawLine : rawLine.trim();
    if (line.startsWith("```")) { if (inCode) { html += `<pre><code>${esc(code.join("\n"))}</code></pre>`; code = []; inCode = false; } else { closeList(); flushTable(); inCode = true; } continue; }
    if (inCode) { code.push(line); continue; }
    if (/^\|/.test(line)) { closeList(); tableRows.push(line); continue; }
    flushTable();
    if (!line) { closeList(); continue; }
    if (line.startsWith("### ")) { closeList(); html += `<h3>${inline(line.slice(4))}</h3>`; }
    else if (line.startsWith("## ")) { closeList(); html += `<h2>${inline(line.slice(3))}</h2>`; }
    else if (line.startsWith("# ")) { closeList(); html += `<h1>${inline(line.slice(2))}</h1>`; }
    else if (/^- /.test(line)) { if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; } html += `<li>${inline(line.slice(2))}</li>`; }
    else if (/^\d+\. /.test(line)) { if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; } html += `<li>${inline(line.replace(/^\d+\. /, ""))}</li>`; }
    else if (/^> /.test(line)) { closeList(); html += `<blockquote>${inline(line.slice(2))}</blockquote>`; }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  if (inCode) html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
  flushTable(); closeList(); return html;
}
function inline(value) { return esc(value).replace(/!\[([^\]]+)\]\((\/assets\/[A-Za-z0-9._/-]+)\)/g, '<img src="$2" alt="$1" loading="lazy" style="max-width:100%;border:1px solid var(--line);border-radius:8px">').replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>'); }
function docsView() { const docs = state.docs || []; const selected = state.doc || docs[0]; if (!selected) return section("Documentación", "Markdown versionado", `<div class="empty">Sin documentación disponible.</div>`); return `<div class="docs-layout"><aside class="doc-list">${docs.map((doc) => `<a class="doc-link ${selected.slug === doc.slug ? "active" : ""}" href="#docs/${esc(doc.slug)}">${esc(doc.title)}<small>${esc(doc.category)}</small></a>`).join("")}</aside><article class="card doc-content"><div class="doc-toolbar"><div><div class="eyebrow">${esc(selected.category)}</div><div class="source-note">${esc(selected.description)}</div></div><a class="button primary download-button" href="/api/docs/${encodeURIComponent(selected.slug)}.md" title="Descargar Markdown"><svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Descargar</span></a></div>${renderMarkdown(selected.markdown)}</article></div>`; }

async function loadDoc(slug) { if (state.docLoading || (state.doc?.slug === slug && state.doc?.markdown)) return; state.docLoading = true; try { state.doc = await getJson(`/api/docs/${encodeURIComponent(slug)}`); } catch { state.doc = null; } finally { state.docLoading = false; render(); } }
function render() {
  const route = location.hash.slice(1) || "dashboard"; const parts = route.split("/"); state.view = parts[0]; if (state.view === "docs") { const slug = parts[1] || state.docs[0]?.slug; state.doc = state.doc?.slug === slug && state.doc.markdown ? state.doc : state.docs.find((doc) => doc.slug === slug) || null; }
  const titles = { dashboard: ["Resumen del sistema", "Estado consolidado de servicios, host y tráfico."], services: ["Servicios", "Catálogo vivo por ambiente y fuente."], alerts: ["Alertas", "Incidentes y umbrales detectados por el collector."], traffic: ["Tráfico", "Requests, errores y latencia desde Nginx."], docs: ["Documentación", "Guías operativas versionadas y descargables."] }; const title = titles[state.view] || titles.dashboard; $("#page-title").textContent = title[0]; $("#page-subtitle").textContent = title[1]; document.querySelectorAll(".nav a").forEach((link) => link.classList.toggle("active", link.dataset.view === state.view)); $("#refresh-label").textContent = "· 30 s";
  if (state.view === "docs" && state.doc && !state.doc.markdown) app.innerHTML = `<div class="docs-layout"><aside class="doc-list">${state.docs.map((doc) => `<a class="doc-link ${state.doc.slug === doc.slug ? "active" : ""}" href="#docs/${esc(doc.slug)}">${esc(doc.title)}<small>${esc(doc.category)}</small></a>`).join("")}</aside><article class="card empty">Cargando guía…</article></div>`; else app.innerHTML = state.view === "services" ? servicesView() : state.view === "alerts" ? alertsView() : state.view === "traffic" ? trafficView() : state.view === "docs" ? docsView() : dashboard();
  if (state.view === "docs" && state.doc && !state.doc.markdown) void loadDoc(state.doc.slug);
  document.querySelectorAll("[data-service]").forEach((card) => card.addEventListener("click", () => { const service = state.overview?.services?.find((item) => item.id === card.dataset.service); if (service?.url) window.open(service.url, "_blank", "noopener"); }));
}

function setupSidebar() {
  const mobileQuery = window.matchMedia("(max-width: 720px)");
  let sidebarOpen = !mobileQuery.matches && localStorage.getItem(sidebarKey) !== "collapsed";
  const sync = () => {
    const mobile = mobileQuery.matches;
    document.body.classList.toggle("sidebar-collapsed", !mobile && !sidebarOpen);
    document.body.classList.toggle("mobile-sidebar-open", mobile && sidebarOpen);
    $("#sidebar-toggle").setAttribute("aria-expanded", String(sidebarOpen));
    $("#sidebar-toggle").setAttribute("aria-label", mobile ? "Cerrar menú" : sidebarOpen ? "Contraer menú" : "Expandir menú");
    $("#mobile-menu-toggle").setAttribute("aria-expanded", String(mobile && sidebarOpen));
  };
  const setOpen = (open, persist = true) => { sidebarOpen = open; if (persist && !mobileQuery.matches) localStorage.setItem(sidebarKey, open ? "open" : "collapsed"); sync(); };
  $("#sidebar-toggle").addEventListener("click", () => setOpen(!sidebarOpen));
  $("#mobile-menu-toggle").addEventListener("click", () => setOpen(true, false));
  $("#sidebar-backdrop").addEventListener("click", () => setOpen(false, false));
  document.querySelectorAll(".nav a").forEach((link) => link.addEventListener("click", () => { if (mobileQuery.matches) setOpen(false, false); }));
  mobileQuery.addEventListener("change", () => { sidebarOpen = !mobileQuery.matches && localStorage.getItem(sidebarKey) !== "collapsed"; sync(); });
  sync();
}

setupSidebar(); $("#range-select").addEventListener("change", (event) => { state.range = event.target.value; load(); }); $("#refresh-button").addEventListener("click", load); window.addEventListener("hashchange", render); load(); setInterval(load, 30_000);
