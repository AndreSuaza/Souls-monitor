---
title: Arquitectura de Souls In Xtinction
description: Relación entre aplicaciones, servicios realtime, VPS y monitor.
category: Arquitectura
order: 40
---

# Arquitectura

![Diagrama de arquitectura operativa](/assets/architecture-overview.svg)

```mermaid
flowchart LR
  Browser --> Nginx
  Nginx --> AppProd[app-souls · PM2 · 3000]
  Nginx --> AppDev[app-souls-dev · PM2 · 3001]
  Nginx --> SimProd[simulador · systemd · 2567]
  Nginx --> SimDev[simulador-dev · systemd · 2568]
  Monitor[Souls Monitor · systemd · 3101] --> Proc[PM2 / systemd / Docker]
  Monitor --> Logs[Nginx access logs]
  Monitor --> SQLite[(monitor.sqlite)]
```

## Límites

- `app-souls` y `simulador-souls` son repositorios separados.
- `app-souls` mantiene los datos de usuarios, cartas, decks y torneos.
- El frontend del simulador no accede directamente a MongoDB.
- Souls Monitor solo lee las fuentes operativas y escribe su propia SQLite.

El catálogo de servicios vive en `src/services.ts`; cambiar un dominio, puerto o unidad debe hacerse allí y luego validarse con probes.
