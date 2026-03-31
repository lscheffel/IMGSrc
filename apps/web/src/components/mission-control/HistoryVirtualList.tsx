import { useMemo, useState } from 'react';

import type { HistoryRecord } from '../../types';

type HistoryVirtualListProps = {
  items: HistoryRecord[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
};

const ROW_HEIGHT = 56;
const VIEWPORT_HEIGHT = 420;
const OVERSCAN = 6;

export function HistoryVirtualList(props: HistoryVirtualListProps): React.JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);

  const { visibleRows, offsetTop, offsetBottom } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(props.items.length, start + visibleCount);
    return {
      visibleRows: props.items.slice(start, end),
      offsetTop: start * ROW_HEIGHT,
      offsetBottom: Math.max(0, (props.items.length - end) * ROW_HEIGHT)
    };
  }, [props.items, scrollTop]);

  return (
    <section className="space-y-3">
      <div
        className="neo-surface overflow-auto rounded-xl border border-slate-200/70"
        style={{ height: `${VIEWPORT_HEIGHT}px` }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: `${offsetTop}px` }} />
        <div className="space-y-0">
          {visibleRows.map((item) => (
            <article key={item.id} className="grid grid-cols-[80px,1fr,1fr,1fr] gap-3 border-b border-slate-200/70 px-3 py-2">
              <p className="neo-muted-text text-xs font-semibold">#{item.id}</p>
              <p className="neo-sub-text truncate text-xs" title={item.filename}>{item.filename}</p>
              <p className="neo-sub-text truncate text-xs" title={item.user}>{item.user}</p>
              <a className="truncate text-xs text-blue-700" href={item.url} target="_blank" rel="noreferrer" title={item.url}>
                abrir
              </a>
            </article>
          ))}
        </div>
        <div style={{ height: `${offsetBottom}px` }} />
      </div>
      <div className="flex items-center justify-between">
        <p className="neo-muted-text text-xs">{props.items.length} registros carregados</p>
        <button
          className="neo-chip rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-50"
          onClick={props.onLoadMore}
          disabled={props.loading || !props.hasMore}
        >
          {props.loading ? 'Carregando...' : props.hasMore ? 'Carregar mais' : 'Fim da lista'}
        </button>
      </div>
    </section>
  );
}
