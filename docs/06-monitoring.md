---
title: Cómo validar el monitor
description: Procedimiento para comprobar collector, API, SQLite, UI y estados sin datos.
category: Operación
order: 70
---

# Validar Souls Monitor

## Validación del repositorio

Desde `Souls-monitor`:

```bash
npm ci
npm run check
npm test
npm run build
node --check public/app.js
```

El build también valida el frontmatter de las guías y genera
`public/docs-manifest.json`.

## Validación local del servidor

```bash
HOST=127.0.0.1 PORT=3121 \
METRICS_PATH=./runtime/metrics.json \
SQLITE_PATH=./runtime/monitor.sqlite \
npm run dev
```

En otra terminal:

```bash
curl -fsS http://127.0.0.1:3121/healthz
curl -fsS http://127.0.0.1:3121/api/overview
curl -fsS 'http://127.0.0.1:3121/api/history?range=24h'
curl -fsS 'http://127.0.0.1:3121/api/alerts?range=24h'
curl -fsS http://127.0.0.1:3121/api/docs
curl -fI http://127.0.0.1:3121/api/docs/00-overview.md
```

En PowerShell, declara las variables con `$env:HOST`, `$env:PORT`,
`$env:METRICS_PATH` y `$env:SQLITE_PATH` antes de ejecutar `npm run dev`.

## Collector

El collector debe producir una muestra atómica, persistir host y servicios en
SQLite y conservar el timestamp de cada probe. Las fuentes que revisa son:

- `/proc` y `df` para host y disco.
- PM2 para `app-souls` y `app-souls-dev`.
- systemd para simuladores y monitor.
- Docker para OpenClaw.
- probes HTTP/HTTPS de cada servicio.
- logs de acceso Nginx y sus rollups.

Si una fuente no está disponible, el servicio sigue apareciendo catalogado con
estado **Desconocido**, **Crítico** o **Fuente no disponible** según las señales
restantes. No se deben crear valores sustitutos.

## Estados que deben probarse

- Sin histórico: la gráfica muestra `Sin datos históricos`.
- Probe caído: servicio crítico y mensaje de error de fuente.
- Proceso ausente con probe activo: advertencia o estado parcial.
- Datos antiguos: indicador `Obsoleto`.
- Log inexistente: tráfico sin datos, no cero inventado.
- Respuestas 4xx/5xx: error rate y alertas calculados desde rollups reales.
- Sin alertas: estado vacío explícito, no una alerta falsa.

## Endpoints

- `/healthz`: salud del proceso.
- `/api/overview`: snapshot actual.
- `/api/history?range=24h`: históricos SQLite.
- `/api/errors?range=24h`: grupos de estado y endpoints con error.
- `/api/alerts?range=24h`: alertas reales.
- `/api/docs`: índice de documentación.
- `/api/docs/<slug>`: Markdown renderizable de una guía.
- `/api/docs/<slug>.md`: descarga de la fuente Markdown.

## Validación posterior a un despliegue

1. Confirma que el workflow terminó en verde y registra su SHA.
2. Comprueba `systemctl is-active souls-monitor.service`.
3. Comprueba `curl http://127.0.0.1:3101/healthz` en la VPS.
4. Confirma que el collector generó una muestra reciente.
5. Confirma que dashboard, alertas, históricos y descargas responden.
6. Revisa los dominios públicos y el estado **Obsoleto** si la muestra no se
   actualiza.
