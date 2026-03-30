# CONTRIBUTING
Leis Fundamentais (obrigatorias):

1. Codigo e a unica verdade.
2. Documentacao reflete codigo.
3. Arquivos canonicos em `docs/` usam sufixo `-000.md`.
4. Mudanca funcional exige atualizar contratos e diagramas.
5. Mudanca de fluxo exige atualizar roadmap.
6. `CHANGELOG.md` deriva apenas do diff de codigo.
7. SemVer segue impacto real (MAJOR/MINOR/PATCH).
8. Concisao extrema: doc curta e objetiva.
9. `TODO/FIXME` entra no topo do proximo RFC.
10. Atualize `.kilo/STATE.md` com estado e `next_task_id`.

Fluxo minimo:
1. Alterar codigo.
2. Verificar debitos (`rg "TODO|FIXME"`).
3. Sincronizar docs canonicos.
4. Atualizar changelog, SemVer e state.
