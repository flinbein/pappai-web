import type { ReactNode } from 'react';

export interface NodeNavigation {
  nodeId: string;
  action: string;
  chooseAction: (path: string) => void;
}

export function NodeActionLink({ nodeId, action, chooseAction, path, id, cliMethod, children }: NodeNavigation & {
  path: string;
  id?: string;
  cliMethod?: string;
  children: ReactNode;
}) {
  return <a id={id} data-cli-method={cliMethod} className="action-link" data-action={path}
    href={'/nodes/' + encodeURIComponent(nodeId) + '/' + path}
    aria-current={action === path ? 'page' : undefined} onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      chooseAction(path);
    }}>{children}</a>;
}
