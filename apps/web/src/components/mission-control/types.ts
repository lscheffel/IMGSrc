export type WorkspaceRoute =
  | 'overview'
  | 'search_studio'
  | 'download_control'
  | 'one_click_console'
  | 'history';

export type WorkspaceItem = {
  id: WorkspaceRoute;
  label: string;
  description: string;
};

export type CommandAction = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
};
