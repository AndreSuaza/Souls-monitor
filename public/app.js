const fmtBytes = (value) => {
  if (value == null || Number.isNaN(value)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const fmtPercent = (value) => (value == null || Number.isNaN(value) ? "-" : `${value.toFixed(1)}%`);
const qs = (id) => document.getElementById(id);

function setBar(id, percent) {
  qs(id).style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
}

function row(title, subtitle, value, className = "") {
  return `
    <div class="row">
      <div class="row-main">
        <strong>${title}</strong>
        <span class="cell-muted">${subtitle || ""}</span>
      </div>
      <div class="row-value ${className}">${value}</div>
    </div>
  `;
}

function render(data) {
  const generated = new Date(data.host.generatedAt);
  qs("freshness").textContent = `Actualizado ${generated.toLocaleTimeString()}`;
  qs("ram").textContent = fmtPercent(data.host.memory.usedPercent);
  setBar("ramBar", data.host.memory.usedPercent);
  const mainDisk = data.host.disks[0];
  qs("disk").textContent = mainDisk ? fmtPercent(mainDisk.usedPercent) : "-";
  setBar("diskBar", mainDisk?.usedPercent || 0);
  qs("requests").textContent = data.nginx.totalRequests.toLocaleString("es-CO");
  qs("bytes").textContent = `${fmtBytes(data.nginx.totalBytes)} servidos`;
  qs("servicesCount").textContent = data.services.filter((service) => /online|running/i.test(service.status)).length;

  qs("alerts").innerHTML = data.alerts
    .map((alert) => `<div class="alert ${alert.severity}"><strong>${alert.title}</strong><span>${alert.message}</span></div>`)
    .join("");

  qs("services").innerHTML = data.services
    .map((service) => {
      const statusClass = /online|running/i.test(service.status) ? "good" : "bad";
      const usage = `${fmtPercent(service.cpuPercent)} CPU · ${fmtBytes(service.memoryBytes)}`;
      return row(service.name, `${service.kind} · ${usage}`, service.status, statusClass);
    })
    .join("");

  qs("routes").innerHTML = data.nginx.topRoutes
    .slice(0, 12)
    .map((route) => row(route.route, `${route.requests} req · ${route.error4xx} 4xx · ${route.error5xx} 5xx`, fmtBytes(route.bytes)))
    .join("");

  qs("statuses").innerHTML = Object.entries(data.nginx.statusCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([status, count]) => `<span class="chip">${status}: ${count}</span>`)
    .join("");

  qs("storage").innerHTML = data.storage.paths
    .map((item) => row(item.path, "", fmtBytes(item.bytes)))
    .join("");

  qs("userAgents").innerHTML = data.nginx.suspiciousUserAgents.length
    ? data.nginx.suspiciousUserAgents.map((ua) => row(ua.userAgent, "", `${ua.requests} req`, "warn-text")).join("")
    : row("Sin user agents sospechosos", "En la ventana analizada", "OK", "good");
}

async function load() {
  try {
    const response = await fetch("/api/overview", { cache: "no-store" });
    const data = await response.json();
    render(data);
  } catch (error) {
    qs("freshness").textContent = "Sin datos";
    qs("alerts").innerHTML = `<div class="alert critical"><strong>No se pudo leer el monitor</strong><span>${error.message}</span></div>`;
  }
}

load();
setInterval(load, 30000);
