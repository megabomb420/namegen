import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Service-worker update handling. An update is never applied silently while
 * the user is working: we surface a reload prompt whose warning tells the user
 * unsaved brief/refinement text would be lost.
 *
 * This module is only imported from `main.tsx` so tests never touch the
 * `virtual:pwa-register` module.
 */

export interface PwaSnapshot {
  needRefresh: boolean;
  offlineReady: boolean;
  applyUpdate: () => void;
  dismissUpdate: () => void;
}

const listeners = new Set<() => void>();
let snapshot: PwaSnapshot = {
  needRefresh: false,
  offlineReady: false,
  applyUpdate: () => undefined,
  dismissUpdate: () => undefined,
};
let started = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: Partial<PwaSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  notify();
}

function start(): void {
  if (started) return;
  started = true;
  try {
    const updateSW = registerSW({
      immediate: true,
      onOfflineReady: () => setSnapshot({ offlineReady: true }),
      onNeedRefresh: () => setSnapshot({ needRefresh: true }),
    });
    snapshot = {
      ...snapshot,
      applyUpdate: () => {
        void updateSW?.(true);
      },
      dismissUpdate: () => setSnapshot({ needRefresh: false, offlineReady: false }),
    };
  } catch {
    // Registration is unavailable (e.g. non-secure context); the app works
    // without it.
    snapshot = { ...snapshot, applyUpdate: () => undefined, dismissUpdate: () => undefined };
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function usePwaUpdate(): PwaSnapshot {
  start();
  return useSyncExternalStore(subscribe, () => snapshot);
}
