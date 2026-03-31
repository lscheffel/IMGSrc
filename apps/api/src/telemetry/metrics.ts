/**
 * Telemetry Module - Métricas HTTP e Throughput
 *
 * Implementa coleta de métricas com suporte a:
 * - Filtragem por janela de tempo (windowSec)
 * - Percentis p50/p95/p99 (detailed mode)
 * - Métricas de throughput (imagens/segundo)
 * - Integração com rate-limit stats
 */

// ============================================================================
// Types - Conforme contratos da RFC-002 (IPC_API_CONTRACTS-000.md)
// ============================================================================

export interface LatencyBucket {
  count: number;
  errors: number;
  durations: number[];
  timestamps: number[];
}

export interface EndpointMetrics {
  route: string;
  method: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  p50?: number;
  p95?: number;
  p99?: number;
}

export interface ThroughputMetrics {
  imagesPerSecond: number;
  downloadsPerSecond: number;
  bytesPerSecond: number;
}

export interface RateLimitStats {
  totalHosts: number;
  blockedHosts: number;
  topHosts: Array<{
    host: string;
    requests: number;
    blocked: boolean;
  }>;
}

export interface MetricsSnapshotOptions {
  windowSec?: number;
  detailed?: boolean;
}

// ============================================================================
// Configuração
// ============================================================================

const MAX_SAMPLES = 500;

const byRoute = new Map<string, LatencyBucket>();

let totalImagesProcessed = 0;
let totalDownloadsProcessed = 0;
let totalBytesProcessed = 0;
let startTime = Date.now();

// ============================================================================
// Funções Auxiliares
// ============================================================================

function getBucket(key: string): LatencyBucket {
  const existing = byRoute.get(key);
  if (existing) {
    return existing;
  }
  const created: LatencyBucket = {
    count: 0,
    errors: 0,
    durations: [],
    timestamps: []
  };
  byRoute.set(key, created);
  return created;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(index, 0)] ?? 0;
}

function filterByWindow(bucket: LatencyBucket, windowSec: number): LatencyBucket {
  if (windowSec <= 0) {
    return bucket;
  }

  const cutoff = Date.now() - (windowSec * 1000);
  const filteredDurations: number[] = [];
  let filteredErrors = 0;

  const len = bucket.timestamps.length;
  for (let i = 0; i < len; i++) {
    const ts = bucket.timestamps[i];
    const dur = bucket.durations[i];
    if (ts !== undefined && ts >= cutoff && dur !== undefined) {
      filteredDurations.push(dur);
      if (dur >= 400) {
        filteredErrors++;
      }
    }
  }

  return {
    count: filteredDurations.length,
    errors: filteredErrors,
    durations: filteredDurations,
    timestamps: [] // não precisamos manter timestamps no bucket filtrado
  };
}

// ============================================================================
// API Pública
// ============================================================================

export function observeHttpMetric(args: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const key = `${args.method.toUpperCase()} ${args.route}`;
  const bucket = getBucket(key);
  const now = Date.now();

  bucket.count += 1;
  if (args.statusCode >= 400) {
    bucket.errors += 1;
  }
  bucket.durations.push(args.durationMs);
  bucket.timestamps.push(now);

  if (bucket.durations.length > MAX_SAMPLES) {
    bucket.durations.shift();
    bucket.timestamps.shift();
  }
}

export function observeThroughput(args: {
  imagesProcessed: number;
  downloadsProcessed: number;
  bytesProcessed: number;
}): void {
  totalImagesProcessed += args.imagesProcessed;
  totalDownloadsProcessed += args.downloadsProcessed;
  totalBytesProcessed += args.bytesProcessed;
}

export function calculateThroughput(windowSec: number): ThroughputMetrics {
  const windowMs = windowSec * 1000;
  const elapsedMs = Math.min(Date.now() - startTime, windowMs);

  if (elapsedMs <= 0) {
    return {
      imagesPerSecond: 0,
      downloadsPerSecond: 0,
      bytesPerSecond: 0
    };
  }

  const seconds = elapsedMs / 1000;

  return {
    imagesPerSecond: Number((totalImagesProcessed / seconds).toFixed(2)),
    downloadsPerSecond: Number((totalDownloadsProcessed / seconds).toFixed(2)),
    bytesPerSecond: Number((totalBytesProcessed / seconds).toFixed(2))
  };
}

export function processRateLimitStats(
  rawStats: Record<string, unknown>,
  detailed: boolean
): RateLimitStats | undefined {
  if (!detailed) {
    return undefined;
  }

  const entries = Object.values(rawStats) as Array<{
    host: string;
    requestCount: number;
    blocked: boolean;
  }>;

  const blockedHosts = entries.filter(e => e.blocked).length;

  const sortedByRequests = [...entries]
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, 10);

  return {
    totalHosts: entries.length,
    blockedHosts,
    topHosts: sortedByRequests.map(e => ({
      host: e.host,
      requests: e.requestCount,
      blocked: e.blocked
    }))
  };
}

export function getMetricsSnapshot(options: MetricsSnapshotOptions = {}): {
  timestamp: string;
  windowSec: number;
  endpoints: EndpointMetrics[];
  throughput: ThroughputMetrics;
  rateLimits?: RateLimitStats;
} {
  const windowSec = Math.max(1, Math.min(3600, options.windowSec ?? 60));
  const detailed = options.detailed ?? false;

  const endpoints: EndpointMetrics[] = [];

  for (const [key, bucket] of byRoute.entries()) {
    const filtered = filterByWindow(bucket, windowSec);

    if (filtered.durations.length === 0) {
      continue;
    }

    const sorted = [...filtered.durations].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const avg = sum / sorted.length;

    const routePart = key.includes(' ') ? key.substring(key.indexOf(' ') + 1) : key;
    const methodPart = key.includes(' ') ? key.substring(0, key.indexOf(' ')) : 'GET';

    const metrics: EndpointMetrics = {
      route: routePart || key,
      method: methodPart,
      requests: filtered.count,
      errors: filtered.errors,
      avgLatencyMs: Number(avg.toFixed(2)),
      p50: Number(percentile(sorted, 50).toFixed(2)),
      p95: Number(percentile(sorted, 95).toFixed(2))
    };

    if (detailed) {
      metrics.p99 = Number(percentile(sorted, 99).toFixed(2));
    }

    endpoints.push(metrics);
  }

  const throughput = calculateThroughput(windowSec);

  return {
    timestamp: new Date().toISOString(),
    windowSec,
    endpoints: endpoints.sort((a, b) => a.route.localeCompare(b.route)),
    throughput
  };
}

export function resetMetrics(): void {
  byRoute.clear();
  totalImagesProcessed = 0;
  totalDownloadsProcessed = 0;
  totalBytesProcessed = 0;
  startTime = Date.now();
}
