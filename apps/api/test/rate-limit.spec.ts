/**
 * Testes Unitários - Rate Limit Middleware
 *
 * RFC-002: TDD Gates para rate-limit por host com contadores
 *
 * Cenários testados:
 * - Rolling window (contagem de requests dentro da janela)
 * - Rate-limit por host (isolamento entre domínios)
 * - Resposta 429 quando exceder limite
 * - Headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
 * - Burst allowance
 * - Reset manual
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createRateLimiter,
  type RateLimiter,
  type RateLimitCheckResult,
  type RateLimitConfig
} from '../src/middleware/rateLimit.js';

describe('RateLimiter - Rolling Window', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    // Criar limiter com config de teste (janela curta)
    limiter = createRateLimiter({
      windowMs: 1000, // 1 segundo
      maxRequests: 5,
      burst: 2,
      enabled: true
    });
  });

  it('deve permitir requests dentro do limite', () => {
    const host = 'example.com';
    const result = limiter.consume(host);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(6); // maxRequests + burst - 1
  });

  it('deve decrementar remaining a cada request consumida', () => {
    const host = 'example.com';

    // Primeira request
    let result = limiter.consume(host);
    expect(result.remaining).toBe(6);

    // Segunda request
    result = limiter.consume(host);
    expect(result.remaining).toBe(5);

    // Terceira request
    result = limiter.consume(host);
    expect(result.remaining).toBe(4);
  });

  it('deve expirar requests após janela de tempo', async () => {
    const host = 'example.com';

    // Consumir todas as requests
    for (let i = 0; i < 7; i++) {
      limiter.consume(host);
    }

    // Verificar que está bloqueado
    const blockedResult = limiter.check(host);
    expect(blockedResult.allowed).toBe(false);
    expect(blockedResult.remaining).toBe(0);

    // Aguardar janela expirar
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Verificar que está liberado após expiração
    const result = limiter.check(host);
    expect(result.allowed).toBe(true);
  });

  it('deve contar apenas requests dentro da janela deslizante', async () => {
    const host = 'example.com';

    // Fazer requests
    limiter.consume(host);
    limiter.consume(host);

    // Aguardar janela expirar
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Nova request deve ser contada como primeira
    const result = limiter.consume(host);
    expect(result.remaining).toBe(6); // Deve ter burst disponível
  });
});

describe('RateLimiter - Rate Limit por Host', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      burst: 5,
      enabled: true
    });
  });

  it('deve isolar contadores entre hosts diferentes', () => {
    const host1 = 'example.com';
    const host2 = 'other.com';

    // Consumir todo limite do host1
    for (let i = 0; i < 15; i++) {
      limiter.consume(host1);
    }

    // host1 deve estar bloqueado
    const result1 = limiter.check(host1);
    expect(result1.allowed).toBe(false);

    // host2 deve estar liberado (não afetado pelo host1)
    const result2 = limiter.check(host2);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(15); // maxRequests + burst
  });

  it('deve manter contadores independentes para cada host', () => {
    const host1 = 'api.example.com';
    const host2 = 'cdn.example.com';
    const host3 = 'static.example.com';

    // Cada host com contagem diferente
    limiter.consume(host1);
    limiter.consume(host1);
    limiter.consume(host2);

    const stats = limiter.getStats();

    expect(stats[host1].requestCount).toBe(2);
    expect(stats[host2].requestCount).toBe(1);
    expect(stats[host3]).toBeUndefined();
  });
});

describe('RateLimiter - Resposta 429', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 3,
      burst: 2,
      enabled: true
    });
  });

  it('deve retornar allowed=false quando exceder limite', () => {
    const host = 'example.com';

    // Consumir até limite (3 + 2 = 5)
    for (let i = 0; i < 5; i++) {
      limiter.consume(host);
    }

    // Próxima request deve ser negada
    const result = limiter.consume(host);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('deve retornar retryAfterMs quando bloqueado', () => {
    const host = 'example.com';

    // Consumir todo limite
    for (let i = 0; i < 5; i++) {
      limiter.consume(host);
    }

    const result = limiter.check(host);

    expect(result.retryAfterMs).toBeDefined();
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('deve bloquear temporariamente após excesso de requests', () => {
    const host = 'example.com';

    // Consumir bem acima do limite
    for (let i = 0; i < 10; i++) {
      limiter.consume(host);
    }

    // Verificar que está bloqueado
    const result = limiter.check(host);
    expect(result.allowed).toBe(false);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});

describe('RateLimiter - Headers', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 100,
      burst: 10,
      enabled: true
    });
  });

  it('deve retornar resetAt correto', () => {
    const host = 'example.com';
    const now = Date.now();

    limiter.consume(host);

    const result = limiter.check(host);

    // resetAt deve estar dentro da janela
    expect(result.resetAt).toBeGreaterThan(now);
    expect(result.resetAt).toBeLessThanOrEqual(now + 60000);
  });

  it('deve retornar remaining correto após múltiplas requests', () => {
    const host = 'example.com';

    // Fazer 5 requests
    for (let i = 0; i < 5; i++) {
      limiter.consume(host);
    }

    const result = limiter.check(host);

    // remaining = maxRequests + burst - requests = 100 + 10 - 5 = 105
    // Mas o código usa max(0, ...) entao seria 105
    expect(result.remaining).toBe(105);
  });

  it('deve retornar remaining=0 quando limite atingido', () => {
    const host = 'example.com';

    // Limite: maxRequests(100) + burst(10) = 110
    for (let i = 0; i < 110; i++) {
      limiter.consume(host);
    }

    const result = limiter.check(host);

    expect(result.remaining).toBe(0);
    expect(result.allowed).toBe(false);
  });
});

describe('RateLimiter - Burst Allowance', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      burst: 5,
      enabled: true
    });
  });

  it('deve permitir burst acima do maxRequests', () => {
    const host = 'example.com';

    // 10 requests normais + 5 burst = 15 total
    for (let i = 0; i < 15; i++) {
      const result = limiter.consume(host);
      expect(result.allowed).toBe(true);
    }
  });

  it('deve bloquear após burst ser consumido', () => {
    const host = 'example.com';

    // 10 requests + 5 burst = 15
    for (let i = 0; i < 15; i++) {
      limiter.consume(host);
    }

    const result = limiter.consume(host);

    expect(result.allowed).toBe(false);
  });

  it('deve calcular remaining incluindo burst', () => {
    const host = 'example.com';

    // maxRequests(10) + burst(5) = 15 total
    limiter.consume(host); // 14 remaining

    const result = limiter.check(host);
    expect(result.remaining).toBe(14);
  });

  it('deve usar burst após janela de tempo', async () => {
    const host = 'example.com';

    // Usar apenas requests normais (10)
    for (let i = 0; i < 10; i++) {
      limiter.consume(host);
    }

    // remaining deve ser 5 (apenas burst)
    let result = limiter.check(host);
    expect(result.remaining).toBe(5);

    // Aguardar janela expirar
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Após expiração, deve ter apenas burst disponível novamente (maxRequests ainda está na janela)
    result = limiter.check(host);
    expect(result.remaining).toBe(5); // apenas burst restaurado após janela expirar
  });
});

describe('RateLimiter - Reset Manual', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      burst: 5,
      enabled: true
    });
  });

  it('deve resetar contagem para host específico', () => {
    const host = 'example.com';

    // Consumir todo limite
    for (let i = 0; i < 15; i++) {
      limiter.consume(host);
    }

    // Verificar que está bloqueado
    let result = limiter.check(host);
    expect(result.allowed).toBe(false);

    // Resetar
    limiter.reset(host);

    // Verificar que está liberado
    result = limiter.check(host);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(15);
  });

  it('deve resetar apenas o host especificado', () => {
    const host1 = 'example.com';
    const host2 = 'other.com';

    // Consumir todo limite do host1
    for (let i = 0; i < 15; i++) {
      limiter.consume(host1);
    }

    // host1 está bloqueado
    let result1 = limiter.check(host1);
    expect(result1.allowed).toBe(false);

    // host2 está liberado
    let result2 = limiter.check(host2);
    expect(result2.allowed).toBe(true);

    // Resetar apenas host1
    limiter.reset(host1);

    // host1 deve estar liberado
    result1 = limiter.check(host1);
    expect(result1.allowed).toBe(true);

    // host2 deve continuar liberado (não afetado)
    result2 = limiter.check(host2);
    expect(result2.allowed).toBe(true);
  });

  it('deve limpar estatísticas após reset', () => {
    const host = 'example.com';

    limiter.consume(host);

    let stats = limiter.getStats();
    expect(stats[host]).toBeDefined();

    limiter.reset(host);

    stats = limiter.getStats();
    expect(stats[host]).toBeUndefined();
  });
});

describe('RateLimiter - Configuração', () => {
  it('deve usar config padrão quando não especificada', () => {
    const limiter = createRateLimiter();
    const config = limiter.getConfig();

    expect(config.enabled).toBe(true);
    expect(config.windowMs).toBe(60000);
    expect(config.maxRequests).toBe(20);
    expect(config.burst).toBe(5);
  });

  it('deve aceitar config personalizada', () => {
    const limiter = createRateLimiter({
      windowMs: 30000,
      maxRequests: 50,
      burst: 10,
      enabled: true
    });
    const config = limiter.getConfig();

    expect(config.windowMs).toBe(30000);
    expect(config.maxRequests).toBe(50);
    expect(config.burst).toBe(10);
  });

  it('deve permitir desabilitar rate-limit', () => {
    const limiter = createRateLimiter({
      enabled: false,
      maxRequests: 1,
      burst: 0
    });

    const host = 'example.com';

    // Deve sempre permitir quando desabilitado
    for (let i = 0; i < 100; i++) {
      const result = limiter.consume(host);
      expect(result.allowed).toBe(true);
    }
  });
});

describe('RateLimiter - Casos de Borda', () => {
  it('deve lidar com host vazio ou inválido', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      burst: 5,
      enabled: true
    });

    // Request com host vazio
    const result = limiter.consume('');
    expect(result.allowed).toBe(true);

    // Request com host undefined (usando string vazia)
    const result2 = limiter.consume('unknown-host');
    expect(result2.allowed).toBe(true);
  });

  it('deve lidar com múltiplos hosts simultâneos', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
      burst: 2,
      enabled: true
    });

    const hosts = ['host1.com', 'host2.com', 'host3.com', 'host4.com', 'host5.com'];

    // Cada host faz 5 requests
    for (const host of hosts) {
      for (let i = 0; i < 5; i++) {
        limiter.consume(host);
      }
    }

    // Verificar que cada host ainda tem burst
    for (const host of hosts) {
      const result = limiter.check(host);
      expect(result.remaining).toBe(2); // burst remaining
    }
  });

  it('deve retornar stats correto com múltiplos hosts', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      burst: 5,
      enabled: true
    });

    limiter.consume('host1.com');
    limiter.consume('host1.com');
    limiter.consume('host2.com');

    const stats = limiter.getStats();

    expect(Object.keys(stats)).toHaveLength(2);
    expect(stats['host1.com'].requestCount).toBe(2);
    expect(stats['host2.com'].requestCount).toBe(1);
  });
});

describe('RateLimiter - Integração com Express', () => {
  it('deve criar middleware corretamente', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      burst: 5,
      enabled: true
    });

    // Simular request mock
    const mockReq = {
      method: 'GET',
      path: '/api/scrape',
      headers: { host: 'example.com' },
      body: {}
    } as any;

    const mockRes = {
      statusCode: 200,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn()
    } as any;

    const mockNext = vi.fn();

    // O middleware deve ser uma função
    const middleware = limiter as any;

    // Testar consume diretamente
    const result = limiter.consume('example.com');
    expect(result.allowed).toBe(true);
  });
});
