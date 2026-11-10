---
title: Ejecutar app-souls en local
description: Levantar la aplicación principal en un entorno de desarrollo seguro.
category: Desarrollo local
order: 20
---

# Ejecutar `app-souls` en local

`app-souls` es la aplicación principal y la fuente de verdad para usuarios,
cartas, decks y torneos. El simulador necesita que esta aplicación esté
disponible para autenticación, APIs y validaciones de sesión.

## Requisitos

- Node.js y npm compatibles con el `package.json`.
- Un archivo `.env.local` local. Nunca copies secretos de la VPS.
- Una base de datos de desarrollo: la configuración local debe apuntar a
  `sixDev`, nunca a `six2`/`Six2`.

## Instalación y ejecución

Abre una terminal en el repositorio `app-souls`:

```bash
cd app-souls
npm ci
copy .env.example .env.local    # Windows PowerShell: Copy-Item .env.example .env.local
npm run dev
```

Next.js debe quedar disponible en `http://localhost:3000`.

Antes de iniciar, revisa `.env.local` y reemplaza los valores de ejemplo por
credenciales de desarrollo. No subas ese archivo a Git y no uses una URI de
producción.

## Configuración para el simulador

Cuando también vayas a ejecutar `simulador-souls`, comprueba que la configuración
local de app-souls permite el origen del cliente del simulador y apunta al API
del servidor de juego local. En desarrollo, los valores esperados son:

```text
SIMULATOR_WEB_ORIGIN=http://localhost:5173
SIMULATOR_ADMIN_API_URL=http://127.0.0.1:2567
```

La plantilla `.env.example` todavía muestra `localhost:3001` por compatibilidad
con un flujo anterior. Para el cliente Vite actual, `.env.local` debe usar
`5173`, que es el puerto definido en `apps/web/vite.config.ts`.

Los nombres exactos y secretos se mantienen en `.env.example`/`.env.local` del
proyecto; no los inventes ni los reutilices desde producción.

## Verificación

```bash
curl http://localhost:3000
```

Después abre la aplicación en el navegador y confirma que las rutas de login y
las APIs respondan. Si el simulador devuelve errores de autenticación, deja
`app-souls` ejecutándose y revisa primero sus logs antes de depurar el cliente.

## Checklist

- [ ] `DATABASE_URL` apunta a `sixDev`.
- [ ] `app-souls` responde en el puerto 3000.
- [ ] El login local funciona con datos de desarrollo.
- [ ] El origen del simulador está permitido.
- [ ] No se conectó el frontend directamente a MongoDB.
