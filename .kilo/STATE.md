# STATE
date: 2026-03-30
current_version: 2.0.0
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

quality_gate:
todo_fixme_count: 0

next_task_id: RFC-002-Distributed_Rate_Limit_and_Workers
next_focus: rate-limit distribuído, workers dedicados e throughput sustentado.
