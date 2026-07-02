# Souls Monitor

Private dashboard for VPS, `app-souls`, and OpenClaw health/cost signals.

The collector runs separately from the web server. It reads host metrics, PM2,
Docker, and Nginx logs, then writes a JSON snapshot. The web server only serves
that snapshot and a static dashboard.

## Local

```bash
npm install
npm run build
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
