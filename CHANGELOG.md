# Changelog
All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [2.1.0] - 2026-03-30
### Added
- Jobs assíncronos de busca com endpoints `POST /api/jobs/scrape` e `GET /api/jobs/scrape/:jobId`.
- Progresso em tempo real para download e one-click (contadores, bytes, status e polling progressivo).
- Painel visual on-the-fly no frontend com barras, taxas por segundo, ETA, sparklines e feed de eventos.

### Changed
- Fluxo de busca/download do frontend migrado para modelo de jobs assíncronos com acompanhamento contínuo.

### Fixed
- Correção SQLite em download/one-click (`status = 'active'` como literal de string).

## [2.0.0] - 2026-03-30
### Added
- Monorepo Node/TypeScript com workspaces (`apps/api`, `apps/web`).
- API Express com contratos `/api/health`, `/api/scrape`, `/api/download`, `/api/history`.
- Persistência SQLite versionável para histórico de downloads.
- Frontend React + Vite + Tailwind + Zustand.
- Módulo Vue como custom element integrado no frontend React.
- Base de engenharia: ESLint estrito, Prettier, CI GitHub Actions e scripts determinísticos.
- Fila assíncrona de download com contratos `POST /api/jobs/download` e `GET /api/jobs/download/:jobId`.
- Observabilidade HTTP com snapshot de métricas em `GET /api/metrics`.

### Changed
- Migração de arquitetura primária de PyQt desktop para web full stack.

### Fixed
- Compatibilidade com ESLint v9 via `eslint.config.js` (flat config).
- Scripts da raiz ajustados para `--workspaces`.
- Suite de testes frontend estabilizada (`vi.mock` hoisting).
- `npm run dev` na raiz agora sobe API e Web em paralelo.
- Scripts `dev:stop` e `dev:reset` adicionados para resolver conflito de portas.
- Scraper resiliente: falhas pontuais de URL/página não derrubam a busca completa.
- Frontend exibe erro detalhado da API e avisos de scraping.

## [1.0.0] - 2025-07-16
### Added
- Primeira versão desktop em Python/PyQt para scraping e download.
