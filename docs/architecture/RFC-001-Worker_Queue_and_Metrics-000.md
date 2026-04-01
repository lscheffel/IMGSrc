# RFC-001-Worker_Queue_and_Metrics-000

## Escopo arquitetural
- Introduzir fila assíncrona para jobs de download.
- Expor status de job por ID e listagem de fila.
- Instrumentar latência/erro por endpoint.

## Metas de desempenho
- Não bloquear request-response para downloads longos.
- Disponibilizar p50/p95 por rota em snapshot de métricas.
- Manter compatibilidade com endpoint síncrono legado.

## Funcionalidades core
- `POST /api/jobs/download`
- `GET /api/jobs/download`
- `GET /api/jobs/download/:jobId`
- `GET /api/metrics`

