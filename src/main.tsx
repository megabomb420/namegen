import { createRoot } from 'react-dom/client';
import { submitNaming } from './browser/api';
import { copyText } from './browser/clipboard';
import {
  clearSession,
  loadPrefs,
  loadSession,
  loadShortlist,
  persistPrefs,
  persistSession,
  persistShortlist,
} from './browser/storage';
import { AppStore, type StoreDeps } from './state/appStore';
import { App } from './ui/App';
import { usePwaUpdate } from './pwa';
import './styles.css';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a time-based id.
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const deps: StoreDeps = {
  submit: (request) => submitNaming(request),
  loadShortlist,
  persistShortlist,
  loadPrefs,
  persistPrefs,
  loadSession,
  persistSession,
  clearSession,
  now: () => Date.now(),
  randomId,
  copy: (text) => copyText(text),
  later: (fn, ms) => setTimeout(fn, ms),
};

const store = new AppStore(deps);

function onOnlineChange() {
  store.setOnline(navigator.onLine);
}
window.addEventListener('online', onOnlineChange);
window.addEventListener('offline', onOnlineChange);

function UpdateBanner() {
  const pwa = usePwaUpdate();
  if (!pwa.needRefresh && !pwa.offlineReady) return null;
  return (
    <div className="update-banner" role="status">
      {pwa.needRefresh ? (
        <>
          <span>
            A new version is ready. Reloading will discard unsaved brief and refinement text.
          </span>
          <button type="button" className="banner-action" onClick={() => pwa.applyUpdate()}>
            Reload
          </button>
          <button type="button" className="banner-action" onClick={() => pwa.dismissUpdate()}>
            Later
          </button>
        </>
      ) : (
        <>
          <span>Ready to work offline.</span>
          <button type="button" className="banner-action" onClick={() => pwa.dismissUpdate()}>
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <>
      <UpdateBanner />
      <App store={store} />
    </>,
  );
}
