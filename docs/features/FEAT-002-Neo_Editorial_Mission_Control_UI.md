# FEAT-002-Neo_Editorial_Mission_Control_UI
status: Implemented  
owner: Feature Architect / UI Platform  
alignment:
- `docs/architecture/RFC-001-Worker_Queue_and_Metrics-000.md`
- `docs/architecture/ADR-000-Workflow_and_Commits.md`
- `docs/architecture/IPC_API_CONTRACTS-000.md`

## Enhanced Abstract
Objetivo: elevar a UI atual para um painel `Neo Editorial Tech` de nível enterprise, mantendo o núcleo operacional (busca, download, one-click, jobs assíncronos) e adicionando legibilidade, densidade informacional adaptativa e observabilidade viva.  
Abordagem técnica: decompor a tela única em módulos (`Overview`, `Search Studio`, `Download Control`, `One-Click Console`, `History`) com store tipado por slices, contratos de dados explícitos e fallback resiliente para estados parciais.  
Resultado esperado: UX robusta com feedback contínuo por estágio, timeline de eventos, métricas de throughput/ETA e ergonomia de operação prolongada.

## Technical Scope
| Layer | Paths Impactados | Tipo de Mudança |
|---|---|---|
| Frontend Shell | `apps/web/src/App.tsx`, `apps/web/src/main.tsx` | Refatorar layout para workspace modular |
| Frontend State | `apps/web/src/store/useScraperStore.ts`, `apps/web/src/types.ts` | Separar estado por domínios e selectors |
| Frontend Data | `apps/web/src/lib/api.ts` | Padronizar polling/erros e paginação de histórico |
| Frontend UI | `apps/web/src/components/*` (novo), `apps/web/src/styles.css` | Criar design primitives + blocos editoriais |
| Backend API | `apps/api/src/server.ts` | Extensões opcionais de contratos para suporte UX |
| Backend Tests | `apps/api/test/smoke.spec.ts` | Gate de contratos novos/expandidos |
| Frontend Tests | `apps/web/test/*.spec.ts` (expandir) | Gate de renderização, fluxo e estados |
| Tooling | `package.json`, `apps/web/package.json` | Novo entrypoint `test:e2e` (Playwright) |

## Contracts & Interfaces
### UI Domain Contracts (TypeScript)
```ts
type WorkspaceRoute = 'overview' | 'search_studio' | 'download_control' | 'one_click_console' | 'history';

type MetricCard = { id: string; label: string; value: number; delta?: number; unit?: string };
type EventItem = { id: string; at: string; channel: 'search'|'download'|'one-click'|'system'; level: 'info'|'warn'|'error'; text: string };
type TimelinePoint = { ts: number; percent: number };

type MissionControlState = {
  route: WorkspaceRoute;
  density: 'compact' | 'comfortable';
  cards: MetricCard[];
  liveEvents: EventItem[];
  searchTimeline: TimelinePoint[];
  downloadTimeline: TimelinePoint[];
  oneClickTimeline: TimelinePoint[];
};
```

### API Contracts (Propostos)
| Method | Route | Request | Response | Motivo |
|---|---|---|---|---|
| GET | `/api/history` | `?cursor&limit` | `{ items[], nextCursor? }` | Virtualização/paginação |
| GET | `/api/metrics` | `?windowSec` | `{ endpoints[], queue, throughput }` | KPIs de painel |
| GET | `/api/jobs/scrape` | `?limit&status` | `{ items[], queue }` | Operação por fila |
| GET | `/api/jobs/download` | `?limit&status` | `{ items[], queue }` | Operação por fila |

Observação: manter compatibilidade retroativa com payloads existentes (ADR-000).

### Fluxo de Dados (macro)
```mermaid
flowchart LR
  UI[Mission Control UI] --> Store[Zustand Slices]
  Store --> API[apps/web/src/lib/api.ts]
  API --> S1[/api/jobs/scrape]
  API --> S2[/api/jobs/download]
  API --> S3[/api/metrics]
  API --> S4[/api/history]
  S1 --> Store
  S2 --> Store
  S3 --> Store
  S4 --> Store
```

### Segurança Zero-Trust
- Usar somente placeholders em config: `VITE_API_URL`, `API_AUTH_TOKEN`, `SENTRY_DSN`.
- Proibido hardcode de credenciais, cookies ou headers sensíveis.
- Logs UI sem payload sensível (apenas IDs, status, tempos).

## TDD Roadmap
### Web Unit/Component Gates (falhar antes de implementar)
- `apps/web/test/layout.spec.ts`: renderiza shell modular com rotas de workspace.
- `apps/web/test/mission-control-cards.spec.ts`: KPI cards com fallback e delta.
- `apps/web/test/live-events.spec.ts`: feed ordenado, severidade e limite de buffer.
- `apps/web/test/progress-timelines.spec.ts`: timelines por fluxo e cálculo de ETA.
- `apps/web/test/history-virtualization.spec.ts`: paginação e estado vazio.

### Web Integration Gates
- `apps/web/test/flow-search-download.spec.ts`: jornada busca -> download com estados intermediários.
- `apps/web/test/one-click-console.spec.ts`: pipeline one-click com erro recuperável.

### API Integration Gates
- `apps/api/test/smoke.spec.ts`: contratos com query params (`limit`, `status`, `windowSec`).
- `apps/api/test/history-pagination.spec.ts` (novo): cursores e consistência de paginação.

### E2E Gates (novo entrypoint)
- `apps/web/e2e/mission-control.e2e.ts`: fluxo completo com backend local.
- Entry point esperado: `npm run test:e2e`.

## Implementation Tree (TodoWrite)
- [ ] Criar estrutura de componentes editoriais em `apps/web/src/components/mission-control/`.
- [ ] Refatorar `App.tsx` para roteamento de workspace e composição por módulos.
- [ ] Reorganizar `useScraperStore` em slices (`ui`, `jobs`, `history`, `metrics`).
- [ ] Normalizar contratos em `apps/web/src/types.ts` e adapter em `apps/web/src/lib/api.ts`.
- [ ] Implementar paginação/virtualização de histórico no frontend.
- [ ] Adicionar extensões de contrato no backend (`history cursor`, `metrics window`), sem breaking changes.
- [ ] Escrever testes unitários/integrados frontend (gates obrigatórios).
- [ ] Escrever testes de integração backend para contratos expandidos.
- [ ] Adicionar `test:e2e` no `package.json` (raiz e/ou `apps/web`) e suíte Playwright.
- [ ] Executar gate final: `lint`, `test`, `build`, `test:e2e`.

[READY FOR IMPLEMENTATION - DOCUMENTATION ISOLATED]
