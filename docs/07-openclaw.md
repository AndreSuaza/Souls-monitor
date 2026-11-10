---
title: OpenClaw y automatizaciones
description: Límites operativos y fuentes que pueden observarse sin alterar el runtime.
category: Operación
order: 80
---

# OpenClaw

OpenClaw se observa como servicio Docker cuando el contenedor configurado está disponible. El monitor registra su estado, memoria, red y probe, pero no administra el contenedor.

## Checklist

- [ ] El contenedor aparece en `docker ps`.
- [ ] La ruta de datos tiene almacenamiento medible.
- [ ] La URL configurada responde con un timestamp reciente.
- [ ] Las automatizaciones tienen documentación y propietario.

Ante una alerta, conserva logs y contexto antes de reiniciar. Los cambios operativos deben seguir el proceso del equipo y no ejecutarse automáticamente desde la UI.
