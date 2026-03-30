import { useMemo } from 'react';

import { useScraperStore } from './store/useScraperStore';

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

export default function App() {
  const state = useScraperStore();
  const validCount = state.images.length;

  const rows = useMemo(
    () =>
      state.images.map((image) => (
        <tr key={image.url} className="border-b border-slate-100">
          <td className="px-3 py-2 text-xs">{image.user}</td>
          <td className="px-3 py-2 text-xs">{image.title}</td>
          <td className="px-3 py-2 text-xs text-slate-600">{formatKb(image.size)}</td>
          <td className="px-3 py-2 text-xs text-blue-700">
            <a href={image.url} target="_blank" rel="noreferrer">
              abrir
            </a>
          </td>
        </tr>
      )),
    [state.images],
  );

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <header className="mb-6 rounded-2xl bg-ink px-6 py-5 text-white">
        <h1 className="text-2xl font-bold">IMGSrc v2</h1>
        <p className="mt-1 text-sm text-slate-200">
          React + Zustand + Vue Widget | API Node + SQLite
        </p>
      </header>

      <section className="mb-4 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">
        <label className="text-sm font-medium">
          URLs (uma por linha ou separadas por vírgula)
          <textarea
            className="mt-1 h-28 w-full rounded-lg border border-slate-300 p-2 text-sm"
            value={state.urlsInput}
            onChange={(event) => state.setField('urlsInput', event.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Min KB
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              value={state.minSizeKb}
              onChange={(event) => state.setField('minSizeKb', Number(event.target.value))}
            />
          </label>
          <label className="text-sm">
            Scrape Threads
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              value={state.scrapeThreads}
              onChange={(event) => state.setField('scrapeThreads', Number(event.target.value))}
            />
          </label>
          <label className="text-sm">
            URL Workers
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              value={state.urlWorkers}
              onChange={(event) => state.setField('urlWorkers', Number(event.target.value))}
            />
          </label>
          <label className="text-sm">
            Downloads Paralelos
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              value={state.downloadsParallel}
              onChange={(event) => state.setField('downloadsParallel', Number(event.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Pasta de destino
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              value={state.destFolder}
              onChange={(event) => state.setField('destFolder', event.target.value)}
            />
          </label>
          <div className="flex items-end gap-4">
            <label className="text-sm">
              <input
                type="checkbox"
                className="mr-2"
                checked={state.overwrite}
                onChange={(event) => state.setField('overwrite', event.target.checked)}
              />
              Sobrescrever
            </label>
            <label className="text-sm">
              <input
                type="checkbox"
                className="mr-2"
                checked={state.createUserFolder}
                onChange={(event) => state.setField('createUserFolder', event.target.checked)}
              />
              Pasta usuário
            </label>
            <label className="text-sm">
              <input
                type="checkbox"
                className="mr-2"
                checked={state.createAlbumFolder}
                onChange={(event) => state.setField('createAlbumFolder', event.target.checked)}
              />
              Pasta álbum
            </label>
          </div>
        </div>
      </section>

      <section className="mb-4 flex flex-wrap gap-2">
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => void state.runSearch()}
          disabled={state.loading}
        >
          Buscar
        </button>
        <button
          className="rounded-lg bg-mint px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => void state.runDownload()}
          disabled={state.loading}
        >
          Download
        </button>
        <button
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => void state.runOneClick()}
          disabled={state.loading}
        >
          One Click
        </button>
      </section>

      <section className="mb-4">
        <vue-scrape-stats valid={validCount} discarded={state.discardedImages} />
      </section>

      {state.error ? (
        <section className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </section>
      ) : null}

      {state.warnings.length ? (
        <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Avisos da busca: {state.warnings.slice(0, 3).join(' | ')}
        </section>
      ) : null}

      {state.downloadStats ? (
        <section className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Downloads: {state.downloadStats.totalDownloads} | MB: {state.downloadStats.totalMb} | Pulados:{' '}
          {state.downloadStats.skipped} | Erros: {state.downloadStats.errors}
        </section>
      ) : null}

      <section className="overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold uppercase">Usuário</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase">Título</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase">Tamanho</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase">URL</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </section>
    </main>
  );
}
