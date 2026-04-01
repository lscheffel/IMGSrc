import type { WorkspaceItem, WorkspaceRoute } from './types';

type WorkspaceSidebarProps = {
  items: WorkspaceItem[];
  selected: WorkspaceRoute;
  onSelect: (route: WorkspaceRoute) => void;
};

export function WorkspaceSidebar(props: WorkspaceSidebarProps): React.JSX.Element {
  return (
    <aside className="neo-surface rounded-2xl border border-white/30 p-3 shadow-lg shadow-slate-900/5">
      <p className="neo-muted-text px-2 text-[11px] uppercase tracking-[0.15em]">Workspaces</p>
      <nav className="mt-2 space-y-2">
        {props.items.map((workspace) => {
          const selected = props.selected === workspace.id;
          return (
            <button
              key={workspace.id}
              className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                selected
                  ? 'neo-nav-active'
                  : 'neo-nav-item'
              }`}
              onClick={() => props.onSelect(workspace.id)}
            >
              <p className="text-sm font-semibold">{workspace.label}</p>
              <p className="neo-muted-text text-xs">{workspace.description}</p>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
