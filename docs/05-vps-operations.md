---
title: Operación de la VPS
description: Topología confirmada, comandos de inspección y diagnóstico sin mutaciones de datos.
category: Operación
order: 60
---

# Operación de la VPS

La siguiente topología fue contrastada por SSH de solo lectura durante la
revisión del monitor. Los directorios y puertos pueden cambiar en el futuro;
siempre confirma el estado real antes de intervenir.

## Topología operativa

| Componente | Ruta/unidad | Puerto interno | Runtime |
| --- | --- | --- | --- |
| App producción | `/opt/apps/app-souls` | 3000 | PM2 `app-souls` |
| App desarrollo | `/opt/apps/app-souls-dev` | 3001 | PM2 `app-souls-dev` |
| Simulador producción | `/opt/apps/souls-simulador/current` | 2567 | `souls-simulador.service` |
| Simulador desarrollo | `/opt/apps/souls-simulador-dev/current` | 2568 | `souls-simulador-dev.service` |
| Monitor | `/opt/apps/souls-monitor` | 3101 | `souls-monitor.service` |
| Datos del monitor | `/opt/souls-monitor/runtime` | — | JSON + SQLite |
| OpenClaw | `/opt/openclaw-hgga` | Docker | `openclaw-hgga-openclaw-1` |

Nginx termina TLS y enruta los dominios públicos a esos puertos locales. Los
logs de acceso observados incluyen:

```text
/var/log/nginx/app-souls.access.log
/var/log/nginx/app-souls-dev.access.log
/var/log/nginx/souls-simulador.access.log
/var/log/nginx/souls-simulador-dev.access.log
/var/log/nginx/souls-monitor.access.log
/var/log/nginx/openclaw.access.log
```

## Inspección segura

```bash
hostnamectl
ss -ltnp
systemctl --type=service --state=running
systemctl is-active souls-monitor.service souls-simulador.service souls-simulador-dev.service
pm2 list
docker ps
df -h
free -h
sudo nginx -t
```

Estos comandos sirven para leer estado. `nginx -t` solo valida la sintaxis; no
recarga ni modifica Nginx.

## Logs por componente

```bash
sudo journalctl -u souls-monitor.service --since "1 hour ago" --no-pager
sudo journalctl -u souls-simulador.service --since "1 hour ago" --no-pager
sudo journalctl -u souls-simulador-dev.service --since "1 hour ago" --no-pager
PM2_HOME=/home/deploy/.pm2 pm2 logs app-souls --lines 80 --nostream --no-color
PM2_HOME=/home/deploy/.pm2 pm2 logs app-souls-dev --lines 80 --nostream --no-color
sudo tail -n 100 /var/log/nginx/app-souls-dev.access.log
```

El monitor lee los logs configurados en `src/services.ts`. Si un archivo no
existe o no tiene líneas compatibles con el formato esperado, la UI debe
mostrar una fuente ausente o **Sin datos**, nunca rellenar valores.

## Despliegue que no refleja cambios

1. Comprueba el run de GitHub Actions y el SHA desplegado.
2. Comprueba la unidad o proceso correcto, no solo Nginx.
3. Revisa el timestamp de la muestra en Souls Monitor.
4. Comprueba la respuesta local antes del dominio público:

```bash
curl -fsS http://127.0.0.1:3000/ >/dev/null
curl -fsS http://127.0.0.1:3001/ >/dev/null
curl -fsS http://127.0.0.1:3101/healthz
timeout 2 bash -c '</dev/tcp/127.0.0.1/2568'
```

## Backups y cambios

Documenta destino, frecuencia, última verificación y responsable del backup.
No borres releases, no reinicies MongoDB y no cambies servicios desde el panel
de monitorización. Para operaciones de base de datos sigue el procedimiento
específico y confirma siempre el entorno antes de ejecutar una mutación.
