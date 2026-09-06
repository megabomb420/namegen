// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore, type StoreDeps } from '../state/appStore';
import { App } from './App';
import type { WireOutcome } from '../browser/api';

function success(names: string[], partial = false): WireOutcome {
  return { ok: true, names, partial };
}

function createDeps(submit: unknown, options: { copy?: (t: string) => Promise<boolean> } = {}): StoreDeps {
  let idCounter = 0;
  return {
    submit: submit as StoreDeps['submit'],
    loadShortlist: () => JSON.parse(window.localStorage.getItem('namegen.shortlist.v1') ?? '{"version":1,"items":[]}').items,
    persistShortlist: (items) => {
      window.localStorage.setItem('namegen.shortlist.v1', JSON.stringify({ version: 1, items }));
      return true;
    },
    loadPrefs: () => {
      const raw = window.localStorage.getItem('namegen.prefs.v1');
      return raw === null ? null : JSON.parse(raw);
    },
    persistPrefs: (prefs) => {
      window.localStorage.setItem('namegen.prefs.v1', JSON.stringify(prefs));
      return true;
    },
    loadSession: () => {
      const raw = window.sessionStorage.getItem('namegen.session.v1');
      return raw === null ? null : JSON.parse(raw);
    },
    persistSession: (session) => {
      window.sessionStorage.setItem('namegen.session.v1', JSON.stringify(session));
      return true;
    },
    clearSession: () => {
      window.sessionStorage.removeItem('namegen.session.v1');
      return true;
    },
    now: () => Date.now(),
    randomId: () => `id-${++idCounter}-${Math.random().toString(36).slice(2, 8)}`,
    copy: options.copy ?? (async () => true),
    later: (fn, ms) => setTimeout(fn, ms),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('main journey', () => {
  it('Generate → Explore → Save → Reload → Copy works without extra model requests', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => success(['Broken Glass', 'Slow Tide', 'Solder Smoke']));

    // --- first session ----------------------------------------------------
    const store = new AppStore(createDeps(submit));
    const first = render(<App store={store} />);

    await user.type(screen.getByLabelText('Brief'), 'broken glass kick drum over a slow tide');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    // Generation happens through the API boundary.
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Broken Glass')).toBeInTheDocument();
    expect(screen.getByText('Slow Tide')).toBeInTheDocument();
    // Draft survives submission.
    expect((screen.getByLabelText('Brief') as HTMLTextAreaElement).value).toContain('broken glass');

    // Tapping a name opens Explore with no new request.
    await user.click(screen.getByRole('button', { name: 'Explore “Broken Glass” for more like this' }));
    expect(screen.getByRole('dialog', { name: 'Explore' })).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);

    // Save the explored seed; feedback comes only after the write succeeds.
    const saveChip = screen.getByRole('button', { name: 'Save' });
    await user.click(saveChip);
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument();
    expect(window.localStorage.getItem('namegen.shortlist.v1')).toContain('Broken Glass');

    // Closing the sheet returns to results.
    await user.click(screen.getByRole('button', { name: 'Close explore' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Shortlist tab shows the saved name.
    await user.click(screen.getByRole('button', { name: /Shortlist/ }));
    expect(screen.getByText('Broken Glass')).toBeInTheDocument();

    // Save and overflow actions never open Explore: verify by counting dialogs.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // --- simulated reload: new store over the same persisted storage ------
    first.unmount();
    const reloadedSubmit = vi.fn();
    const reloaded = new AppStore(createDeps(reloadedSubmit));
    render(<App store={reloaded} />);

    // Nothing replays on restore.
    await act(async () => {});
    expect(reloadedSubmit).not.toHaveBeenCalled();

    // Completed batch restored; raw brief field is empty again.
    expect(screen.getByText('Broken Glass')).toBeInTheDocument();
    expect((screen.getByLabelText('Brief') as HTMLTextAreaElement).value).toBe('');

    // Copy the saved shortlist name after reload.
    await user.click(screen.getByRole('button', { name: /Shortlist/ }));
    await user.click(screen.getByRole('button', { name: 'Copy “Broken Glass”' }));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
  });

  it('exploring a restored batch explains the missing brief and copies locally', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => success(['One', 'Two']));
    const store = new AppStore(createDeps(submit));
    render(<App store={store} />);

    // First generate to have a session to restore.
    await user.click(screen.getByRole('button', { name: 'Surprise me' }));
    await screen.findByText('One');
    // Reload semantics: raw brief empty, batch restored from session.
    const fresh = new AppStore(createDeps(submit));
    cleanup();
    render(<App store={fresh} />);
    await screen.findByText('One');

    await user.click(screen.getByRole('button', { name: 'Explore “One” for more like this' }));
    expect(screen.getByRole('dialog', { name: 'Explore' })).toBeInTheDocument();
    expect(screen.getByText(/Original brief isn't available/)).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('network failure shows a retryable error and retry resubmits the snapshot', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const submit = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, code: 'NETWORK', message: "Couldn't reach the naming service. Check your connection, then try again.", retryable: true };
      return success(['Back Online']);
    });
    const store = new AppStore(createDeps(submit));
    render(<App store={store} />);
    await user.type(screen.getByLabelText('Brief'), 'keep this draft');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText(/Couldn't reach the naming service/)).toBeInTheDocument();
    // Draft preserved on failure.
    expect((screen.getByLabelText('Brief') as HTMLTextAreaElement).value).toBe('keep this draft');

    await user.click(within(banner).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Back Online')).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('typing in Explore keeps focus in the textarea instead of stealing it', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => success(['Anchor', 'Buoy']));
    const store = new AppStore(createDeps(submit));
    render(<App store={store} />);
    await user.click(screen.getByRole('button', { name: 'Surprise me' }));
    await screen.findByText('Anchor');

    const opener = screen.getByRole('button', { name: 'Explore “Anchor” for more like this' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Explore' });
    expect(dialog).toBeInTheDocument();
    // Focus starts on the close control.
    expect(screen.getByRole('button', { name: 'Close explore' })).toHaveFocus();

    const instruction = screen.getByLabelText('What should change?');
    await user.click(instruction);
    expect(instruction).toHaveFocus();
    // Each keystroke mutates the sheet state; focus must stay in the textarea.
    await user.keyboard('da');
    expect(screen.getByLabelText('What should change?')).toHaveFocus();
    expect((instruction as HTMLTextAreaElement).value).toBe('da');

    // Closing returns focus to the element that opened the sheet.
    await user.click(screen.getByRole('button', { name: 'Close explore' }));
    expect(screen.getByRole('button', { name: 'Explore “Anchor” for more like this' })).toHaveFocus();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('saved names open Explore locally with their mode and the missing-brief notice', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => success(['Keep This', 'Drop That']));
    const store = new AppStore(createDeps(submit));
    render(<App store={store} />);
    await user.click(screen.getByRole('button', { name: 'Surprise me' }));
    await screen.findByText('Keep This');
    await user.click(screen.getByRole('button', { name: 'Save “Keep This” to shortlist' }));

    await user.click(screen.getByRole('button', { name: /Shortlist/ }));
    await user.click(screen.getByRole('button', { name: 'Explore “Keep This” for more like this' }));
    const dialog = screen.getByRole('dialog', { name: 'Explore' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Original brief isn't available/)).toBeInTheDocument();
    // Local action: no model request for opening the sheet.
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
