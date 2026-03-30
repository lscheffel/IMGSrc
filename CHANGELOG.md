# CHANGELOG
SemVer atual: `v1.0.0` (auditoria em 2026-03-30).  
Base: diff funcional de source; sem incremento apos baseline.

## [1.0.0] - 2026-03-30
### Added
- App PyQt5 com 3 abas: Busca/Download, Historico, Preview.
- `ScraperThread` e `DownloadThread` com processamento concorrente.
- Input multi-URL, filtro de tamanho e aceite de `.webp/.gif`.
- Persistencia SQLite (`downloads`, `status`, `url_hash`) e Redis opcional.
- Exportacoes: historico CSV e lista de URLs em JSON.

### Behavior
- Inicializacao limpa cache SQLite/Redis (`clear_cache=True`).
