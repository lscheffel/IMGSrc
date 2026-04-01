# PBPR_Baselines-000

## Baselines iniciais
- `POST /api/scrape` (1 galeria, min 10KB): p95 <= 4.0s.
- `POST /api/download` (20 imagens): throughput >= 6 img/s local.
- `POST /api/jobs/download`: resposta inicial <= 150ms.
- `GET /api/history`: p95 <= 120ms para 10k registros.
- `GET /api/metrics`: p95 <= 80ms.

## Métricas obrigatórias
- Latência por endpoint (p50/p95).
- Taxa de erro por estágio (scrape/probe/download/db).
- Uso de memória durante download paralelo.
