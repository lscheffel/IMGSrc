/**
 * Rate-Limit Middleware com Janela Deslizante (Rolling Window)
 *
 * Implementa limitação de requests por host de destino usando uma janela
 * deslizante para maior precisão. Cada host tem sua própria contagem
 * isolada.
 *
 * Variáveis de ambiente:
 * - RATE_LIMIT_ENABLED: Ativa/desativa o rate-limit (default: true)
 * - RATE_LIMIT_WINDOW_MS: Janela de tempo em ms (default: 60000 = 1min)
 * - RATE_LIMIT_MAX_REQUESTS: Máximo de requests por janela (default: 20)
 * - RATE_LIMIT_BURST: Allowance adicional para bursts (default: 5)
 */

import type { Request, Response, NextFunction } from 'express';

// ============================================================================
// Types - Conforme contratos da RFC-002 (IPC_API_CONTRACTS-000.md)
// ============================================================================

export interface RateLimitBucket {
  host: string;
  windowStart: number;
  requestCount: number;
  blocked: boolean;
  blockUntil?: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  burst: number;
}

export interface RateLimitMiddleware {
  check(host: string): RateLimitCheckResult;
  consume(host: string): RateLimitCheckResult;
  reset(host: string): void;
  getStats(): Record<string, RateLimitBucket>;
}

// ============================================================================
// Configuração
// ============================================================================

function loadConfig(): RateLimitConfig {
  return {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
    maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 20),
    burst: Number(process.env.RATE_LIMIT_BURST ?? 5)
  };
}

// ============================================================================
// Implementação do Rate-Limit com Rolling Window
// ============================================================================

/**
 * RateLimiter - Implementação de janela deslizante por host
 *
 * Usa uma abordagem de timestamp recording para precisão na contagem
 * de requests dentro da janela móvel.
 */
class RateLimiter implements RateLimitMiddleware {
  private readonly config: RateLimitConfig;
  private readonly buckets: Map<string, RateLimitBucket> = new Map();
  private readonly requestTimestamps: Map<string, number[]> = new Map();

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      ...loadConfig(),
      ...config
    };
  }

  /**
   * Verifica se request é permitida sem consumir a quota
   */
  check(host: string): RateLimitCheckResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: this.config.maxRequests + this.config.burst,
        resetAt: Date.now() + this.config.windowMs
      };
    }

    const bucket = this.getOrCreateBucket(host);
    const now = Date.now();

    // Verificar se está bloqueado
    if (bucket.blocked && bucket.blockUntil && bucket.blockUntil > now) {
      const retryAfterMs = bucket.blockUntil - now;
      return {
        allowed: false,
        remaining: 0,
        resetAt: bucket.blockUntil,
        retryAfterMs
      };
    }

    // Limpar estado de block se expirou
    if (bucket.blocked && (!bucket.blockUntil || bucket.blockUntil <= now)) {
      bucket.blocked = false;
      bucket.blockUntil = undefined;
    }

    // Contar requests válidos na janela deslizante
    const windowStart = now - this.config.windowMs;
    const timestamps = this.requestTimestamps.get(host) ?? [];
    const validRequests = timestamps.filter((ts) => ts > windowStart).length;

    const remaining = Math.max(
      0,
      this.config.maxRequests + this.config.burst - validRequests
    );

    return {
      allowed: remaining > 0,
      remaining,
      resetAt: now + this.config.windowMs,
      retryAfterMs: remaining === 0 ? this.config.windowMs : undefined
    };
  }

  /**
   * Consome a quota e retorna resultado da checagem
   */
  consume(host: string): RateLimitCheckResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: this.config.maxRequests + this.config.burst,
        resetAt: Date.now() + this.config.windowMs
      };
    }

    const result = this.check(host);

    if (result.allowed) {
      const now = Date.now();
      const timestamps = this.requestTimestamps.get(host) ?? [];
      const windowStart = now - this.config.windowMs;

      // Manter apenas timestamps válidos na janela
      const validTimestamps = timestamps.filter((ts) => ts > windowStart);
      validTimestamps.push(now);

      this.requestTimestamps.set(host, validTimestamps);

      // Atualizar bucket
      const bucket = this.getOrCreateBucket(host);
      bucket.requestCount = validTimestamps.length;
      bucket.windowStart = now;

      // Recalcular remaining após consumo
      result.remaining = Math.max(
        0,
        this.config.maxRequests + this.config.burst - validTimestamps.length
      );

      // Verificar se excedeu o limite e aplicar block se necessário
      if (validTimestamps.length > this.config.maxRequests + this.config.burst) {
        // Aplicar block temporário
        bucket.blocked = true;
        bucket.blockUntil = now + this.config.windowMs;
        result.allowed = false;
        result.retryAfterMs = this.config.windowMs;
      }
    }

    return result;
  }

  /**
   * Reseta o estado de rate-limit para um host específico
   */
  reset(host: string): void {
    this.buckets.delete(host);
    this.requestTimestamps.delete(host);
  }

  /**
   * Retorna estatísticas de todos os buckets
   */
  getStats(): Record<string, RateLimitBucket> {
    const stats: Record<string, RateLimitBucket> = {};
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [host, timestamps] of this.requestTimestamps.entries()) {
      const validCount = timestamps.filter((ts) => ts > windowStart).length;
      const bucket = this.buckets.get(host);

      stats[host] = {
        host,
        windowStart: bucket?.windowStart ?? now,
        requestCount: validCount,
        blocked: bucket?.blocked ?? false,
        blockUntil: bucket?.blockUntil
      };
    }

    return stats;
  }

  /**
   * Obtém ou cria um bucket para o host
   */
  private getOrCreateBucket(host: string): RateLimitBucket {
    let bucket = this.buckets.get(host);
    if (!bucket) {
      bucket = {
        host,
        windowStart: Date.now(),
        requestCount: 0,
        blocked: false
      };
      this.buckets.set(host, bucket);
    }
    return bucket;
  }

  /**
   * Retorna a configuração atual
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Instância singleton
// ============================================================================

let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}

export function createRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
  return new RateLimiter(config);
}

// ============================================================================
// Express Middleware Factory
// ============================================================================

/**
 * Cria o middleware de rate-limit para Express
 *
 * Extrai o host de destino do body (para rotas POST com URLs)
 * ou do header Host (para outras rotas)
 */
