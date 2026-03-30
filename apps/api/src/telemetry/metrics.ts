type LatencyBucket = {
  count: number;
  errors: number;
  durations: number[];
};

const MAX_SAMPLES = 500;
const byRoute = new Map<string, LatencyBucket>();

function getBucket(key: string): LatencyBucket {
  const existing = byRoute.get(key);
  if (existing) {
    return existing;
  }
  const created: LatencyBucket = {
    count: 0,
    errors: 0,
    durations: []
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

export function observeHttpMetric(args: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const key = `${args.method.toUpperCase()} ${args.route}`;
  const bucket = getBucket(key);
  bucket.count += 1;
  if (args.statusCode >= 400) {
    bucket.errors += 1;
  }
  bucket.durations.push(args.durationMs);
  if (bucket.durations.length > MAX_SAMPLES) {
    bucket.durations.shift();
  }
}

export function getMetricsSnapshot(): {
  endpoints: Array<{
    key: string;
    count: number;
    errors: number;
    p50: number;
    p95: number;
  }>;
} {
  const endpoints = Array.from(byRoute.entries()).map(([key, bucket]) => {
    const sorted = [...bucket.durations].sort((a, b) => a - b);
    return {
      key,
      count: bucket.count,
      errors: bucket.errors,
      p50: Number(percentile(sorted, 50).toFixed(2)),
      p95: Number(percentile(sorted, 95).toFixed(2))
    };
  });

  return {
    endpoints: endpoints.sort((a, b) => a.key.localeCompare(b.key))
  };
}

