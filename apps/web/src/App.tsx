import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CommandPalette } from './components/mission-control/CommandPalette';
import { HistoryVirtualList } from './components/mission-control/HistoryVirtualList';
import { WorkspaceSidebar } from './components/mission-control/WorkspaceSidebar';
import type { CommandAction, WorkspaceItem, WorkspaceRoute } from './components/mission-control/types';
import { fetchHistoryPage, fetchOpsSnapshot } from './lib/api';
import { useScraperStore, type PresetName } from './store/useScraperStore';
import type { HistoryRecord } from './types';

type DensityMode = 'compact' | 'comfortable';
type PaletteMode =
  | 'cobalt'
  | 'ember'
  | 'verdant'
  | 'vscode-dark-default'
  | 'vscode-dark-plus'
  | 'kimbie-dark';

type TimelinePoint = {
  ts: number;
  percent: number;
};

type ApiStatus = 'checking' | 'online' | 'degraded' | 'offline';
type QueueStatus = 'unknown' | 'idle' | 'processing' | 'backlog';
type ToastTone = 'info' | 'success' | 'warning' | 'danger';
type UiToast = {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
};

const WORKSPACES: WorkspaceItem[] = [
  { id: 'overview', label: 'Overview', description: 'Saude operacional e throughput' },
  { id: 'search_studio', label: 'Search Studio', description: 'Coleta e validacao de midias' },
  { id: 'download_control', label: 'Download Control', description: 'Lotes, destino e paralelismo' },
  { id: 'one_click_console', label: 'One-Click Console', description: 'Pipeline ponta a ponta' },
  { id: 'history', label: 'History', description: 'Auditoria e resultados' }
];

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

function Sparkline(props: { tone: 'blue' | 'green' | 'amber'; points: TimelinePoint[] }): React.JSX.Element {
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

function SurfaceCard(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="neo-surface rounded-2xl border border-white/30 p-4 shadow-lg shadow-slate-900/5">
      <div className="mb-3">
        <p className="neo-main-text text-sm font-semibold tracking-wide">{props.title}</p>
        {props.subtitle ? <p className="neo-muted-text text-xs">{props.subtitle}</p> : null}
      </div>
      {props.children}
    </section>
  );
}

function MetricCard(props: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <article className="neo-surface rounded-xl border border-white/20 p-3">
      <p className="neo-muted-text text-[11px] uppercase tracking-wider">{props.label}</p>
      <p className="neo-main-text mt-1 text-xl font-semibold">{props.value}</p>
      {props.hint ? <p className="neo-muted-text mt-1 text-xs">{props.hint}</p> : null}
    </article>
  );
}

