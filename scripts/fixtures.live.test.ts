/**
 * Live creative-fixture evaluation. Runs the fixed fixtures from
 * fixtures.json twice each against the REAL provider through the ordinary
 * naming-service modules (validation → provider → selection), and prints a
 * side-by-side report for repeated-root/template inspection plus token usage
 * for the multilingual headroom check. Release-mode fixtures must come back as
 * one album (a title plus at least one track); every other fixture as a batch
 * of names.
 *
 * This file is excluded from the ordinary `npm test` suite. It runs only when
 * invoked explicitly (npm run fixtures, which uses vitest.fixtures.config.ts)
 * and skips itself unless a DeepSeek key is present (env DEEPSEEK_API_KEY or
 * `.dev.vars`), so a stray invocation never issues paid calls without a key.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fixtures from './fixtures.json';
import { runNamingRequest } from '../server/service';
import type { ServiceReport } from '../server/service';
import { nameKey } from '../shared/text';

function loadKey(): string {
  if (process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== '') {
    return process.env.DEEPSEEK_API_KEY;
  }
  const devVars = new URL('../.dev.vars', import.meta.url);
  if (existsSync(devVars)) {
    const content = readFileSync(devVars, 'utf8');
    const match = content.split('\n').find((line) => line.startsWith('DEEPSEEK_API_KEY='));
    if (match !== undefined) return match.slice('DEEPSEEK_API_KEY='.length).trim();
  }
  return '';
}

const key = loadKey();

const runLive = key === '' ? describe.skip : describe;

type Fixture = (typeof fixtures)[number];

/** One fixture run: the usable output, or the sanitised failure to report. */
type RunRow =
  | { ok: true; kind: 'names'; names: string[] }
  | { ok: true; kind: 'album'; title: string; tracks: string[] }
  | { ok: false; error: string };

/** Release-mode generate names one album; every other fixture names candidates. */
function isAlbumFixture(fixture: Fixture): boolean {
  return fixture.request.operation === 'generate' && fixture.request.mode === 'release';
}

/** Printable form of a run: the batch, or the album title plus its tracks. */
function rowText(row: RunRow): string {
  if (!row.ok) return `ERROR ${row.error}`;
  if (row.kind === 'album') return `${row.title} — [${row.tracks.join(' | ')}]`;
  return row.names.join(' | ');
}

/** Comparison set for the repeated-root inspection across runs. */
function rowKeys(row: RunRow): string[] {
  if (!row.ok) return [];
  return row.kind === 'album' ? [row.title, ...row.tracks] : row.names;
}

/** Whether a run produced usable output in the shape the fixture asks for. */
function rowHasExpectedShape(row: RunRow, albumFixture: boolean): boolean {
  if (!row.ok) return false;
  if (albumFixture) return row.kind === 'album' && row.title.trim() !== '' && row.tracks.length >= 1;
  return row.kind === 'names' && row.names.length >= 1;
}

runLive('creative fixtures (live DeepSeek, twice each)', () => {
  it.each(fixtures)('$id — $label', async (fixture) => {
    const usageEvents: ServiceReport[] = [];
    const rows: RunRow[] = [];
    const albumFixture = isAlbumFixture(fixture);
    const deps = {
      apiKey: key,
      fetchImpl: fetch,
      log: (report: ServiceReport) => usageEvents.push(report),
    };

    for (let run = 0; run < 2; run++) {
      const result = await runNamingRequest(fixture.request, deps);
      if (!result.ok) {
        rows.push({ ok: false, error: `${result.code}: ${result.message}` });
      } else if (result.kind === 'album') {
        rows.push({ ok: true, kind: 'album', title: result.title, tracks: result.tracks });
      } else {
        rows.push({ ok: true, kind: 'names', names: result.names });
      }
    }

    const [run1, run2] = rows;
    const overlap =
      run1.ok && run2.ok
        ? rowKeys(run1).filter((n) => rowKeys(run2).some((m) => nameKey(m) === nameKey(n)))
        : [];

    const maxCompletionTokens = Math.max(
      ...usageEvents.map((e) => e.usage?.completionTokens ?? 0),
    );
    const truncatedCount = usageEvents.filter((e) => e.outcome === 'provider-truncated').length;
    const unusable = rows.filter((r) => !r.ok).length;
    const outcomes = usageEvents.map((e) => e.outcome).join(',');

    // Print evidence first so a failing run still shows exactly what the
    // provider returned before the assertions below throw.
    const header = `\n[${fixture.id}] ${fixture.label}`;
    const body = [
      `  run 1: ${rowText(run1)}`,
      `  run 2: ${rowText(run2)}`,
      `  exact duplicates across runs: ${overlap.length} | max completion tokens: ${maxCompletionTokens} | unusable runs: ${unusable} | outcomes: ${outcomes}`,
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(header + '\n' + body);

    // Headroom: truncation inside the 800-token ceiling is a red flag.
    expect(truncatedCount, 'truncated response within token ceiling').toBe(0);
    // Both runs must produce usable output for the evaluation to pass; provider
    // outages or validation failures must fail loudly, never report as passed.
    expect(unusable, 'both fixture runs must succeed for a passing evaluation').toBe(0);
    for (const [index, row] of rows.entries()) {
      expect(row.ok ? null : row.error, `fixture run ${index + 1} produced no usable output`).toBeNull();
    }
    // A release fixture must come back as one album — a title plus at least one
    // track — and every other fixture as a batch of names.
    for (const [index, row] of rows.entries()) {
      expect(
        rowHasExpectedShape(row, albumFixture),
        `fixture run ${index + 1} must return ${albumFixture ? 'an album with a title and at least one track' : 'a batch of names'}`,
      ).toBe(true);
    }
  }, 120_000);
});
