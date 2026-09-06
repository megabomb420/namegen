import { useSyncExternalStore } from 'react';
import type { AppStore } from '../state/appStore';
import { CreateView } from './CreateView';
import { ExploreSheet } from './ExploreSheet';
import { ShortlistView } from './ShortlistView';

interface AppProps {
  store: AppStore;
}

export function App({ store }: AppProps) {
  const state = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getState(),
  );

  return (
    <div className="app">
      {!state.online && (
        <p className="offline-banner" role="status">
          You&apos;re offline. Saved names and restored results still open; naming needs a
          connection.
        </p>
      )}
      {state.sessionUnavailable && (
        <p className="offline-banner storage-warning" role="status">
          Temporary storage is blocked in this browser, so results may not survive a refresh.
        </p>
      )}

      <main className="content" id="main">
        {state.tab === 'create' ? <CreateView state={state} store={store} /> : <ShortlistView state={state} store={store} />}
      </main>

      <nav className="tabbar" aria-label="Sections">
        <button
          type="button"
          className={state.tab === 'create' ? 'tab tab-on' : 'tab'}
          aria-current={state.tab === 'create' ? 'page' : undefined}
          onClick={() => store.setTab('create')}
        >
          Create
        </button>
        <button
          type="button"
          className={state.tab === 'shortlist' ? 'tab tab-on' : 'tab'}
          aria-current={state.tab === 'shortlist' ? 'page' : undefined}
          onClick={() => store.setTab('shortlist')}
        >
          Shortlist
          {state.shortlist.length > 0 && <span className="badge">{state.shortlist.length}</span>}
        </button>
      </nav>

      <ExploreSheet state={state} store={store} />

      {state.toast !== null && (
        <div className="toast" role="status">
          <span>{state.toast.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => store.dismissToast()}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
