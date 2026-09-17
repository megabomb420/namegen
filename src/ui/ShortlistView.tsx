import { useState } from 'react';
import type { AppStore } from '../state/appStore';
import { entryTitle, formatEntry } from '../state/helpers';
import type { AppState, SavedEntry } from '../state/types';
import { ChevronRightIcon, CopyIcon, RemoveIcon, StarIcon } from './icons';
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
      <p className="eyebrow shortlist-kicker">The ones worth keeping</p>
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
        <div className="empty-hint shortlist-empty">
          <span className="empty-symbol" aria-hidden="true"><StarIcon size={26} /></span>
          <h2>Nothing saved yet.</h2>
          <p>Star the names that feel right. Keep them here while you decide.</p>
          <button className="quiet" onClick={() => store.setTab('create')}>Find a name <ChevronRightIcon size={16} /></button>
        </div>
      ) : (
        <ul className="saved-list">
          {items.map((item) => <SavedRow key={item.id} item={item} store={store} />)}
        </ul>
      )}

      <p className="session-note">
        Saved names live in this browser and can be lost when its data is cleared.
        Copy your shortlist to keep it elsewhere.
      </p>
    </section>
  );
}

/** One entry: a name, or a whole release with its tracks in a compact list. */
function SavedRow({ item, store }: { item: SavedEntry; store: AppStore }) {
  const title = entryTitle(item);
  return (
    <li className="saved-row">
      <div className="saved-main">
        <button
          type="button"
          className="saved-name-open"
          aria-label={`Explore “${title}” for more like this`}
          onClick={() => store.openSavedExplore(item)}
        >
          <span className="saved-name">{title}</span>
          <ChevronRightIcon size={18} />
        </button>
        <span className="saved-meta">
          {MODE_LABELS[item.mode]} · saved {formatSavedDate(item.savedAt)}
        </span>
        {item.kind === 'album' && (
          <ol className="saved-tracks">
            {item.tracks.map((track, index) => <li key={`${item.id}-${index}`}>{track}</li>)}
          </ol>
        )}
      </div>
      <div className="saved-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Copy “${title}”`}
          onClick={() => void store.copyName(formatEntry(item))}
        >
          <CopyIcon size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove “${title}” from shortlist`}
          onClick={() => store.removeSaved(item.id)}
        >
          <RemoveIcon size={20} />
        </button>
      </div>
    </li>
  );
}
