# STATE
date: 2026-03-30
current_version: 1.0.0
source_of_truth:
- app.py
- history.py
- preview.py

decisions:
- App desktop PyQt5; sem API HTTP/IPC externo.
- Contratos internos por sinais Qt (`ScraperThread`, `DownloadThread`).
- Persistencia em SQLite (`downloads`) com Redis opcional.
- Inicializacao limpa cache SQLite/Redis (`clear_cache=True`).
- Artefatos canonicos ciclo `000` sincronizados.

quality_gate:
todo_fixme_count: 0

next_task_id: RFC-001-Core-Throughput-Reliability-000
next_focus: desempenho, confiabilidade, persistencia nao destrutiva.
