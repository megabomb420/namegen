import { useEffect, useRef, useState } from 'react';
import type { Mode } from '../../shared/contracts';
import { ChevronRightIcon, CopyIcon, MoreIcon, StarFilledIcon, StarIcon } from './icons';
import { MODE_LABELS } from './labels';

interface NameRowProps {
  name: string;
  mode: Mode;
  saved: boolean;
  onOpen: () => void;
  onToggleSave: () => void;
  onCopy: () => void;
}

/**
 * One result row. The name is a full-height accessible button that opens
 * Explore (a local action, never a request). Save is a separate directly
 * accessible toggle; Copy lives in the overflow menu. Neither Save nor the
 * overflow menu opens Explore.
 */
export function NameRow({ name, mode, saved, onOpen, onToggleSave, onCopy }: NameRowProps) {
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
    <div className="name-row" ref={rowRef}>
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
  );
}
