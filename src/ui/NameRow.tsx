import { useEffect, useRef, useState } from 'react';
import type { Mode } from '../../shared/contracts';
import { ChevronRightIcon, CopyIcon, MoreIcon, ShuffleIcon, StarFilledIcon, StarIcon } from './icons';
import { MODE_LABELS, REPLACE_TRACK_HINT, replaceTrackLabel } from './labels';

/** Optional replace action, used by track rows of an album batch. */
export interface NameRowReplace {
  /** True while any request is active; one paid request at a time. */
  disabled: boolean;
  /** True while this row's own replacement is in flight. */
  busy: boolean;
  error: { message: string; retryable: boolean } | null;
  onReplace: () => void;
  onRetry: () => void;
}

interface NameRowProps {
  name: string;
  mode: Mode;
  saved: boolean;
  onOpen: () => void;
  onToggleSave: () => void;
  onCopy: () => void;
  replace?: NameRowReplace;
}

/**
 * One result row. The name is a full-height accessible button that opens
 * Explore (a local action, never a request). Save is a separate directly
 * accessible toggle; Copy lives in the overflow menu. Neither Save nor the
 * overflow menu opens Explore. A failed replacement leaves the displayed name
 * untouched and reports itself on the row that owns it.
 */
export function NameRow({ name, mode, saved, onOpen, onToggleSave, onCopy, replace }: NameRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (menuOpen) {
      copyRef.current?.focus();
      return;
    }
    // Return focus to the overflow trigger when the menu closes via Esc/blur.
    if (document.activeElement === null || !rowRef.current?.contains(document.activeElement)) return;
    if (document.activeElement?.getAttribute('data-row-menu') === 'item') {
      triggerRef.current?.focus();
    }
  }, [menuOpen]);

  return (
    <>
      <div className="name-row" ref={rowRef} onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          event.stopPropagation();
          closeMenu();
          triggerRef.current?.focus();
        }
      }} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}>
        <button
          type="button"
          className="name-open"
          onClick={onOpen}
          aria-label={`Explore “${name}” for more like this`}
        >
          <span className="name-text">{name}</span>
          <ChevronRightIcon size={18} />
        </button>
        <div className="name-row-meta" aria-hidden="true">
          {MODE_LABELS[mode]}
        </div>
        <div className="name-row-actions">
          {menuOpen && <span className="menu-backdrop" onClick={closeMenu} aria-hidden="true" />}
          {replace !== undefined && (
            <button
              type="button"
              className={`icon-button replace-track${replace.busy ? ' is-busy' : ''}`}
              aria-label={replaceTrackLabel(name)}
              aria-busy={replace.busy ? true : undefined}
              title={REPLACE_TRACK_HINT}
              disabled={replace.disabled}
              onClick={() => {
                closeMenu();
                replace.onReplace();
              }}
            >
              <ShuffleIcon size={18} />
            </button>
          )}
          <button
            type="button"
            className="icon-button save-toggle"
            aria-pressed={saved}
            aria-label={saved ? `Remove “${name}” from shortlist` : `Save “${name}” to shortlist`}
            onClick={() => {
              closeMenu();
              onToggleSave();
            }}
          >
            {saved ? <StarFilledIcon size={20} /> : <StarIcon size={20} />}
          </button>
          <div className="overflow-wrap">
            <button
              ref={triggerRef}
              type="button"
              className="icon-button"
              aria-label={`Actions for “${name}”`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreIcon size={20} />
            </button>
            {menuOpen && (
              <div className="row-menu" role="menu" aria-label={`Actions for “${name}”`}>
                <button
                  ref={copyRef}
                  type="button"
                  role="menuitem"
                  data-row-menu="item"
                  onClick={() => {
                    closeMenu();
                    onCopy();
                  }}
                >
                  <CopyIcon size={16} />
                  Copy name
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {replace !== undefined && replace.error !== null && (
        <div className="row-error" role="alert">
          <p>{replace.error.message}</p>
          {replace.error.retryable && (
            <button type="button" className="banner-action" disabled={replace.disabled} onClick={replace.onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
    </>
  );
}
