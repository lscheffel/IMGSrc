# CONTRIBUTING

## 10 Leis Fundamentais
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

## Fluxo de contribuição
1. Abra issue/RFC.
2. Implemente com testes.
3. Rode `npm run lint && npm run test && npm run build`.
4. Atualize docs canônicos e changelog.
