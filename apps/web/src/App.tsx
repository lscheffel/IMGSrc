import { useMemo } from 'react';

import { useScraperStore } from './store/useScraperStore';

type TimelinePoint = {
  ts: number;
  percent: number;
};

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '--';
  }
  const rounded = Math.max(0, Math.round(seconds));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatRate(value: number, unit = ''): string {
  const suffix = unit ? ` ${unit}` : '';
  if (!Number.isFinite(value) || value <= 0) {
    return `0${suffix}`;
  }
  if (value >= 10) {
    return `${value.toFixed(1)}${suffix}`;
  }
  return `${value.toFixed(2)}${suffix}`;
}

function formatEventTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour12: false });
}

function Sparkline(props: {
  tone: 'blue' | 'green' | 'amber';
  points: TimelinePoint[];
}) {
  const strokeClass =
    props.tone === 'green'
      ? 'stroke-emerald-500'
      : props.tone === 'amber'
        ? 'stroke-amber-500'
        : 'stroke-blue-600';
  const items = props.points.slice(-48);
  if (items.length < 2) {
    return <div className="mt-2 h-10 rounded bg-slate-50" />;
  }

  const width = 240;
  const height = 44;
  const maxIndex = Math.max(items.length - 1, 1);
  const points = items
    .map((item, index) => {
      const x = 2 + (index / maxIndex) * (width - 4);
      const y = height - 2 - (item.percent / 100) * (height - 4);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      className="mt-2 h-10 w-full rounded bg-slate-50"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="historico de progresso"
    >
      <polyline
        points={`0,${height - 1} ${width},${height - 1}`}
        className="fill-none stroke-slate-200"
        strokeWidth={1}
      />
      <polyline points={points} className={`fill-none ${strokeClass}`} strokeWidth={2.4} />
    </svg>
  );
}

function ProgressBar(props: {
  label: string;
  value: number;
  tone: 'blue' | 'green' | 'amber';
  subtitle?: string;
  meta?: string;
  active?: boolean;
  points: TimelinePoint[];
}) {
  const toneClass =
    props.tone === 'green'
      ? 'bg-emerald-500'
      : props.tone === 'amber'
        ? 'bg-amber-500'
        : 'bg-blue-600';
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">{props.label}</p>
        <p className="text-xs font-semibold text-slate-600">{props.value}%</p>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full ${toneClass} transition-all duration-300 ease-out ${
            props.active ? 'animate-pulse' : ''
          }`}
          style={{ width: `${props.value}%` }}
        />
      </div>
      {props.subtitle ? <p className="mt-2 text-xs text-slate-500">{props.subtitle}</p> : null}
      {props.meta ? <p className="mt-1 text-xs font-semibold text-slate-600">{props.meta}</p> : null}
      <Sparkline tone={props.tone} points={props.points} />
    </section>
  );
}

export default function App() {
  const state = useScraperStore();
  const validCount = state.images.length;
  const searchPercent = state.searchProgress
    ? toPercent(state.searchProgress.pagesProcessed, Math.max(state.searchProgress.pagesTotal, 1))
    : 0;
  const downloadPercent = state.downloadProgress
    ? toPercent(state.downloadProgress.processed, Math.max(state.downloadProgress.total, 1))
    : 0;
  const oneClickPercent = state.oneClickProgress.percent;
  const liveEvents = useMemo(() => [...state.liveEvents].reverse(), [state.liveEvents]);
  const oneClickStart = state.oneClickTimeline[0];
  const oneClickEnd = state.oneClickTimeline.at(-1);
  const oneClickElapsedSec = oneClickStart && oneClickEnd
    ? (oneClickEnd.ts - oneClickStart.ts) / 1000
    : 0;

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

      <section className="mb-4 grid gap-3 md:grid-cols-3">
        <ProgressBar
          label="Busca"
          value={searchPercent}
          tone="blue"
          active={state.searchProgress ? !['completed', 'failed'].includes(state.searchProgress.stage) : false}
          points={state.searchTimeline}
          subtitle={
            state.searchProgress
              ? `${state.searchProgress.stage} | páginas ${state.searchProgress.pagesProcessed}/${state.searchProgress.pagesTotal}`
              : 'Aguardando execução'
          }
          meta={`ETA ${formatEta(state.searchLive.etaSec)} | ${formatRate(state.searchLive.pagesPerSec, 'pag/s')}`}
        />
        <ProgressBar
          label="Download"
          value={downloadPercent}
          tone="green"
          active={
            state.downloadProgress ? !['completed', 'failed'].includes(state.downloadProgress.stage) : false
          }
          points={state.downloadTimeline}
          subtitle={
            state.downloadProgress
              ? `${state.downloadProgress.stage} | itens ${state.downloadProgress.processed}/${state.downloadProgress.total}`
              : 'Aguardando execução'
          }
          meta={`ETA ${formatEta(state.downloadLive.etaSec)} | ${formatRate(state.downloadLive.filesPerSec, 'arq/s')}`}
        />
        <ProgressBar
          label="One Click"
          value={oneClickPercent}
          tone="amber"
          active={['searching', 'downloading'].includes(state.oneClickProgress.stage)}
          points={state.oneClickTimeline}
          subtitle={
            state.oneClickProgress.message || `stage: ${state.oneClickProgress.stage}`
          }
          meta={`Stage ${state.oneClickProgress.stage} | Tempo ${formatEta(oneClickElapsedSec)}`}
        />
      </section>

      <section className="mb-4 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <article className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">Páginas/s</p>
          <p className="text-xl font-bold text-slate-800">{formatRate(state.searchLive.pagesPerSec, '')}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">Valid/s</p>
          <p className="text-xl font-bold text-slate-800">{formatRate(state.searchLive.validPerSec, '')}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">Arq/s</p>
          <p className="text-xl font-bold text-slate-800">{formatRate(state.downloadLive.filesPerSec, '')}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">MB/s</p>
          <p className="text-xl font-bold text-slate-800">{formatRate(state.downloadLive.mbPerSec, '')}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">Válidas</p>
          <p className="text-xl font-bold text-slate-800">{validCount}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">Descartadas</p>
          <p className="text-xl font-bold text-slate-800">{state.discardedImages}</p>
        </article>
      </section>

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Feed On-The-Fly</p>
          <p className="text-xs text-slate-500">{liveEvents.length} eventos</p>
        </div>
        <div className="max-h-36 space-y-1 overflow-auto">
          {liveEvents.length ? (
            liveEvents.map((event) => (
              <p key={`${event.channel}-${event.at}-${event.text}`} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
                <span className="font-semibold text-slate-500">[{formatEventTime(event.at)}]</span>{' '}
                <span className="uppercase text-slate-500">{event.channel}</span> {event.text}
              </p>
            ))
          ) : (
            <p className="text-xs text-slate-500">Sem eventos recentes.</p>
          )}
        </div>
      </section>

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