export function rateLimitMiddleware() {
  const limiter = getRateLimiter();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Rotas que não precisam de rate-limit
    const exemptRoutes = ['/api/health', '/api/history', '/api/metrics'];
    if (exemptRoutes.includes(req.path)) {
      next();
      return;
    }

    // Extrair host do request externo
    let targetHost = '';

    if (req.method === 'POST') {
      // Para POST, tentar extrair URLs do body
      const urls = req.body?.urls ?? req.body?.images?.map((img: { url: string }) => img.url) ?? [];
      if (Array.isArray(urls) && urls.length > 0) {
        try {
          const parsedUrl = new URL(urls[0]);
          targetHost = parsedUrl.hostname;
        } catch {
          // Se não conseguir parsear, usar header Host
          targetHost = req.headers.host ?? 'unknown';
        }
      } else {
        targetHost = req.headers.host ?? 'unknown';
      }
    } else {
      targetHost = req.headers.host ?? 'unknown';
    }

    // Executar consume e verificar resultado
    const result = limiter.consume(targetHost);

    // Configurar headers de rate-limit
    res.setHeader('X-RateLimit-Limit', String(limiter.getConfig().maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      // Definir Retry-After header
      if (result.retryAfterMs) {
        const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }

      res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests to target host',
        retryAfter: result.retryAfterMs
      });
      return;
    }

    next();
  };
}

// ============================================================================
// Utilitários para debugging/testing
// ============================================================================

/**
 * Retorna o número de hosts sendo rastreados
 */
export function getTrackedHostsCount(): number {
  return getRateLimiter().getStats();
}

/**
 * Reset completo de todos os buckets
 */
export function resetAllRateLimits(): void {
  const stats = getRateLimiter().getStats();
  for (const host of Object.keys(stats)) {
    getRateLimiter().reset(host);
  }
}
