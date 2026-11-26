import {useCallback, useSyncExternalStore} from 'react';
import {useLocation} from 'react-router';

interface EntryState {
  pane?: 'tree' | 'node' | 'action';
  terminal?: {worker: string; id: number | null; scope: string};
}

const empty: EntryState = {};
const changes = new EventTarget();
function subscribe(notify: () => void) {
  changes.addEventListener('change', notify);
  return () => changes.removeEventListener('change', notify);
}

export function useEntryState() {
  const {key} = useLocation();
  const snapshot = useCallback((): EntryState => {
    const entry = history.state;
    return (entry?.key ?? 'default') === key ? entry?.pappaiView ?? empty : empty;
  }, [key]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const patch = useCallback((fields: Partial<EntryState>) => {
    const entry = history.state;
    if ((entry?.key ?? 'default') !== key) return;
    // Keep the router's entry key, index and user state. A view change is local
    // to this entry and does not start another route navigation.
    history.replaceState({...entry, pappaiView: {...entry?.pappaiView, ...fields}}, '');
    changes.dispatchEvent(new Event('change'));
  }, [key]);
  return [state, patch] as const;
}
