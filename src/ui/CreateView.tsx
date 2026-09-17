import { countCodePoints } from '../../shared/text';
import type { AppStore } from '../state/appStore';
import { activeBrief, findSaved } from '../state/helpers';
import type { AppState, DisplayBatch } from '../state/types';
import { NameRow } from './NameRow';
import { MODE_OPTIONS, LENGTH_OPTIONS, MODE_LABELS } from './labels';
import { pickRandomBrief } from './randomBriefs';
import { ShuffleIcon, ArrowIcon } from './icons';

interface CreateViewProps { state: AppState; store: AppStore }

function Signal({ busy = false }: { busy?: boolean }) {
  return <div className={`signal${busy ? ' signal-busy' : ''}`} aria-hidden="true">
    {Array.from({ length: 35 }, (_, i) => <i key={i} style={{ height: `${10 + Math.sin(i * 1.7) ** 2 * (15 + Math.sin(i / 34 * Math.PI) * 55)}%`, animationDelay: `${i * -0.09}s` }} />)}
  </div>;
}

export function CreateView({ state, store }: CreateViewProps) {
  const brief = activeBrief(state);
  const briefLength = countCodePoints(brief);
  const briefOver = briefLength > 2000;
  const busy = state.requestActive;
  const batch = state.batches[state.viewIndex] ?? null;
  const hasHistory = state.batches.length > 1;
  const canSubmit = !busy && !briefOver;
  const aliasBusy = state.requestActive && state.pending?.kind === 'alias';

  return (
    <section className="view create-view" aria-label="Create names">
      <div className="studio-layout">
        <div className="studio-intro">
          <p className="eyebrow"><span className="small-cross" aria-hidden="true">✳</span> A naming studio for music</p>
          <h1>You make<br /> the sound.<br /><span>Find its name.</span></h1>
          <p className="intro-copy">From the first demo to your next identity.<br /> Find names that feel like your music.</p>
          <div className="intro-bottom"><Signal /><span>Tracks. Releases. Artists.<br /><b>Something worth calling your own.</b></span></div>
        </div>
        <div className="studio-form">
          <div className="panel-heading"><span className="eyebrow">01 / Set the direction</span><span className="panel-label">The starting point</span></div>
          <div className="field">
            <span className="field-label">What are you naming?</span>
            <div className="mode-group naming-modes" role="group" aria-label="What are you naming?">
              {MODE_OPTIONS.map((option, index) => <button key={option.value} type="button"
                className={`segment${state.mode === option.value ? ' segment-on' : ''}`}
                aria-pressed={state.mode === option.value} onClick={() => store.setMode(option.value)}>
                <span className="segment-number" aria-hidden="true">0{index + 1}</span>{option.label}
              </button>)}
            </div>
          </div>
          <div className="field brief-field">
            <div className="field-head"><label htmlFor="brief">Brief</label><span className="optional-label">Your sound, in words. Optional.</span></div>
            <textarea id="brief" rows={4} value={brief} onChange={(event) => store.setBrief(event.target.value)}
              aria-invalid={briefOver} aria-describedby={briefOver ? 'brief-error' : undefined}
              placeholder="A mood, a memory, a genre. A lyric that won’t leave your head…" />
            <div className="brief-bottom">
              <button type="button" className="dice" aria-label="Random idea or genre brief" title="Fill the brief with a random idea or genre brief"
                onClick={() => store.setBrief(pickRandomBrief(brief === '' ? null : brief))}><ShuffleIcon size={16} />Try a random brief</button>
              <span className={`count${briefOver ? ' count-over' : ''}`}>{briefLength} / 2000</span>
            </div>
            {briefOver && <p id="brief-error" className="field-error" role="alert">The brief is over the 2,000-character limit. Trim it before generating.</p>}
          </div>
          <div className="options">
            <button type="button" className="options-toggle" aria-expanded={state.optionsOpen} aria-controls="naming-options" onClick={() => store.toggleOptions()}>
              <span>Options <span className="options-summary">{state.language || 'English'} · {state.length === 'short' ? 'Short' : 'Auto'} length</span></span><span aria-hidden="true">{state.optionsOpen ? '−' : '+'}</span>
            </button>
            {state.optionsOpen && <div id="naming-options" className="options-panel">
              <div className="option-fields">
                <div className="field"><label htmlFor="language">Language</label><input id="language" type="text" inputMode="text" value={state.language} onChange={(event) => store.setLanguage(event.target.value)} placeholder="English" autoComplete="off" /></div>
                <div className="field"><span className="field-label">Length</span><div className="mode-group" role="group" aria-label="Name length">
                  {LENGTH_OPTIONS.map((option) => <button key={option.value} type="button" className={`segment${state.length === option.value ? ' segment-on' : ''}`} aria-pressed={state.length === option.value} onClick={() => store.setLength(option.value)}>{option.label}</button>)}
                </div></div>
              </div>
              <button type="button" className="quiet-danger" onClick={() => store.clearWorkingSession()}>Clear working session</button>
              <p className="micro-note">Removes this session&apos;s results and drafts. Your shortlist is kept.</p>
            </div>}
          </div>
          <button type="button" className={`primary generate-button${busy ? ' is-busy' : ''}`} disabled={!canSubmit} onClick={() => store.generate()}>
            <span>{busy ? (aliasBusy ? 'Thinking…' : 'Naming…') : brief.trim() === '' ? 'Surprise me' : 'Generate'}</span><ArrowIcon size={23} />
          </button>
          <p className="form-note">{brief.trim() === '' ? 'Leave the brief open. See where it takes you.' : 'Follow the feeling. You can refine the names next.'}</p>
        </div>
      </div>
      {state.mode === 'artist' && <section className="alias-tools" aria-labelledby="alias-heading">
        <div className="alias-section-head"><p className="eyebrow">Another way in</p><h2 id="alias-heading">Find your alter ego.</h2><p>Roll an original artist alias in a signature style.</p></div>
        <div className="alias-grid">
          <div className="alias-card"><span className="alias-title">Keeper of the Iron Tongue</span><p className="micro-note">Wu-Tang style — gritty, memorable two-word stage names.</p><button type="button" className="alias-roll" disabled={busy} onClick={() => store.generateAlias('wu')}>{aliasBusy ? 'Thinking…' : 'Have the Keeper name you'}<ArrowIcon size={18} /></button></div>
          <div className="alias-card"><span className="alias-title">Nobody&apos;s Darling</span><p className="micro-note">Emo / cloud-rap — soft, melancholic two-word names.</p><button type="button" className="alias-roll" disabled={busy} onClick={() => store.generateAlias('emo')}>{aliasBusy ? 'Thinking…' : 'Summon a sad name'}<ArrowIcon size={18} /></button></div>
        </div>
      </section>}
      <section className="results-section" aria-label="Naming results" aria-busy={busy}>
        <div className="results-section-heading"><span className="eyebrow">02 / Find the one</span><span className="panel-label">{batch ? `${MODE_LABELS[batch.mode]} / ${String(batch.names.length).padStart(2, '0')} ideas` : 'A blank slate. For now.'}</span></div>
        <div className="live-region" aria-live="polite">{busy && <div className="loading-state"><Signal busy /><p>{aliasBusy ? 'Finding your alter ego…' : 'Tuning into your direction…'}</p><span>Good names take a moment.</span></div>}</div>
        {state.error !== null && <div className="error-banner" role="alert"><p>{state.error.message}</p>{state.error.retryable && state.errorSnapshot !== null && !busy && <button type="button" className="banner-action" onClick={() => store.retryFailedRequest()}>Retry</button>}</div>}
        {batch === null && !busy && state.error === null && <div className="empty-hint create-empty"><span className="empty-symbol" aria-hidden="true">↗</span><div><h2>Let&apos;s hear what it could be.</h2><p>Add a brief or hit Surprise me. Your names will appear here.</p></div><span className="empty-index" aria-hidden="true">— / —</span></div>}
        {batch !== null && <div className="results" aria-label={`Results — ${MODE_LABELS[batch.mode]}`}>
          <div className="results-head"><h2>Names with a little possibility.</h2>{hasHistory && <div className="batch-nav"><button type="button" disabled={state.viewIndex === 0} onClick={() => store.setViewIndex(state.viewIndex - 1)}>Older</button><span aria-hidden="true">{state.viewIndex + 1} / {state.batches.length}</span><button type="button" disabled={state.viewIndex === state.batches.length - 1} onClick={() => store.setViewIndex(state.viewIndex + 1)}>Newer</button></div>}</div>
          <p className="hint-line">Select a name to explore. Star the ones that stay with you.</p>
          {batch.partial && <p className="partial-note">A smaller batch this time.</p>}
          <ResultList batch={batch} state={state} store={store} /><p className="availability-note">Availability not checked.</p>
        </div>}
      </section>
    </section>
  );
}

function ResultList({ batch, state, store }: { batch: DisplayBatch; state: AppState; store: AppStore }) {
  return <ul className="name-list">{batch.names.map((name) => <li key={`${batch.id}-${name}`}><NameRow name={name} mode={batch.mode} saved={findSaved(state.shortlist, name, batch.mode) !== -1} onOpen={() => store.openExplore(name, batch)} onToggleSave={() => store.toggleSave(name, batch.mode)} onCopy={() => void store.copyName(name)} /></li>)}</ul>;
}

