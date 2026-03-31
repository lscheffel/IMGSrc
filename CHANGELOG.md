# Changelog
All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [2.3.0] - 2026-03-31
### Added
- Rate-limit distribuído por host com rolling window (middleware em `apps/api/src/middleware/rateLimit.ts`).
- Workers dedicados: scraper-worker (`worker_threads`) e download-worker (`child_process`).
- Worker pool com min/max configurável e idle timeout.
- Telemetria avançada em `/api/metrics`: `windowSec` (1-3600s), `detailed` (p99), throughput.
- Rate-limit stats: top hosts bloqueados, contagem de bloqueios.
- Variáveis de ambiente configuráveis em `apps/api/.env.example`.
- Testes TDD: `rate-limit.spec.ts` (26 testes) e `worker-messaging.spec.ts` (45 testes).

### Changed
- Endpoint `/api/metrics` expandido com parâmetros query e resposta detalhada.
- Contratos IPC atualizados em `docs/architecture/IPC_API_CONTRACTS-000.md`.

## [2.2.0] - 2026-03-31
### Added
- Paginação real de histórico no backend (`GET /api/history?limit&cursor`) e virtualização no frontend.
- Command Palette com ações de navegação, execução, presets e temas.
- Sidebar de workspaces, atalhos de teclado e persistência de layout/tema/preset.
- Temas escuros avançados: VSCode Dark Default, Dark+ e Kimbie Dark.
- Camada visual Wave 4: toasts contextuais, skeleton loaders, live ribbon de operação e transições de entrada.

### Changed
- Header da UI fixo, com input rápido de URLs (alias do Search) e controles operacionais ampliados.
- Status API/Queue agora usam telemetria real (`/api/health` + `/api/metrics`) com estados e cores distintas.

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
