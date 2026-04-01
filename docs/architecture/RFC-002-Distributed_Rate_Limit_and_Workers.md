# RFC-002-Distributed_Rate_Limit_and_Workers

## Escopo arquitetural
- Introduzir rate-limit distribuído por host de destino.
- Separar scraper e downloader em workers de processo independentes.
- Expor telemetria avanzada com latência, throughput e taxa de erro.

## Metas de desempenho
- Evitar banimento de IP por requests excessivos (rate-limit por host).
- throughput sustentado >= 5 img/s em downloads paralelos.
- Latência p95 <= 3.0s para scrape de galeria.
- Manter compatibilidade retroativa com contratos existentes.

## Funcionalidades core
- Middleware de rate-limit com janela deslizante por domínio.
- Worker pool dedicado para scraping (scraper-worker).
- Worker pool dedicado para downloads (download-worker).
- Telemetria expandida em `/api/metrics` (windowSec, detailed).
- Thresholds configuráveis em `.env`.

## Contratos propostos
| Method | Route | Request | Response | Motivo |
|---|---|---|---|---|
| GET | `/api/metrics` | `?windowSec&detailed` | `{ endpoints[], queue, throughput, rateLimits? }` | KPIs avançados |

## TDD Gates
- `apps/api/test/rate-limit.spec.ts`: rate-limit por host com contadores.
- `apps/api/test/worker-messaging.spec.ts`: IPC entre processos worker.
- `test/e2e/sustained-throughput.spec.ts`: downloads sustentados por 5min.

[READY FOR IMPLEMENTATION - DOCUMENTATION ISOLATED]