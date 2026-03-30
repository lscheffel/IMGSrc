# IMGSrc v2

Migração para stack ouro: **Node + SQLite + React + Vite + Tailwind + Vue + Zustand + TypeScript**.

## Estrutura
- `apps/api`: API Node/Express com scraping, download e histórico SQLite.
- `apps/web`: Frontend React com estado global em Zustand e widget Vue (custom element).
- `docs/architecture|roadmaps|performance`: memória canônica.

## Endpoints principais
- `POST /api/scrape`
- `POST /api/download` (sincrono)
- `POST /api/jobs/download` + `GET /api/jobs/download/:jobId` (assíncrono)
- `GET /api/history` e `GET /api/history/export`
- `GET /api/metrics`

## Scripts
- `npm run dev`
- `npm run dev:stop`
- `npm run dev:reset`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run clean`

Config de lint ativa: `eslint.config.js` (ESLint v9 flat config).

## Desenvolvimento
1. `npm install`
2. `npm run dev`

Opcional (subir separado):
- `npm --workspace apps/api run dev`
- `npm --workspace apps/web run dev`

API padrão: `http://localhost:8787`.

## Status de qualidade
Pipeline validado localmente:
`npm run lint && npm run test && npm run build` (OK).

## Observação
Código Python legado foi preservado como referência histórica; a stack ativa de evolução passa a ser a estrutura Node/TS.
