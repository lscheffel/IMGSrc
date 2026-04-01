import { useEffect, useMemo, useState } from 'react';

import type { CommandAction } from './types';

type CommandPaletteProps = {
  open: boolean;
  actions: CommandAction[];
  onClose: () => void;
};

export function CommandPalette(props: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredActions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return props.actions;
    }
    return props.actions.filter((action) => {
      const haystack = [action.label, action.hint ?? '', ...(action.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [props.actions, query]);

  const groupedActions = useMemo(() => {
    const buckets = new Map<string, CommandAction[]>();
    for (const action of filteredActions) {
      const group = action.group ?? 'General';
      const current = buckets.get(group) ?? [];
      current.push(action);
      buckets.set(group, current);
    }
    return Array.from(buckets.entries());
  }, [filteredActions]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setQuery('');
    setActiveIndex(0);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => Math.min(filteredActions.length - 1, current + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === 'Enter') {
        const current = filteredActions[activeIndex];
        if (current) {
          current.run();
          props.onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeIndex, filteredActions, props]);

  if (!props.open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/45 px-4 py-[8vh] backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        className="neo-surface w-full max-w-2xl rounded-2xl border border-white/60 p-4 shadow-2xl shadow-slate-900/30"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Digite um comando..."
          className="neo-input w-full rounded-xl px-3 py-2 text-sm outline-none"
        />
        <div className="mt-3 max-h-[50vh] space-y-3 overflow-auto">
          {filteredActions.length ? (
            groupedActions.map(([group, actions]) => (
              <section key={group}>
                <p className="neo-muted-text mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider">
                  {group}
                </p>
                <div className="space-y-1">
                  {actions.map((action) => {
                    const index = filteredActions.findIndex((item) => item.id === action.id);
                    return (
                      <button
                        key={action.id}
                        className={`w-full rounded-lg px-3 py-2 text-left transition ${
                          index === activeIndex
                            ? 'neo-command-item-active'
                            : 'neo-command-item'
                        }`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          action.run();
                          props.onClose();
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{action.label}</p>
                          {action.shortcut ? (
                            <span className="neo-command-shortcut rounded px-1.5 py-0.5 text-[10px]">
                              {action.shortcut}
                            </span>
                          ) : null}
                        </div>
                        {action.hint ? <p className="neo-muted-text text-xs">{action.hint}</p> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <p className="neo-input rounded-lg px-3 py-2 text-sm">
              Nenhum comando encontrado.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
