/**
 * Live creative-fixture evaluation. Runs the 12 fixed fixtures from
 * fixtures.json twice each against the REAL provider through the ordinary
 * naming-service modules (validation → provider → selection), and prints a
 * side-by-side report for repeated-root/template inspection plus token usage
 * for the multilingual headroom check.
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

runLive('creative fixtures (live DeepSeek, twice each)', () => {
  it.each(fixtures)('$id — $label', async (fixture) => {
    const usageEvents: ServiceReport[] = [];
    const rows: { names: string[] | null; error: string | null }[] = [];
    const deps = {
      apiKey: key,
      fetchImpl: fetch,
      log: (report: ServiceReport) => usageEvents.push(report),
    };

    for (let run = 0; run < 2; run++) {
      const result = await runNamingRequest(fixture.request, deps);
      if (result.ok) {
        rows.push({ names: result.names, error: null });
      } else {
        rows.push({ names: null, error: `${result.code}: ${result.message}` });
      }
    }

    const run1 = rows[0];
    const run2 = rows[1];
    const overlap =
      run1.names !== null && run2.names !== null
        ? run1.names.filter((n) => run2.names!.some((m) => nameKey(m) === nameKey(n)))
        : [];

    const maxCompletionTokens = Math.max(
      ...usageEvents.map((e) => e.usage?.completionTokens ?? 0),
    );
    const truncatedCount = usageEvents.filter((e) => e.outcome === 'provider-truncated').length;
    const unusable = rows.filter((r) => r.names === null).length;

    // Print evidence first so a failing run still shows exactly what the
    // provider returned before the assertions below throw.
    const header = `\n[${fixture.id}] ${fixture.label}`;
    const body = [
      `  run 1: ${run1.names === null ? `ERROR ${run1.error}` : run1.names.join(' | ')}`,
      `  run 2: ${run2.names === null ? `ERROR ${run2.error}` : run2.names.join(' | ')}`,
      `  exact duplicates across runs: ${overlap.length} | max completion tokens: ${maxCompletionTokens} | unusable runs: ${unusable}`,
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(header + '\n' + body);

    // Headroom: truncation inside the 800-token ceiling is a red flag.
    expect(truncatedCount, 'truncated response within token ceiling').toBe(0);
    // Both runs must produce usable names for the evaluation to pass; provider
    // outages or validation failures must fail loudly, never report as passed.
    expect(unusable, 'both fixture runs must succeed for a passing evaluation').toBe(0);
    for (const run of rows) {
      expect(run.names === null ? run.error : null, 'fixture run produced no usable names').toBeNull();
    }
  }, 120_000);
});
