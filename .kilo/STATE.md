# STATE
date: 2026-04-01
current_version: 2.3.1
source_of_truth:
- apps/api/src
- apps/web/src

decisions:
- Stack ativa migrou para Node+TS+React+Vite+Tailwind+Vue+Zustand+SQLite.
- API HTTP substitui o fluxo desktop PyQt como caminho principal.
- Contratos canônicos movidos para `docs/architecture/IPC_API_CONTRACTS-000.md`.
- Qualidade obrigatória via lint/test/build em CI, com execução local validada.
- ESLint v9 opera em flat config (`eslint.config.js`).
- Fase RFC-001 iniciada com fila assíncrona de download e endpoint `/api/metrics`.
- Scraper Node agora tolera falhas parciais e devolve `warnings`.
- Download/One Click corrigidos com filtro SQL `status = 'active'`.
- Feedback visual em tempo real implementado via jobs assíncronos e polling de progresso.
- RFC-002 implementada com rate-limit distribuído, workers dedicados e telemetria avançada.
- Rate-limit bug corrigido: exempt `/api/jobs` do rate-limit (polling a cada 450ms).
- Novo endpoint `/api/reset` para limpar histórico, rate-limits e jobs.

quality_gate:
todo_fixme_count: 0

next_task_id: RFC-003
next_focus: Estabilidade Frontend (Reset button, polling backoff, UX painel)
