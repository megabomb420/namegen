import { useEffect, useRef } from 'react';
import { BRIEF_MAX, INSTRUCTION_MAX } from '../../shared/limits';
import { countCodePoints } from '../../shared/text';
import type { AppStore } from '../state/appStore';
import { findSaved } from '../state/helpers';
import type { AppState, ExploreState } from '../state/types';
import { CloseIcon, CopyIcon, StarFilledIcon, StarIcon } from './icons';
import { NameRow } from './NameRow';
import { MODE_LABELS } from './labels';

interface ExploreSheetProps {
  state: AppState;
  store: AppStore;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ExploreSheet({ state, store }: ExploreSheetProps) {
  const explore = state.explore;
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (explore === null) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        store.closeExplore();
        return;
      }
      if (event.key !== 'Tab' || sheetRef.current === null) return;
      // Lightweight focus containment inside the sheet.
      const focusables = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || active === null)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [explore, store]);

  if (explore === null) return null;

  const instructionOver = countCodePoints(explore.instruction) > INSTRUCTION_MAX;
  const contextOver = explore.brief === null && countCodePoints(explore.contextDraft) > BRIEF_MAX;
  const busy = state.pending !== null && state.pending.kind === 'refine';
  const submitLabel = explore.instruction.trim() === '' ? 'More like this' : 'Refine';
  const canSubmit = !busy && !instructionOver && !contextOver;

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={() => store.closeExplore()} aria-hidden="true" />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explore-title"
        tabIndex={-1}
      >
        <div className="sheet-head">
          <h2 id="explore-title">Explore</h2>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close explore" onClick={() => store.closeExplore()}>
            <CloseIcon size={20} />
          </button>
        </div>

        <SeedSummary explore={explore} state={state} store={store} />

        {explore.brief === null && (
          <p className="restore-note">Original brief isn&apos;t available; you can add context below.</p>
        )}

        <div className="field">
          <div className="field-head">
            <label htmlFor="explore-context">
              {explore.brief === null ? 'Add context (optional)' : 'Originating brief'}
            </label>
            {explore.brief === null && (
              <span className={`count${contextOver ? ' count-over' : ''}`}>
                {countCodePoints(explore.contextDraft)}/{BRIEF_MAX}
              </span>
            )}
          </div>
          {explore.brief === null ? (
            <textarea
              id="explore-context"
              rows={3}
              value={explore.contextDraft}
              onChange={(event) => store.setExploreContextDraft(event.target.value)}
              placeholder="What should the new names build on?"
            />
          ) : (
            <p className="context-echo">{explore.brief === '' ? 'No originating brief.' : explore.brief}</p>
          )}
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="explore-instruction">What should change?</label>
            <span className={`count${instructionOver ? ' count-over' : ''}`}>
              {countCodePoints(explore.instruction)}/{INSTRUCTION_MAX}
            </span>
          </div>
          <textarea
            id="explore-instruction"
            rows={2}
            value={explore.instruction}
            onChange={(event) => store.setExploreInstruction(event.target.value)}
            placeholder="Shorter, darker, more concrete… Leave empty for more like this."
          />
          {instructionOver && (
            <p className="field-error" role="alert">
              The instruction is over the 160-character limit.
            </p>
          )}
        </div>

        <button type="button" className="primary" disabled={!canSubmit} onClick={() => store.submitRefine()}>
          {busy ? 'Naming…' : submitLabel}
        </button>

        {busy && (
          <p className="status-line" aria-live="polite">
            Naming…
          </p>
        )}

        {explore.error !== null && (
          <div className="error-banner" role="alert">
            <p>{explore.error.message}</p>
            {explore.error.retryable && explore.retrySnapshot !== null && !busy && (
              <button type="button" className="banner-action" onClick={() => store.retryExplore()}>
                Retry
              </button>
            )}
          </div>
        )}

        {explore.alternatives.length > 0 && (
          <div className="results results-in-sheet">
            <h3>Ideas</h3>
            {explore.partial === true && <p className="partial-note">A smaller batch this time.</p>}
            <ul className="name-list">
              {explore.alternatives.map((name) => {
                const saved = findSaved(state.shortlist, name, explore.mode) !== -1;
                return (
                  <li key={`${explore.seed}-${name}`}>
                    <NameRow
                      name={name}
                      mode={explore.mode}
                      saved={saved}
                      onOpen={() => store.exploreAnotherName(name)}
                      onToggleSave={() => store.toggleSave(name, explore.mode)}
                      onCopy={() => void store.copyName(name)}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="availability-note">Availability not checked.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SeedSummary({
  explore,
  state,
  store,
}: {
  explore: ExploreState;
  state: AppState;
  store: AppStore;
}) {
  const saved = findSaved(state.shortlist, explore.seed, explore.mode) !== -1;
  return (
    <div className="seed-summary">
      <p className="seed-meta">
        From the {MODE_LABELS[explore.mode].toLowerCase()} batch · {explore.language} ·{' '}
        {explore.length === 'short' ? 'Short' : 'Auto'} length
      </p>
      <h3 className="seed-name">{explore.seed}</h3>
      <div className="seed-actions">
        <button
          type="button"
          className={`chip${saved ? ' chip-on' : ''}`}
          aria-pressed={saved}
          onClick={() => store.toggleSave(explore.seed, explore.mode)}
        >
          {saved ? <StarFilledIcon size={16} /> : <StarIcon size={16} />}
          {saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" className="chip" onClick={() => void store.copyName(explore.seed)}>
          <CopyIcon size={16} />
          Copy
        </button>
      </div>
    </div>
  );
}
