# IPC_API_CONTRACTS-000
Escopo real: sem API HTTP e sem IPC de processo. Contratos ativos sao sinais Qt internos.

| Emitter | Signal | Payload | Consumer |
|---|---|---|---|
| `ScraperThread` | `result_signal` | `[(url,size,user,title)], total, discarded` | `display_results` / `one_click_download` |
| `ScraperThread` | `error_signal` | `str` | `display_error` |
| `ScraperThread` | `title_signal` | `title, gallery_url` | `set_page_title` |
| `ScraperThread` | `user_signal` | `user, gallery_url` | `set_user_name` |
| `ScraperThread` | `progress_signal` | `str` | `add_item_and_scroll` |
| `DownloadThread` | `progress_signal` | `str` | `add_item_and_scroll` |
| `DownloadThread` | `finished_signal` | `downloads, mb, skipped, errors` | `download_finished` |
