import { useSyncExternalStore } from 'react';
import type { AppStore } from '../state/appStore';
import { CreateView } from './CreateView';
import { ExploreSheet } from './ExploreSheet';
import { ShortlistView } from './ShortlistView';
import { StarIcon } from './icons';

interface AppProps { store: AppStore }

export function App({ store }: AppProps) {
  const state = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getState(),
  );
  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="site-body" inert={state.explore !== null}>
        <header className="site-header">
          <button className="wordmark" aria-label="NameGen home" onClick={() => store.setTab('create')}>
            <span className="brand-mark" aria-hidden="true">n<span>g</span></span>
            NameGen<span className="brand-period">®</span>
          </button>
          <span className="header-caption">Independent sound. Distinct identity.</span>
          <nav className="site-nav" aria-label="Sections">
            <button type="button" className={state.tab === 'create' ? 'nav-link nav-on' : 'nav-link'}
              aria-current={state.tab === 'create' ? 'page' : undefined} onClick={() => store.setTab('create')}>Create</button>
            <button type="button" className={state.tab === 'shortlist' ? 'nav-link nav-on' : 'nav-link'}
              aria-current={state.tab === 'shortlist' ? 'page' : undefined} onClick={() => store.setTab('shortlist')}>
              <StarIcon size={16} /> Shortlist <span className="badge">{state.shortlist.length}</span>
            </button>
          </nav>
        </header>
        {!state.online && <p className="offline-banner" role="status">You&apos;re offline. Saved names and restored results are available; generating needs an internet connection.</p>}
        {state.sessionUnavailable && <p className="offline-banner storage-warning" role="status">Temporary storage is blocked in this browser, so results may not survive a refresh.</p>}
        <main className="content" id="main" tabIndex={-1}>
          {state.tab === 'create' ? <CreateView state={state} store={store} /> : <ShortlistView state={state} store={store} />}
        </main>
        <footer className="site-footer">
          <span className="footer-brand">NameGen<span> / </span>Made for the music.</span>
          <details className="privacy-details">
            <summary>Privacy & storage</summary>
            <div>
              <p>Context you add and names you saw recently are sent to DeepSeek for naming. NameGen keeps no server copy. DeepSeek&apos;s own retention is outside our control.</p>
              <p>Results stay in this browser session until cleared. They can reflect your brief and are not securely erased when the tab closes. Your shortlist stays in this browser until its data is cleared; it does not sync between devices.</p>
            </div>
          </details>
          <span className="footer-note">A little less unnamed.</span>
        </footer>
      </div>
      <ExploreSheet state={state} store={store} />
      {state.toast !== null && <div className="toast" role="status"><span>{state.toast.message}</span><button type="button" aria-label="Dismiss" onClick={() => store.dismissToast()}>Dismiss</button></div>}
    </div>
  );
}

