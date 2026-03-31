# IPC_API_CONTRACTS-000

## HTTP Contracts
| Method | Route | Body | Response |
|---|---|---|---|
| GET | `/api/health` | - | `{ status: "ok" }` |
| POST | `/api/scrape` | `{ urls[], minSizeKb, scrapeThreads, urlWorkers }` | `{ images[], totalImages, discardedImages, warnings? }` |
| POST | `/api/download` | `{ images[], destFolder, overwrite, createUserFolder, createAlbumFolder, downloadsParallel }` | `{ totalDownloads, totalMb, skipped, errors }` |
| POST | `/api/jobs/download` | mesmo payload de `/api/download` | `{ jobId, status }` (202) |
| GET | `/api/jobs/download` | `?limit&status` | `{ items[], queue }` |
| GET | `/api/jobs/download/:jobId` | - | `{ id, status, result?, error? }` |
| GET | `/api/history` | `?limit&cursor` | `{ items[], nextCursor? }` |
| DELETE | `/api/history` | - | `{ deleted }` |
| GET | `/api/history/export` | - | CSV stream |
| GET | `/api/metrics` | `?windowSec&detailed` | `{ endpoints[], queue, throughput, rateLimits? }` |

---

## Rate-Limit Contracts

### Configuração via Environment (.env)

| Variável | Tipo | Default | Descrição |
|---|---|---|---|
| `RATE_LIMIT_ENABLED` | boolean | false | Ativa middleware de rate-limit |
| `RATE_LIMIT_WINDOW_MS` | number | 60000 | Janela temporal em milissegundos (1min) |
| `RATE_LIMIT_MAX_REQUESTS` | number | 30 | Máximo de requests por janela por host |
| `RATE_LIMIT_BURST` | number | 5 | Requestsburst permitidos sem penalty |

### Tipos TypeScript

```typescript
// Configuração global do rate-limiter
interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  burstAllowance: number;
}

// Estado de um bucket por domínio
interface RateLimitBucket {
  host: string;
  windowStart: number;
  requestCount: number;
  blocked: boolean;
  blockUntil?: number;
}

// Resultado da checagem de rate-limit
interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

// Middleware de rate-limit para Express
interface RateLimitMiddleware {
  check(host: string): RateLimitCheckResult;
  consume(host: string): RateLimitCheckResult;
  reset(host: string): void;
  getStats(): Record<string, RateLimitBucket>;
}
```

### Comportamento

- **Janela deslizante**: Contagem de requests dentro de `windowMs` Rolling Window
- **Por domínio**: Limitação独立 por host de destino (extraído da URL)
- **Resposta 429**: Quando excedido, retorna `Retry-After` header com tempo de reset
- **Burst**: Permite até `burstAllowance` requests instantâneos sem decrementar contagem

---

## IPC Contracts para Workers

### Tipos TypeScript

```typescript
// Mensagem enviada do processo principal para worker
interface WorkerMessage<T = unknown> {
  id: string;
  type: 'SCRAPE_TASK' | 'DOWNLOAD_TASK' | 'HEALTH_CHECK' | 'SHUTDOWN';
  payload: T;
  timestamp: number;
  correlationId?: string;
}

// Resposta do worker para processo principal
interface WorkerResponse<T = unknown> {
  id: string; // matches WorkerMessage.id
  success: boolean;
  payload?: T;
  error?: {
    code: string;
    message: string;
  };
  durationMs: number;
}

// Configuração do pool de workers
interface WorkerPoolConfig {
  workerType: 'scraper' | 'download';
  minWorkers: number;
  maxWorkers: number;
  idleTimeoutMs: number;
  messageTimeoutMs: number;
}

// Estado de um worker individual
interface WorkerState {
  id: string;
  status: 'idle' | 'busy' | 'terminated';
  currentJobId?: string;
  startedAt: number;
  processedCount: number;
}

// Métricas agregadas do pool
interface WorkerPoolMetrics {
  type: 'scraper' | 'download';
  workers: WorkerState[];
  idleCount: number;
  busyCount: number;
  totalProcessed: number;
  avgLatencyMs: number;
}
```

### Protocolo de Comunicação

| Abordagem | Vantagens | Desvantagens |
|---|---|---|
| `worker_threads` | Compartilha memória, zero-serialization | Mesmo processo (crash em cascata) |
| `child_process` | Isolamento de processo | IPC overhead, serialization JSON |

**Recomendação**: Usar `worker_threads` para scraper (CPU-bound) e `child_process` para downloads (I/O-bound com spawn).

### Workflow de Mensagens

```
[Main Process]                    [Worker Pool]
     |                                  |
     |--- WorkerMessage (task) -------->|
     |                                  |
     |<-- WorkerResponse (result) ------|
     |                                  |
     |--- WorkerMessage (control) ----->|
     |                                  |
```

---

## Telemetry Expandida

### Query Parameters

| Parâmetro | Tipo | Default | Descrição |
|---|---|---|---|
| `windowSec` | number | 60 | Janela temporal em segundos para métricas (1-3600) |
| `detailed` | boolean | false | Include p50/p95/p99 latências e rate-limits por host |

### Response Schema

```typescript
interface MetricsResponse {
  timestamp: string;
  windowSec: number;
  endpoints: EndpointMetrics[];
  queue: {
    download: QueueMetrics;
    scrape: QueueMetrics;
  };
  throughput: ThroughputMetrics;
  rateLimits?: RateLimitStats; // Only when detailed=true
}

interface EndpointMetrics {
  route: string;
  method: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  p50?: number;
  p95?: number;
  p99?: number; // Only when detailed=true
}

interface QueueMetrics {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  avgWaitTimeMs?: number;
}

interface ThroughputMetrics {
  imagesPerSecond: number;
  downloadsPerSecond: number;
  bytesPerSecond: number;
}

interface RateLimitStats {
  totalHosts: number;
  blockedHosts: number;
  topHosts: Array<{
    host: string;
    requests: number;
    blocked: boolean;
  }>;
}
```

### Exemplo de Request/Response

**Request:**
```
GET /api/metrics?windowSec=300&detailed=true
```

**Response:**
```json
{
  "timestamp": "2026-03-31T03:00:00.000Z",
  "windowSec": 300,
  "endpoints": [
    {
      "route": "/api/scrape",
      "method": "POST",
      "requests": 42,
      "errors": 1,
      "avgLatencyMs": 1240.5,
      "p50": 980,
      "p95": 2100,
      "p99": 2850
    }
  ],
  "queue": {
    "download": {
      "queued": 3,
      "running": 1,
      "completed": 156,
      "failed": 2,
      "avgWaitTimeMs": 450
    },
    "scrape": {
      "queued": 1,
      "running": 1,
      "completed": 89,
      "failed": 3,
      "avgWaitTimeMs": 120
    }
  },
  "throughput": {
    "imagesPerSecond": 4.2,
    "downloadsPerSecond": 3.8,
    "bytesPerSecond": 5242880
  },
  "rateLimits": {
    "totalHosts": 12,
    "blockedHosts": 0,
    "topHosts": [
      { "host": "example.com", "requests": 890, "blocked": false },
      { "host": "test.org", "requests": 45, "blocked": false }
    ]
  }
}
```

---

## Internal Events
- Frontend React aciona actions Zustand.
- Widget Vue recebe métricas por props/attributes.