function ProgressRail(props: {
  label: string;
  value: number;
  tone: 'blue' | 'green' | 'amber';
  subtitle?: string;
  meta?: string;
  active?: boolean;
  points: TimelinePoint[];
}): React.JSX.Element {
  const toneClass =
    props.tone === 'green'
      ? 'bg-emerald-500'
      : props.tone === 'amber'
        ? 'bg-amber-500'
        : 'bg-blue-600';
  return (
    <section className="neo-surface rounded-xl border border-slate-200/60 p-4 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="neo-sub-text text-sm font-semibold">{props.label}</p>
        <p className="neo-sub-text text-xs font-semibold">{props.value}%</p>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full ${toneClass} transition-all duration-300 ease-out ${
            props.active ? 'animate-pulse' : ''
          }`}
          style={{ width: `${props.value}%` }}
        />
      </div>
      {props.subtitle ? <p className="neo-muted-text mt-2 text-xs">{props.subtitle}</p> : null}
      {props.meta ? <p className="neo-sub-text mt-1 text-xs font-semibold">{props.meta}</p> : null}
      <Sparkline tone={props.tone} points={props.points} />
    </section>
  );
}

function LiveEventFeed(props: {
  events: Array<{ channel: string; at: number; text: string }>;
}): React.JSX.Element {
  return (
    <div className="max-h-72 space-y-2 overflow-auto pr-1">
      {props.events.length ? (
        props.events.map((event) => (
          <article
            key={`${event.channel}-${event.at}-${event.text}`}
            className="neo-surface rounded-lg border border-slate-200/70 px-3 py-2 backdrop-blur"
          >
            <p className="neo-muted-text text-[11px] font-semibold uppercase tracking-wider">
              {event.channel} - {formatEventTime(event.at)}
            </p>
            <p className="neo-sub-text mt-1 text-sm">{event.text}</p>
          </article>
        ))
      ) : (
        <p className="neo-muted-text text-sm">Sem eventos recentes.</p>
      )}
    </div>
  );
}

function ResultsTable(props: {
  rows: Array<{ url: string; user: string; title: string; size: number }>;
}): React.JSX.Element {
  return (
    <section className="neo-surface overflow-auto rounded-2xl border border-slate-200/60 backdrop-blur-sm">
      <table className="w-full border-collapse">
        <thead className="bg-slate-100/70 text-left">
          <tr>
            <th className="neo-muted-text px-3 py-2 text-xs font-semibold uppercase tracking-wider">Usuario</th>
            <th className="neo-muted-text px-3 py-2 text-xs font-semibold uppercase tracking-wider">Titulo</th>
            <th className="neo-muted-text px-3 py-2 text-xs font-semibold uppercase tracking-wider">Tamanho</th>
            <th className="neo-muted-text px-3 py-2 text-xs font-semibold uppercase tracking-wider">URL</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((image) => (
            <tr key={image.url} className="border-b border-slate-200/60">
              <td className="neo-sub-text px-3 py-2 text-xs">{image.user}</td>
              <td className="neo-sub-text px-3 py-2 text-xs">{image.title}</td>
              <td className="neo-muted-text px-3 py-2 text-xs">{formatKb(image.size)}</td>
              <td className="px-3 py-2 text-xs text-blue-700">
                <a href={image.url} target="_blank" rel="noreferrer">
                  abrir
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PresetChip(props: {
  id: PresetName;
  selected: PresetName;
  onSelect: (preset: PresetName) => void;
}): React.JSX.Element {
  const label = props.id === 'safe' ? 'Safe' : props.id === 'turbo' ? 'Turbo' : 'Balanced';
  const selected = props.id === props.selected;
  return (
    <button
      className={`neo-chip rounded-full px-4 py-2 text-sm font-semibold transition ${
        selected ? 'neo-chip-active' : ''
      }`}
      onClick={() => props.onSelect(props.id)}
    >
      {label}
    </button>
  );
}

function SkeletonRow(props: { compact?: boolean }): React.JSX.Element {
  return (
    <div className={`neo-skeleton rounded-lg ${props.compact ? 'h-6' : 'h-10'}`} />
  );
}

function ToastStack(props: { items: UiToast[] }): React.JSX.Element | null {
  if (!props.items.length) {
    return null;
  }
  return (
    <section className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(28rem,92vw)] flex-col gap-2">
      {props.items.map((toast) => (
        <article key={toast.id} className={`neo-toast neo-toast-${toast.tone}`}>
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.detail ? <p className="mt-0.5 text-xs opacity-90">{toast.detail}</p> : null}
        </article>
      ))}
    </section>
  );
}

export default function App() {
  const state = useScraperStore();
  const applyPreset = state.applyPreset;
  const selectedPreset = state.selectedPreset;
  const runSearch = state.runSearch;
  const runDownload = state.runDownload;
  const runOneClick = state.runOneClick;
  const [route, setRoute] = useState<WorkspaceRoute>('overview');
  const [density, setDensity] = useState<DensityMode>('comfortable');
  const [palette, setPalette] = useState<PaletteMode>('cobalt');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryRecord[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [queueStatus, setQueueStatus] = useState<QueueStatus>('unknown');
  const [queueSummary, setQueueSummary] = useState('run 0 | fila 0');
  const [toasts, setToasts] = useState<UiToast[]>([]);
  const previousErrorRef = useRef<string | null>(null);
  const previousSearchStageRef = useRef<string | null>(null);
  const previousDownloadStageRef = useRef<string | null>(null);
  const previousOneClickStageRef = useRef<string | null>(null);
  const previousApiRef = useRef<ApiStatus>('checking');

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
  const rows = useMemo(() => state.images.map((image) => ({ ...image })), [state.images]);
  const pushToast = useCallback((tone: ToastTone, title: string, detail?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current.slice(-3), { id, tone, title, detail }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4400);
  }, []);

  const loadHistoryPage = useCallback(
    async (reset = false) => {
      if (historyLoading) {
        return;
      }
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const page = await fetchHistoryPage({
          limit: 60,
          cursor: reset ? undefined : historyCursor
        });
        setHistoryItems((current) => (reset ? page.items : [...current, ...page.items]));
        setHistoryCursor(page.nextCursor);
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : 'Falha ao carregar historico');
      } finally {
        setHistoryLoading(false);
      }
    },
    [historyCursor, historyLoading],
  );

  useEffect(() => {
    if (route === 'history' && historyItems.length === 0 && !historyLoading) {
      void loadHistoryPage(true);
    }
  }, [historyItems.length, historyLoading, loadHistoryPage, route]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      setApiStatus('online');
      setQueueStatus('idle');
      setQueueSummary('run 0 | fila 0');
      return;
    }

    let active = true;
    const syncOps = async () => {
      try {
        const snapshot = await fetchOpsSnapshot();
        if (!active) {
          return;
        }

        const scrapeRunning = Math.max(snapshot.queue.scrape.running, 0);
        const downloadRunning = snapshot.queue.download.running ? 1 : 0;
        const queued = Math.max(snapshot.queue.download.queued, 0);
        const running = scrapeRunning + downloadRunning;

        setApiStatus(snapshot.status === 'ok' ? 'online' : 'degraded');
        if (queued > 0) {
          setQueueStatus('backlog');
        } else if (running > 0) {
          setQueueStatus('processing');
        } else {
          setQueueStatus('idle');
        }
        setQueueSummary(`run ${running} | fila ${queued}`);
      } catch {
        if (!active) {
          return;
        }
        setApiStatus('offline');
        setQueueStatus('unknown');
        setQueueSummary('sem telemetria');
      }
    };

    void syncOps();
    const interval = window.setInterval(() => {
      void syncOps();
    }, 4500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
        return;
      }
      if (event.altKey && event.key === '1') {
        event.preventDefault();
        void runSearch();
        return;
      }
      if (event.altKey && event.key === '2') {
        event.preventDefault();
        void runDownload();
        return;
      }
      if (event.altKey && event.key === '3') {
        event.preventDefault();
        void runOneClick();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDensity((current) => (current === 'compact' ? 'comfortable' : 'compact'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runDownload, runOneClick, runSearch]);

  useEffect(() => {
    if (!state.error) {
      return;
    }
    if (state.error.toLowerCase().includes('fetch')) {
      setApiStatus('offline');
      return;
    }
    setApiStatus((current) => (current === 'offline' ? current : 'degraded'));
  }, [state.error]);

  useEffect(() => {
    if (state.error && state.error !== previousErrorRef.current) {
      pushToast('danger', 'Falha na operacao', state.error);
    }
    previousErrorRef.current = state.error;
  }, [pushToast, state.error]);

  useEffect(() => {
    const stage = state.searchProgress?.stage ?? null;
    if (!stage || stage === previousSearchStageRef.current) {
      return;
    }
    if (stage === 'completed') {
      pushToast('success', 'Busca concluida', `${state.images.length} imagens validas`);
    } else if (stage === 'failed') {
      pushToast('danger', 'Busca falhou', state.searchProgress?.message ?? 'Erro desconhecido');
    } else if (stage === 'resolving_urls' || stage === 'scanning_pages') {
      pushToast('info', 'Busca em andamento', `Stage ${stage}`);
    }
    previousSearchStageRef.current = stage;
  }, [pushToast, state.images.length, state.searchProgress]);

  useEffect(() => {
    const progress = state.downloadProgress;
    const stage = progress?.stage ?? null;
    if (!stage || stage === previousDownloadStageRef.current) {
      return;
    }
    if (stage === 'completed') {
      pushToast('success', 'Download concluido', `${state.downloadStats?.totalDownloads ?? 0} arquivos`);
    } else if (stage === 'failed') {
      pushToast('danger', 'Download falhou', progress?.message ?? 'Erro desconhecido');
    } else if (stage === 'running' && progress) {
      pushToast('info', 'Download iniciado', `${progress.processed}/${progress.total}`);
    }
    previousDownloadStageRef.current = stage;
  }, [pushToast, state.downloadProgress, state.downloadStats?.totalDownloads]);

  useEffect(() => {
    const stage = state.oneClickProgress.stage;
    if (stage === previousOneClickStageRef.current) {
      return;
    }
    if (stage === 'completed') {
      pushToast('success', 'One-click finalizado', state.oneClickProgress.message);
    } else if (stage === 'failed') {
      pushToast('danger', 'One-click falhou', state.oneClickProgress.message);
    } else if (stage === 'searching' || stage === 'downloading') {
      pushToast('info', 'One-click em execucao', `Stage ${stage}`);
    }
    previousOneClickStageRef.current = stage;
  }, [pushToast, state.oneClickProgress.message, state.oneClickProgress.stage]);

  useEffect(() => {
    if (apiStatus === previousApiRef.current) {
      return;
    }
    if (apiStatus === 'offline') {
      pushToast('warning', 'API indisponivel', 'Verifique backend e porta 8787');
    } else if (apiStatus === 'online' && previousApiRef.current === 'offline') {
      pushToast('success', 'API reconectada');
    } else if (apiStatus === 'degraded') {
      pushToast('warning', 'API degradada', 'Alguma operacao respondeu com alerta');
    }
    previousApiRef.current = apiStatus;
  }, [apiStatus, pushToast]);

  useEffect(() => {
    try {
      const savedDensity = localStorage.getItem('neo_density');
      const savedPalette = localStorage.getItem('neo_palette');
      const savedRoute = localStorage.getItem('neo_route');
      const savedPreset = localStorage.getItem('neo_preset');
      if (savedDensity === 'compact' || savedDensity === 'comfortable') {
        setDensity(savedDensity);
      }
      if (
        savedPalette === 'cobalt' ||
        savedPalette === 'ember' ||
        savedPalette === 'verdant' ||
        savedPalette === 'vscode-dark-default' ||
        savedPalette === 'vscode-dark-plus' ||
        savedPalette === 'kimbie-dark'
      ) {
        setPalette(savedPalette);
      }
      if (savedRoute && WORKSPACES.some((item) => item.id === savedRoute)) {
        setRoute(savedRoute as WorkspaceRoute);
      }
      if (savedPreset === 'safe' || savedPreset === 'balanced' || savedPreset === 'turbo') {
        applyPreset(savedPreset);
      }
    } catch {
      // localStorage indisponivel
    }
  }, [applyPreset]);

  useEffect(() => {
    try {
      localStorage.setItem('neo_density', density);
      localStorage.setItem('neo_palette', palette);
      localStorage.setItem('neo_route', route);
      localStorage.setItem('neo_preset', selectedPreset);
    } catch {
      // localStorage indisponivel
    }
  }, [density, palette, route, selectedPreset]);

  const liveStats = [
    { label: 'Paginas/s', value: formatRate(state.searchLive.pagesPerSec), hint: 'ritmo de coleta' },
    { label: 'Validas/s', value: formatRate(state.searchLive.validPerSec), hint: 'filtro de tamanho' },
    { label: 'Arquivos/s', value: formatRate(state.downloadLive.filesPerSec), hint: 'download corrente' },
    { label: 'MB/s', value: formatRate(state.downloadLive.mbPerSec), hint: 'throughput atual' },
    { label: 'Validas', value: String(validCount), hint: 'inventario atual' },
    { label: 'Descartadas', value: String(state.discardedImages), hint: 'fora do criterio' }
  ];

  const quickActions = (
    <div className="flex flex-wrap gap-2">
      <button
        className="neo-btn neo-btn-primary shadow disabled:opacity-50"
        onClick={() => void runSearch()}
        disabled={state.loading}
      >
        Iniciar Busca
      </button>
      <button
        className="neo-btn neo-btn-secondary shadow disabled:opacity-50"
        onClick={() => void runDownload()}
        disabled={state.loading}
      >
        Iniciar Download
      </button>
      <button
        className="neo-btn neo-btn-warning shadow disabled:opacity-50"
        onClick={() => void runOneClick()}
        disabled={state.loading}
      >
        One-Click
      </button>
    </div>
  );

  const progressDeck = (
    <section className="grid gap-3 lg:grid-cols-3">
      <ProgressRail
        label="Busca"
        value={searchPercent}
        tone="blue"
        active={state.searchProgress ? !['completed', 'failed'].includes(state.searchProgress.stage) : false}
        points={state.searchTimeline}
        subtitle={
          state.searchProgress
            ? `${state.searchProgress.stage} | paginas ${state.searchProgress.pagesProcessed}/${state.searchProgress.pagesTotal}`
            : 'Aguardando execucao'
        }
        meta={`ETA ${formatEta(state.searchLive.etaSec)} | ${formatRate(state.searchLive.pagesPerSec, 'pag/s')}`}
      />
      <ProgressRail
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
            : 'Aguardando execucao'
        }
        meta={`ETA ${formatEta(state.downloadLive.etaSec)} | ${formatRate(state.downloadLive.filesPerSec, 'arq/s')}`}
      />
      <ProgressRail
        label="One-Click"
        value={oneClickPercent}
        tone="amber"
        active={['searching', 'downloading'].includes(state.oneClickProgress.stage)}
        points={state.oneClickTimeline}
        subtitle={state.oneClickProgress.message || `stage: ${state.oneClickProgress.stage}`}
        meta={`Stage ${state.oneClickProgress.stage} | Tempo ${formatEta(oneClickElapsedSec)}`}
      />
    </section>
  );

  const commandActions = useMemo<CommandAction[]>(() => {
    const workspaceActions: CommandAction[] = WORKSPACES.map((workspace) => ({
      id: `nav-${workspace.id}`,
      label: `Ir para ${workspace.label}`,
      group: 'Navigation',
      hint: workspace.description,
      keywords: ['workspace', workspace.id, workspace.label.toLowerCase()],
      run: () => setRoute(workspace.id)
    }));

    const presetActions: Array<{ preset: PresetName; label: string }> = [
      { preset: 'safe', label: 'Aplicar preset Safe' },
      { preset: 'balanced', label: 'Aplicar preset Balanced' },
      { preset: 'turbo', label: 'Aplicar preset Turbo' }
    ];

    const paletteActions: Array<{ id: PaletteMode; label: string }> = [
      { id: 'cobalt', label: 'Paleta Cobalt' },
      { id: 'ember', label: 'Paleta Ember' },
      { id: 'verdant', label: 'Paleta Verdant' },
      { id: 'vscode-dark-default', label: 'Tema VSCode Dark Default' },
      { id: 'vscode-dark-plus', label: 'Tema VSCode Dark+' },
      { id: 'kimbie-dark', label: 'Tema Kimbie Dark' }
    ];

    return [
      ...workspaceActions,
      {
        id: 'run-search',
        label: 'Executar Busca',
        group: 'Execution',
        shortcut: 'Alt+1',
        keywords: ['buscar', 'scrape'],
        run: () => void runSearch()
      },
      {
        id: 'run-download',
        label: 'Executar Download',
        group: 'Execution',
        shortcut: 'Alt+2',
        keywords: ['baixar', 'download'],
        run: () => void runDownload()
      },
      {
        id: 'run-oneclick',
        label: 'Executar One-Click',
        group: 'Execution',
        shortcut: 'Alt+3',
        keywords: ['pipeline', 'one-click'],
        run: () => void runOneClick()
      },
      ...presetActions.map((item) => ({
        id: `preset-${item.preset}`,
        label: item.label,
        group: 'Presets',
        keywords: ['preset', item.preset],
        run: () => applyPreset(item.preset)
      })),
      ...paletteActions.map((item) => ({
        id: `palette-${item.id}`,
        label: item.label,
        group: 'Visual',
        keywords: ['palette', 'theme', item.id],
        run: () => setPalette(item.id)
      })),
      {
        id: 'toggle-density',
        label: 'Alternar densidade de layout',
        group: 'Visual',
        shortcut: 'Alt+D',
        keywords: ['density', 'compact', 'comfortable'],
        run: () => setDensity((current) => (current === 'compact' ? 'comfortable' : 'compact'))
      },
      {
        id: 'refresh-history',
        label: 'Recarregar historico',
        group: 'Data',
        keywords: ['history', 'refresh'],
        run: () => void loadHistoryPage(true)
      }
    ];
  }, [applyPreset, loadHistoryPage, runDownload, runOneClick, runSearch]);

  const apiStatusClass = apiStatus === 'online'
    ? 'neo-status-api-online'
    : apiStatus === 'degraded'
      ? 'neo-status-api-degraded'
      : apiStatus === 'offline'
        ? 'neo-status-api-offline'
        : 'neo-status-api-checking';
  const queueStatusClass = queueStatus === 'idle'
    ? 'neo-status-queue-idle'
    : queueStatus === 'processing'
      ? 'neo-status-queue-processing'
      : queueStatus === 'backlog'
        ? 'neo-status-queue-backlog'
        : 'neo-status-queue-unknown';
  const apiStatusLabel = apiStatus === 'online'
    ? 'API online'
    : apiStatus === 'degraded'
      ? 'API degradada'
      : apiStatus === 'offline'
        ? 'API offline'
        : 'API checando';
  const queueStatusLabel = queueStatus === 'idle'
    ? 'Queue idle'
    : queueStatus === 'processing'
      ? 'Queue processando'
      : queueStatus === 'backlog'
        ? 'Queue backlog'
        : 'Queue sem dados';
  const searchActive = state.searchProgress
    ? !['completed', 'failed'].includes(state.searchProgress.stage)
    : false;
  const downloadActive = state.downloadProgress
    ? !['completed', 'failed'].includes(state.downloadProgress.stage)
    : false;
  const oneClickActive = ['searching', 'downloading'].includes(state.oneClickProgress.stage);
  const operationActive = state.loading || searchActive || downloadActive || oneClickActive;
  const missionProgress = Math.max(searchPercent, downloadPercent, oneClickPercent);
  const missionLabel = oneClickActive
    ? `One-Click ${state.oneClickProgress.stage}`
    : downloadActive
      ? `Download ${state.downloadProgress?.stage ?? 'running'}`
      : searchActive
        ? `Busca ${state.searchProgress?.stage ?? 'running'}`
        : 'Aguardando comando';

  let workspaceContent: React.JSX.Element;
  if (route === 'overview') {
    workspaceContent = (
      <>
        {progressDeck}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {liveStats.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} />
          ))}
        </section>
        <section className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
          <SurfaceCard title="Mission Actions" subtitle="Operacao principal">
            <div className="mb-3 flex flex-wrap gap-2">
              <PresetChip id="safe" selected={selectedPreset} onSelect={applyPreset} />
              <PresetChip id="balanced" selected={selectedPreset} onSelect={applyPreset} />
              <PresetChip id="turbo" selected={selectedPreset} onSelect={applyPreset} />
            </div>
            {quickActions}
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <vue-scrape-stats valid={validCount} discarded={state.discardedImages} />
            </div>
          </SurfaceCard>
          <SurfaceCard title="Live Stream" subtitle={`${liveEvents.length} eventos`}>
            <LiveEventFeed events={liveEvents} />
          </SurfaceCard>
        </section>
      </>
    );
  } else if (route === 'search_studio') {
    workspaceContent = (
      <>
        {progressDeck}
        <section className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <SurfaceCard title="Parametros de Busca" subtitle="Controle de scraping e validacao">
            <label className="text-sm font-medium text-slate-700">
              URLs (alias com Quick URL Input do topo)
              <textarea
                className="neo-input mt-1 h-36 w-full rounded-lg p-2 text-sm"
                value={state.urlsInput}
                onChange={(event) => state.setField('urlsInput', event.target.value)}
              />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-slate-700">
                Min KB
                <input
                  type="number"
                  className="neo-input mt-1 w-full rounded-lg p-2"
                  value={state.minSizeKb}
                  onChange={(event) => state.setField('minSizeKb', Number(event.target.value))}
                />
              </label>
              <label className="text-sm text-slate-700">
                Scrape Threads
                <input
                  type="number"
                  className="neo-input mt-1 w-full rounded-lg p-2"
                  value={state.scrapeThreads}
                  onChange={(event) => state.setField('scrapeThreads', Number(event.target.value))}
                />
              </label>
              <label className="text-sm text-slate-700">
                URL Workers
                <input
                  type="number"
                  className="neo-input mt-1 w-full rounded-lg p-2"
                  value={state.urlWorkers}
                  onChange={(event) => state.setField('urlWorkers', Number(event.target.value))}
                />
              </label>
            </div>
            <div className="mt-4">{quickActions}</div>
          </SurfaceCard>
          <SurfaceCard title="Resultado da Coleta" subtitle="Preview imediato para auditoria">
            {state.warnings.length ? (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                {state.warnings.slice(0, 5).join(' | ')}
              </div>
            ) : null}
            {state.loading && rows.length === 0 ? (
              <section className="neo-surface rounded-2xl border border-slate-200/60 p-3">
                <div className="space-y-2">
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow compact />
                </div>
              </section>
            ) : (
              <ResultsTable rows={rows.slice(0, 12)} />
            )}
          </SurfaceCard>
        </section>
      </>
    );
  } else if (route === 'download_control') {
    workspaceContent = (
      <>
        {progressDeck}
        <section className="grid gap-4 xl:grid-cols-[1fr,1fr]">
          <SurfaceCard title="Parametros de Download" subtitle="Destino e estrategia de escrita">
            <div className="grid gap-3">
              <label className="text-sm text-slate-700">
                Pasta de destino
                <input
                  className="neo-input mt-1 w-full rounded-lg p-2"
                  value={state.destFolder}
                  onChange={(event) => state.setField('destFolder', event.target.value)}
                />
              </label>
              <label className="text-sm text-slate-700">
                Downloads Paralelos
                <input
                  type="number"
                  className="neo-input mt-1 w-full rounded-lg p-2"
                  value={state.downloadsParallel}
                  onChange={(event) => state.setField('downloadsParallel', Number(event.target.value))}
                />
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={state.overwrite}
                    onChange={(event) => state.setField('overwrite', event.target.checked)}
                  />
                  Sobrescrever
                </label>
                <label className="text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={state.createUserFolder}
                    onChange={(event) => state.setField('createUserFolder', event.target.checked)}
                  />
                  Pasta usuario
                </label>
                <label className="text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={state.createAlbumFolder}
                    onChange={(event) => state.setField('createAlbumFolder', event.target.checked)}
                  />
                  Pasta album
                </label>
              </div>
            </div>
            <div className="mt-4">{quickActions}</div>
          </SurfaceCard>
          <SurfaceCard title="Saude do Download" subtitle="Resumo de execucao em tempo real">
            {state.loading && !state.downloadProgress ? (
              <div className="grid gap-2">
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard label="Processados" value={String(state.downloadProgress?.processed ?? 0)} />
                <MetricCard label="Erros" value={String(state.downloadProgress?.errors ?? 0)} />
                <MetricCard label="Baixados" value={String(state.downloadProgress?.downloaded ?? 0)} />
                <MetricCard label="Pulados" value={String(state.downloadProgress?.skipped ?? 0)} />
              </div>
            )}
            {state.downloadStats ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                Downloads: {state.downloadStats.totalDownloads} | MB: {state.downloadStats.totalMb} | Pulados:{' '}
                {state.downloadStats.skipped} | Erros: {state.downloadStats.errors}
              </div>
            ) : null}
          </SurfaceCard>
        </section>
      </>
    );
  } else if (route === 'one_click_console') {
    workspaceContent = (
      <>
        {progressDeck}
        <section className="grid gap-4 xl:grid-cols-[1fr,1fr]">
          <SurfaceCard title="One-Click Console" subtitle="Pipeline completo em uma acao">
            <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 p-4">
              <p className="text-xs uppercase tracking-wider text-amber-700">Status atual</p>
              <p className="mt-1 text-lg font-semibold text-amber-900">{state.oneClickProgress.stage}</p>
              <p className="mt-1 text-sm text-amber-900">{state.oneClickProgress.message}</p>
              <p className="mt-2 text-xs text-amber-800">Progresso: {state.oneClickProgress.percent}%</p>
            </div>
            <div className="mt-4">{quickActions}</div>
          </SurfaceCard>
          <SurfaceCard title="Timeline On-The-Fly" subtitle="Eventos mais recentes da pipeline">
            <LiveEventFeed
              events={liveEvents.filter((item) => item.channel === 'one-click' || item.channel === 'system')}
            />
          </SurfaceCard>
        </section>
      </>
    );
  } else {
    workspaceContent = (
      <>
        <section className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Historico carregado" value={String(historyItems.length)} />
          <MetricCard label="Cursor proximo" value={historyCursor ? String(historyCursor) : '--'} />
          <MetricCard label="Preset atual" value={selectedPreset} />
        </section>
        <SurfaceCard title="History Virtualized" subtitle="Paginacao real + renderizacao virtual">
          {historyError ? (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {historyError}
            </div>
          ) : null}
          {historyLoading && historyItems.length === 0 ? (
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (
            <HistoryVirtualList
              items={historyItems}
              loading={historyLoading}
              hasMore={historyCursor !== null}
              onLoadMore={() => void loadHistoryPage(false)}
            />
          )}
          <div className="mt-3">
            <button
              className="neo-chip rounded-lg px-3 py-1 text-xs font-semibold"
              onClick={() => void loadHistoryPage(true)}
            >
              Recarregar historico
            </button>
          </div>
        </SurfaceCard>
      </>
    );
  }

  return (
    <main
      className={`neo-app ${density === 'compact' ? 'neo-density-compact' : ''}`}
      data-neo-palette={palette}
    >
      <ToastStack items={toasts} />
      <CommandPalette open={paletteOpen} actions={commandActions} onClose={() => setPaletteOpen(false)} />
      <div className="neo-orb neo-orb-a" />
      <div className="neo-orb neo-orb-b" />
      <div className="relative z-10 mx-auto min-h-screen max-w-7xl px-4 py-6 pb-28 md:px-6 lg:px-8">
        <header className="neo-surface neo-header sticky top-2 z-40 rounded-3xl border border-white/40 p-5 shadow-xl shadow-slate-900/10">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr),auto]">
            <div>
              <p className="neo-title-kicker text-xs uppercase tracking-[0.22em]">Neo Editorial Mission Control</p>
              <h1 className="neo-title neo-title-main mt-1 text-3xl font-semibold md:text-4xl">
                IMGSrc Command Center
              </h1>
              <p className="neo-sub-text mt-2 max-w-2xl text-sm">
                Painel operacional unificado para busca, download, one-click e auditoria de resultados em tempo real.
              </p>
              <label className="mt-4 block">
                <span className="neo-muted-text text-xs font-semibold uppercase tracking-[0.14em]">
                  Quick URL Input (alias do Search)
                </span>
                <textarea
                  className="neo-input mt-1 h-14 w-full max-w-3xl resize-none rounded-xl p-3 text-sm"
                  rows={2}
                  value={state.urlsInput}
                  placeholder="Cole URLs aqui (uma por linha ou por virgula)"
                  onChange={(event) => state.setField('urlsInput', event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-col items-start gap-3 xl:items-end">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className={`neo-status-pill ${apiStatusClass}`}>
                  <span className="neo-status-dot" style={{ background: 'currentColor' }} />
                  {apiStatusLabel}
                </span>
                <span className={`neo-status-pill ${queueStatusClass}`} title={queueSummary}>
                  <span className="neo-status-dot" style={{ background: 'currentColor' }} />
                  {queueStatusLabel} | {queueSummary}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  className="neo-chip neo-toolbar-btn lg:hidden"
                  onClick={() => setSidebarOpen((current) => !current)}
                >
                  {sidebarOpen ? 'Fechar menu' : 'Workspaces'}
                </button>
                <button
                  className="neo-chip neo-toolbar-btn"
                  onClick={() => setDensity((current) => (current === 'compact' ? 'comfortable' : 'compact'))}
                >
                  Density: {density}
                </button>
                <button
                  className="neo-chip neo-chip-active neo-toolbar-btn"
                  onClick={() => setPaletteOpen(true)}
                >
                  Command Palette (Ctrl+K)
                </button>
              </div>
              <div className="neo-theme-switcher">
                <button
                  className={`neo-theme-btn ${palette === 'cobalt' ? 'neo-theme-btn-active' : ''}`}
                  onClick={() => setPalette('cobalt')}
                >
                  Cobalt
                </button>
                <button
                  className={`neo-theme-btn ${palette === 'ember' ? 'neo-theme-btn-active' : ''}`}
                  onClick={() => setPalette('ember')}
                >
                  Ember
                </button>
                <button
                  className={`neo-theme-btn ${palette === 'verdant' ? 'neo-theme-btn-active' : ''}`}
                  onClick={() => setPalette('verdant')}
                >
                  Verdant
                </button>
                <button
                  className={`neo-theme-btn ${palette === 'vscode-dark-default' ? 'neo-theme-btn-active' : ''}`}
                  onClick={() => setPalette('vscode-dark-default')}
                >
                  VSCode Dark
                </button>
                <button
                  className={`neo-theme-btn ${palette === 'vscode-dark-plus' ? 'neo-theme-btn-active' : ''}`}
                  onClick={() => setPalette('vscode-dark-plus')}
                >
                  Dark+
                </button>
                <button
                  className={`neo-theme-btn ${palette === 'kimbie-dark' ? 'neo-theme-btn-active' : ''}`}
                  onClick={() => setPalette('kimbie-dark')}
                >
                  Kimbie
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="mt-5 grid gap-4 lg:grid-cols-[260px,1fr]">
          <div className={`${sidebarOpen ? 'block' : 'hidden'} lg:block`}>
            <WorkspaceSidebar
              items={WORKSPACES}
              selected={route}
              onSelect={(nextRoute) => {
                setRoute(nextRoute);
                setSidebarOpen(false);
              }}
            />
          </div>
          <section key={route} className="neo-stage-enter space-y-4">
            {state.error ? (
              <section className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {state.error}
              </section>
            ) : null}
            {workspaceContent}
          </section>
        </div>
      </div>
      <section className={`neo-live-ribbon ${operationActive ? 'neo-live-ribbon-active' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em]">Live Operation</p>
          <p className="text-xs font-semibold">{missionLabel}</p>
        </div>
        <div className="neo-live-track mt-2">
          <div className="neo-live-bar" style={{ width: `${operationActive ? missionProgress : 0}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <p className="truncate">Busca {searchPercent}%</p>
          <p className="truncate">Download {downloadPercent}%</p>
          <p className="truncate">One-Click {oneClickPercent}%</p>
        </div>
      </section>
    </main>
  );
}
