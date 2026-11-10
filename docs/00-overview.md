---
title: Manual de Souls Monitor
description: Cómo leer el panel, sus fuentes y sus estados de confianza.
category: Inicio
order: 10
---

# Manual de Souls Monitor

Souls Monitor consolida señales del host, procesos, probes HTTP, logs de Nginx e históricos SQLite. El panel no inventa valores: cuando una fuente no responde muestra **Sin datos**, **Obsoleto** o **Fuente no disponible**.

## Lectura rápida

1. Revisa el estado de Producción y Desarrollo.
2. Verifica la hora de la última muestra y la fuente de cada KPI.
3. Abre una tarjeta para revisar probe, proceso, latencia y tráfico.
4. Usa Alertas para priorizar incidentes y Documentación para operar.

## Estados

- **OK:** proceso y probe disponibles.
- **Advertencia:** la señal es parcial o hay respuestas 4xx/uso alto.
- **Crítico:** probe fallido, proceso inactivo o respuestas 5xx.
- **Desconocido:** no se pudo obtener una fuente.

## Fuentes

| Dato | Fuente | Retención |
| --- | --- | --- |
| Host | `/proc`, `df` | 7 días |
| Procesos | PM2, systemd, Docker | 7 días |
| Probes | HTTP/HTTPS configurado | 7 días |
| Tráfico | logs de acceso Nginx | 7 días |
| Alertas | SQLite | 90 días |

Cada documento se puede descargar desde el botón **Descargar Markdown**.
