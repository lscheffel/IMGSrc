# ROADMAP-000
Quality Gate: `TODO/FIXME` no source atual = **0**.

## Concluido
- [x] Busca multi-URL com validacao de dominio.
- [x] Scraping concorrente por pagina e por imagem.
- [x] Download concorrente com retry e validacao de integridade.
- [x] Persistencia SQLite + cache Redis opcional.
- [x] Abas de Historico (clear/export CSV) e Preview (thumb/export JSON).
- [x] Fluxo One Click (buscar + baixar).

## Proximo ciclo (base RFC-001)
- [ ] Persistencia nao destrutiva na inicializacao.
- [ ] Metricas de throughput/erro por estagio.
- [ ] Retry e backoff configuraveis.
- [ ] Contratos de eventos versionados.
