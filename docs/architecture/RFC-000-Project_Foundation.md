# RFC-000-Project_Foundation

## Decisão
Adotar stack web full stack com Node + SQLite + React + Vite + Tailwind + Vue + Zustand + TypeScript.

## Motivação
- Escalabilidade de manutenção.
- Pipeline CI determinístico.
- Contratos HTTP explícitos.

## Escopo
- `apps/api`: scraping/download/histórico.
- `apps/web`: interface de busca, preview e execução.
- Documentação canônica em `docs/`.

## Consequências
- Quebra arquitetural intencional (desktop -> web).
- SemVer MAJOR para `2.0.0`.

