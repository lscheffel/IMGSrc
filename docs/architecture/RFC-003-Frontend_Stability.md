# RFC-003: Estabilidade Frontend e UX

## Meta
Melhorar estabilidade e UX do frontend, resolvendo problemas de race conditions e interface.

## Escopo

### 1. Botão Reset (Prioridade Alta)
- **Problema:** Tela branca após clicar Reset
- **Causa:** Provavelmente estado Zustand corrompido ou erro não capturado
- **Solução:** Implementar reset via local state apenas (sem API), adicionar error boundary

### 2. Polling Backoff (Prioridade Alta)
- **Problema:** Polling a cada 450ms pode sobrecarregar API em cenários de erro
- **Solução:** Implementar backoff exponencial (450ms → 1s → 2s → 4s) com jitter

### 3. Tratamento de Edge Cases em Workers
- **Problema:** Workers podem ficar presos em loops ou deadlock
- **Solução:** Timeout configurável por task, health check dos workers

### 4. UX do Painel de Progresso
- **Problema:** Espaços vazios, informações confusas
- **Solução:** Skeleton loaders, estados consistentes, feedback claro

## Métricas de Sucesso
- Taxa de erro do frontend < 1%
- Reset button funcionando sem crashes
- Polling com backoff estável

## Tasks
- [ ] Implementar reset via local state (sem API call)
- [ ] Adicionar error boundary no React
- [ ] Implementar polling com backoff exponencial
- [ ] Adicionar health check nos workers
- [ ] Melhorar estados vazios no painel

## Timeline
**Sprint 1 (2-3 dias):** Reset button + error boundary  
**Sprint 2 (2-3 dias):** Polling backoff + worker timeouts  
**Sprint 3 (1-2 dias):** UX improvements