import { useSyncExternalStore } from 'react';

/** A tiny shared state: plain code calls set, React screens call use. */
export function createStore(state) {
  const subs = new Set();
  return {
    get: () => state,
    set(patch) { state = { ...state, ...patch }; for (const fn of subs) fn(); },
    use: () => useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => state),
  };
}
