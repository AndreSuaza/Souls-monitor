# Souls Monitor

Private dashboard for VPS, applications, services, and operational signals.

The collector runs separately from the web server. It reads host metrics, PM2,
Docker, HTTP probes, and Nginx logs, then writes a JSON snapshot and SQLite
history. The web server serves those sources and a lightweight static dashboard.

The service catalog lives in `src/services.ts`. It includes production,
development, and infrastructure services, including
`app-dev.soulsinxtinction.com` and `simulador-dev.soulsinxtinction.com`.

Documentation is versioned in `docs/`, validated during the build, rendered in
the private dashboard, and downloadable through `/api/docs/<slug>.md`.

## Local

```bash
npm install
npm run check
npm run build
npm test
npm run dev:collect
npm start
```

## VPS Layout

```text
/opt/apps/souls-monitor      app checkout
/opt/souls-monitor/runtime   generated metrics.json
127.0.0.1:3101               private dashboard
```

Use an SSH tunnel:

```powershell
ssh -i "$env:USERPROFILE\.ssh\codex_contabo" -L 3101:127.0.0.1:3101 deploy@209.145.63.84
```

Open:

```text
http://127.0.0.1:3101
```
