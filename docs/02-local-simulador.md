---
title: Ejecutar simulador en local
description: Levantar app-souls, el servidor realtime y el cliente web en el orden correcto.
category: Desarrollo local
order: 30
---

# Ejecutar `simulador-souls` en local

El simulador no es un único proceso. Para probar el flujo completo necesitas
tres piezas ejecutándose al mismo tiempo:

1. `app-souls` en `http://localhost:3000`.
2. `apps/game-server` en `127.0.0.1:2567`.
3. `apps/web` en `http://localhost:5173`.

El navegador habla con el cliente web; el cliente usa `app-souls` para auth/API
y abre la conexión realtime contra el game server. El cliente envía intenciones;
el servidor valida y aplica el estado.

## 1. Arrancar `app-souls`

En una primera terminal:

```bash
cd app-souls
npm ci
Copy-Item .env.example .env.local  # PowerShell; usa cp en macOS/Linux
npm run dev
```

Configura `.env.local` con `sixDev` y deja el proceso en `http://localhost:3000`.
No uses una URI `six2`/`Six2`.

Para permitir el cliente Vite local, revisa `SIMULATOR_WEB_ORIGIN`. La plantilla
histórica del proyecto contiene `localhost:3001`, pero Vite está configurado en
el puerto **5173**; para esta ejecución local usa:

```text
SIMULATOR_WEB_ORIGIN=http://localhost:5173
SIMULATOR_ADMIN_API_URL=http://127.0.0.1:2567
```

Si se conserva `3001`, debes cambiar también el puerto del cliente antes de
probar CORS, callbacks o enlaces de autenticación.

## 2. Arrancar el servidor de juego

En una segunda terminal:

```bash
cd simulador-souls
npm ci
npm run dev:server
```

El script construye primero `packages/contracts` y luego ejecuta
`apps/game-server` en modo watch. El servidor usa `PORT=2567` y
`HOST=127.0.0.1` por defecto. Configura la URI de MongoDB de desarrollo en el
`.env.local` del servidor si vas a probar persistencia; el frontend nunca debe
conectarse directamente a MongoDB.

## 3. Arrancar el cliente web

En una tercera terminal:

```bash
cd simulador-souls
npm run dev:web
```

El script vuelve a construir los contratos y levanta Vite en
`http://localhost:5173`. Si necesitas declarar las URLs explícitamente, usa la
configuración local del cliente:

```text
VITE_APP_SOULS_API_URL=http://localhost:3000
VITE_GAME_SERVER_URL=ws://127.0.0.1:2567
```

## Verificación completa

- [ ] Las tres terminales siguen ejecutándose sin errores.
- [ ] `http://localhost:3000` responde.
- [ ] El cliente abre en `http://localhost:5173`.
- [ ] El login/callback usa app-souls local.
- [ ] El cliente crea o se une a una sala.
- [ ] El game server valida las acciones y no el navegador.
- [ ] La reconexión no deja el estado local en conflicto.

Si el cliente carga pero no entra a una sala, revisa primero la consola del
navegador, luego `APP_SOULS_API_URL`/`VITE_APP_SOULS_API_URL`, y finalmente que
el puerto 2567 esté escuchando.

## Comprobaciones del monorepo

Desde la raíz de `simulador-souls`:

```bash
npm run check
npm test
npm run build
```
