# DATA_FLOW-000
```mermaid
flowchart LR
UI[React + Zustand] --> API[Node API]
UI --> VUE[Vue Widget]
API --> SCRAPE[Scraper Service]
API --> DL[Downloader Service]
API --> Q[Download Job Queue]
API --> M[Metrics Snapshot]
DL --> SQL[(SQLite)]
API --> SQL
Q --> DL
```
