# DATA_FLOW-000
```mermaid
flowchart LR
U[User URLs] --> V[Validate imgsrc.ru]
V --> S[ScraperThread]
S --> T[Discover tape pages]
T --> F[Filter format and size]
F --> P[PreviewTab]
F --> D[DownloadThread]
D --> FS[Filesystem]
D --> SQL[(SQLite downloads)]
D --> R[(Redis optional)]
SQL --> H[HistoryTab]
FS --> H
```

Rules:
- Apenas `.webp`/`.gif` entram na fila de download.
- `.jpg`/`.png` sao descartadas como miniaturas.
- `sync_folders` marca `status=deleted` quando arquivo some do disco.
- Inicializacao limpa SQLite/Redis (`clear_cache=True`).
