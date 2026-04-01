# ADR-000-Workflow_and_Commits

## Status
Accepted

## Decisão
Workflow trunk-based com PR curta, CI obrigatória e commits atômicos.

## Regras
1. Toda feature inicia por issue/RFC.
2. Teste obrigatório para regra de negócio nova.
3. Bloqueio de merge se `lint/test/build` falharem.
4. Changelog e state atualizados no mesmo PR.
5. ESLint usa flat config (`eslint.config.js`) como fonte única.

## Resultado esperado
Rastreabilidade forte e regressão reduzida.
