import { useLayoutEffect, useRef } from 'react';
import { subscribePanelEvent } from './api';
import type { EventFilter, PappaiEvent } from './transport';

interface Options {
  disabled?: boolean;
  onSubscribed?: () => void;
  onError?: (error: Error) => void;
}

export function usePappaiEvent(filter: EventFilter, callback: (event: PappaiEvent) => void, options: Options = {}) {
  const { disabled = false, onSubscribed, onError } = options;
  const latest = useRef({ callback, onSubscribed, onError });
  useLayoutEffect(() => {
    latest.current = { callback, onSubscribed, onError };
  });
  const key = JSON.stringify({ node: filter.node, events: filter.events });
  useLayoutEffect(() => {
    if (disabled) return;
    return subscribePanelEvent(
      JSON.parse(key),
      event => latest.current.callback(event),
      () => latest.current.onSubscribed?.(),
      error => latest.current.onError?.(error),
    );
  }, [key, disabled]);
}
