import { useState } from 'react';
import type { AppStore } from '../state/appStore';
import type { AppState } from '../state/types';
import { ChevronRightIcon, CopyIcon, RemoveIcon } from './icons';
import { formatSavedDate, MODE_LABELS } from './labels';

interface ShortlistViewProps {
  state: AppState;
  store: AppStore;
}

export function ShortlistView({ state, store }: ShortlistViewProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const items = state.shortlist;
  const full = items.length >= 300;

  return (
    <section className="view shortlist-view" aria-label="Shortlist">
      <div className="shortlist-head">
        <h1>
          Shortlist <span className="count-inline">{items.length}/300</span>
        </h1>
        <div className="shortlist-actions">
          <button
            type="button"
            className="quiet"
            disabled={items.length === 0}
            onClick={() => void store.copyShortlist()}
          >
            <CopyIcon size={16} />
            Copy all
          </button>
          {confirmClear ? (
            <span className="confirm-clear">
              Remove all {items.length}?
              <button type="button" className="banner-action danger-text" onClick={() => store.clearShortlist()}>
                Remove all
              </button>
              <button type="button" className="banner-action" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="quiet"
              disabled={items.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {full && (
        <p className="partial-note" role="status">
          Shortlist is full (300 names). Remove entries to save more.
        </p>
      )}

      {items.length === 0 ? (
        <div className="empty-hint">
          <p>Nothing saved yet.</p>
          <p>Save names you like from Create — they stay on this device.</p>
        </div>
      ) : (
        <ul className="saved-list">
          {items.map((item) => (
            <li key={item.id} className="saved-row">
              <div className="saved-main">
                <button
                  type="button"
                  className="saved-name-open"
                  aria-label={`Explore “${item.name}” for more like this`}
                  onClick={() => store.openSavedExplore(item.name, item.mode)}
                >
                  <span className="saved-name">{item.name}</span>
                  <ChevronRightIcon size={18} />
                </button>
                <span className="saved-meta">
                  {MODE_LABELS[item.mode]} · saved {formatSavedDate(item.savedAt)}
                </span>
              </div>
              <div className="saved-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Copy “${item.name}”`}
                  onClick={() => void store.copyName(item.name)}
                >
                  <CopyIcon size={20} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove “${item.name}” from shortlist`}
                  onClick={() => store.removeSaved(item.id)}
                >
                  <RemoveIcon size={20} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="session-note">
        Saved names live in this browser or install only and can be lost when its data is cleared.
        No syncing between browsers or apps.
      </p>
    </section>
  );
}
