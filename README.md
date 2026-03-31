# IMGSrc v2.2.0

**[READY FOR DEVELOPMENT]**


## O Projeto
Ferramenta de scraping de galleries do imgsrc.ru com download automático de imagens. Desenvolvida como monorepo Node/TypeScript com API REST e interface React.

### Objetivos
- Automatizar busca e download de imagens em bulk
- Fornecer feedback visual em tempo real (progresso, ETA, contadores)
- Gerenciar histórico de downloads com persistência SQLite

### Prós
- Stack moderna e type-safe (TypeScript + Zod)
- Pipeline CI/CD robusto (lint/test/build)
- Frontend com UI responsiva e estados visuais claros
- Contratos HTTP versionados e documentados

### Contras
- Rate-limiting ainda manual (próxima iteração)
- Sem workers dedicados em processos separados (roadmap)
- Cobertura E2E em Playwright pendente

## Stack Ouro
**Node + SQLite + React + Vite + Tailwind + Vue + Zustand + TypeScript**.

## Estrutura
```
imgsrc-gold-stack/
├── apps/
│   ├── api/          # Express API + SQLite
│   └── web/          # React + Vue widget
├── docs/
│   ├── architecture/ # RFCs, ADRs, Contratos
│   ├── roadmaps/     # Progress tracking
│   ├── features/    # Feature specs
│   └── performance/ # Baselines
└── .kilo/           # STATE.md (memória)
```

## 10 Leis de Engenharia
1. **Atomicidade:** commits pequenos, revertíveis e semanticamente claros.
2. **TDD:** comportamento novo nasce com teste.
3. **Zero-Trust:** sem secrets hardcoded; use `.env`.
4. **Código como Verdade:** docs sempre refletem `src/`.
5. **Contratos Primeiro:** APIs/IPCs versionados antes da implementação.
6. **SemVer Estrito:** MAJOR/MINOR/PATCH conforme impacto real.
7. **Qualidade de Pipeline:** `lint`, `test`, `build` devem passar em CI.
8. **Observabilidade:** erro deve ter contexto mínimo para diagnóstico.
9. **Concisão Canônica:** documentação curta, versionada e útil.
10. **Estado Vivo:** atualizar `.kilo/STATE.md` e roadmaps a cada fase.

> Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Operação

| Comando | Ação |
|---|---|
| `npm run dev` | Sobe API + Web em paralelo (ports 8787, 5173) |
| `npm run dev:stop` | Mata portas 8787 5173 5174 |
| `npm run dev:reset` | Restart completo |
| `npm run build` | Build workspaces |
| `npm run test` | Test workspaces |
| `npm run lint` | Lint workspaces |
| `npm run clean` | Clean + coverage |

## API Endpoints
| Method | Route | Descrição |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/scrape` | Scraping síncrono |
| POST | `/api/download` | Download síncrono |
| POST | `/api/jobs/scrape` | Job assíncrono de scraping |
| GET | `/api/jobs/scrape/:jobId` | Status do job |
| POST | `/api/jobs/download` | Job assíncrono de download |
| GET | `/api/jobs/download/:jobId` | Status do job |
| GET | `/api/history?limit&cursor` | Histórico paginado |
| GET | `/api/metrics` | Métricas p50/p95 |

## Docs
- [CHANGELOG.md](CHANGELOG.md)
- [docs/roadmaps/](docs/roadmaps/)
- [.kilo/STATE.md](.kilo/STATE.md)
