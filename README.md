# IMGSrc
Desktop app (PyQt5) para scraping e download em `imgsrc.ru`. Verdade atual: `app.py`, `history.py`, `preview.py`.

| Capability | Current behavior |
|---|---|
| Input | Aceita varias URLs de galeria, separadas por virgula; valida prefixo `https://imgsrc.ru`. |
| Scrape | Descobre `tape-*`, percorre paginas, filtra imagens por tamanho minimo. |
| Format filter | Mantem `.webp`/`.gif`; descarta `.jpg`/`.png` (miniaturas). |
| Download | Paralelo (1-48), com retry e validacao de integridade/tipo. |
| Storage | SQLite `downloads.db` + Redis opcional (`imgscraper:downloaded_urls`). |
| UI | Abas: Busca/Download, Historico, Preview. Botao One Click faz busca + download. |

Comportamento importante: na inicializacao, `init_db(clear_cache=True)` e `init_redis(clear_cache=True)` limpam cache/historico.

Run:
`python app.py`

Deps:
`pip install pyqt5 requests beautifulsoup4 redis validators`
