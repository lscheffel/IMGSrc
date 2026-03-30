# IPC_API_CONTRACTS-000

## HTTP Contracts
| Method | Route | Body | Response |
|---|---|---|---|
| GET | `/api/health` | - | `{ status: "ok" }` |
| POST | `/api/scrape` | `{ urls[], minSizeKb, scrapeThreads, urlWorkers }` | `{ images[], totalImages, discardedImages, warnings? }` |
| POST | `/api/download` | `{ images[], destFolder, overwrite, createUserFolder, createAlbumFolder, downloadsParallel }` | `{ totalDownloads, totalMb, skipped, errors }` |
| POST | `/api/jobs/download` | mesmo payload de `/api/download` | `{ jobId, status }` (202) |
| GET | `/api/jobs/download` | - | `{ items[], queue }` |
| GET | `/api/jobs/download/:jobId` | - | `{ id, status, result?, error? }` |
| GET | `/api/history` | - | `{ items[] }` |
| DELETE | `/api/history` | - | `{ deleted }` |
| GET | `/api/history/export` | - | CSV stream |
| GET | `/api/metrics` | - | `{ endpoints[], queue }` |

## Internal Events
- Frontend React aciona actions Zustand.
- Widget Vue recebe métricas por props/attributes.
