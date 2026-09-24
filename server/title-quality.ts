/**
 * Deterministic quality gate for generated titles.
 *
 * The runtime prompt asks the model not to write generic atmospheric poetry,
 * but a prompt is a request, not a guarantee: this module is the server-side
 * backstop. It is deliberately narrow — it drops titles built from a closed
 * list of clichés, templates and placeholder names, never "titles I find
 * uninteresting" in general — and it is brief-aware: a word the person used
 * themselves, in the brief or in a refinement instruction, licenses that exact
 * idea, which is what the prompt promises.
 *
 * Pure module: no provider types, no HTTP, no I/O, no randomness.
 */
import { caseFold } from '../shared/text';

/** Why a single candidate was dropped. Diagnostic only; never shown to a person. */
export type QualityReason =
  | 'generic-word'
  | 'generic-pair'
  | 'generic-template'
  | 'filler-title'
  | 'repeated-root';

export interface QualityContext {
  /** Brief plus refinement instruction: the licence for a word that is otherwise a cliché. */
  brief: string;
  /** Album track lists also reject placeholder titles (Intro, Untitled, Track 3). */
  albumTrack?: boolean;
}

/**
 * Mood nouns that are generic on their own. A title has to be *earned*: these
 * are the words that read as a name only because nothing else was there.
 */
const GENERIC_WORDS = new Set([
  'midnight', 'echoes', 'echo', 'shadows', 'shadow', 'dreams', 'dream', 'whispers', 'whisper',
  'fragments', 'fragment', 'void', 'ethereal', 'reverie', 'nebula', 'aurora', 'serenity',
  'euphoria', 'silhouette', 'afterglow', 'nocturne', 'mirage', 'zenith', 'aether', 'infinity',
  'solitude', 'labyrinth', 'ascension', 'transcendence', 'reflections', 'illusions', 'luminous',
  'halcyon', 'ephemera', 'wanderlust', 'abyss', 'serendipity',
]);

/** The adjective half of an atmospheric cliché pair. */
const PAIR_MODIFIERS = new Set([
  'neon', 'velvet', 'crimson', 'golden', 'silver', 'silent', 'hollow', 'electric', 'digital',
  'endless', 'fading', 'faded', 'broken', 'sacred', 'secret', 'hidden', 'distant', 'lonely',
  'frozen', 'burning', 'dancing', 'sleeping', 'cosmic', 'celestial', 'ethereal', 'liquid',
  'crystal', 'paper', 'glass', 'pale', 'wild', 'gentle', 'quiet', 'ancient', 'forgotten',
  'wounded', 'weightless', 'boundless', 'misty', 'dusky',
]);

/** The noun half of an atmospheric cliché pair. */
const PAIR_NOUNS = new Set([
  'dreams', 'dream', 'echoes', 'echo', 'shadows', 'shadow', 'whispers', 'whisper', 'nights',
  'night', 'horizon', 'horizons', 'waves', 'tides', 'skies', 'sky', 'ghosts', 'ghost',
  'memories', 'memory', 'hearts', 'heart', 'souls', 'soul', 'stars', 'moon', 'dust', 'ashes',
  'embers', 'rain', 'light', 'lights', 'glow', 'fragments', 'silence',
]);

/** Roots that must not appear twice inside one batch. */
const WATCH_ROOTS = new Set([
  'static', 'neon', 'ghost', 'ghosts', 'signal', 'signals', 'tape', 'tapes', 'veil', 'veils',
  'frequency', 'protocol', 'pulse', 'concrete', 'ember', 'embers', 'glass', 'midnight', 'hollow',
]);

/** Placeholder titles that name a slot rather than a piece of music. */
const FILLER_WORDS = new Set([
  'intro', 'outro', 'interlude', 'skit', 'untitled', 'reprise', 'prelude', 'filler',
]);

const FILLER_PATTERNS: readonly RegExp[] = [
  /^(track|song|untitled|part|piece|idea|take|demo) \d+$/u,
  /^untitled \d*$/u,
];

/** Clichéd constructions, matched on the folded title. */
const TEMPLATE_PATTERNS: readonly RegExp[] = [
  // "Echoes of the Harbour", "Letters of Winter"
  /^(echoes|echo|shadows|shadow|whispers|whisper|fragments|fragment|memories|memory|dreams|dream|visions|vision|ghosts|ghost|songs|song|tales|tale|letters|letter|children|kingdom|cities|city) of (the )?.+$/u,
  // "The Art of Letting Go" — an abstract subject with no image in it. Concrete
  // objects stay allowed: "The Weight of Small Rooms" is a real provider output
  // and a legitimate title.
  /^the (art|science|language|feeling|fine art) of .+$/u,
  // "Lost in the Static", "Dancing in the Dark"
  /^(lost|gone|fading|drifting|falling|dancing|sleeping|static) in .+$/u,
  // "… in the Dark", "… at Midnight"
  /^.+ (in the dark|in the night|at midnight|in the rain)$/u,
  // A cliché adjective welded to anything at all
  /^(neon|midnight|ethereal|celestial|cosmic|static) .+$/u,
  // A cliché noun carrying the title from the end
  /^.+ (static|dreams|dream|echoes|echo|shadows|shadow|whispers|nights|night|horizon|skies|void|reverie|afterglow|memories|fragments)$/u,
];

/** Folded tokens of a name, with punctuation turned into word boundaries. */
function tokensOf(name: string): string[] {
  return caseFold(name)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '');
}

/** The words a person actually wrote: brief and refinement instruction together. */
function licenceTokens(brief: string): Set<string> {
  return new Set(tokensOf(brief));
}

/** True when the person's own words cover every part of the offending construction. */
function licensed(tokens: readonly string[], licence: Set<string>): boolean {
  return tokens.every((token) => licence.has(token));
}

function templateReason(tokens: readonly string[], licence: Set<string>): QualityReason | null {
  if (tokens.length < 2) return null;
  // The pair rule comes first: "Neon Dreams" is a cliché pair, and naming it as
  // one keeps the reason the more specific of the two.
  if (tokens.length === 2) {
    const [first, second] = tokens as [string, string];
    if (PAIR_MODIFIERS.has(first) && PAIR_NOUNS.has(second) && !licensed([first, second], licence)) {
      return 'generic-pair';
    }
  }
  const folded = tokens.join(' ');
  for (const pattern of TEMPLATE_PATTERNS) {
    if (pattern.test(folded) && !licensed(tokens, licence)) return 'generic-template';
  }
  return null;
}

/**
 * Why this title is a cliché, or null when it is allowed through. `albumTrack`
 * adds the placeholder rule; the brief licence applies to every rule.
 */
export function assessTitle(name: string, context: QualityContext): QualityReason | null {
  const tokens = tokensOf(name);
  if (tokens.length === 0) return null;
  const licence = licenceTokens(context.brief);
  const wordCount = tokens.length;

  // A brief that licenses the exact word stands every other rule down too:
  // "a tape loop about neon signs" may legitimately produce Neon titles.
  if (licensed(tokens, licence)) return null;

  if (context.albumTrack === true) {
    if (wordCount <= 2 && FILLER_WORDS.has(tokens[0] as string)) return 'filler-title';
    const folded = tokens.join(' ');
    if (FILLER_PATTERNS.some((pattern) => pattern.test(folded))) return 'filler-title';
  }

  if (wordCount === 1 && GENERIC_WORDS.has(tokens[0] as string)) return 'generic-word';

  return templateReason(tokens, licence);
}

/** Roots of a title that the batch as a whole must not repeat. */
function rootsOf(tokens: readonly string[]): string[] {
  return tokens.filter((token) => WATCH_ROOTS.has(token));
}

export interface GateResult {
  kept: string[];
  /** How many candidates the gate removed; the floor can reduce this below the raw count. */
  dropped: number;
  /** One reason per candidate, in input order, for tests and diagnostics. */
  reasons: (QualityReason | null)[];
}

/**
 * Applies the gate to one batch, in provider order.
 *
 * `floor` is the anti-collapse rule: the gate must never turn a usable batch
 * into a failed request, so when fewer than `floor` candidates survive it keeps
 * the earliest rejected ones — in their original positions — until the floor is
 * met. A request with fewer candidates than the floor is returned unchanged.
 */
export function applyQualityGate(
  candidates: readonly string[],
  context: QualityContext,
  floor: number,
): GateResult {
  const roots = new Set<string>();
  const reasons: (QualityReason | null)[] = candidates.map((candidate) => {
    const tokens = tokensOf(candidate);
    const reason = assessTitle(candidate, context);
    if (reason !== null) return reason;
    const repeated = rootsOf(tokens).find((root) => roots.has(root));
    if (repeated !== undefined) return 'repeated-root';
    for (const root of rootsOf(tokens)) roots.add(root);
    return null;
  });

  const kept: { name: string; index: number }[] = [];
  candidates.forEach((candidate, index) => {
    if (reasons[index] === null) kept.push({ name: candidate, index });
  });

  if (kept.length < floor) {
    // The gate must never turn a usable batch into a failed request: when fewer
    // candidates arrive than the floor asks for, they all stay.
    if (candidates.length < floor) {
      return { kept: [...candidates], dropped: 0, reasons };
    }
    for (let index = 0; index < candidates.length && kept.length < floor; index += 1) {
      if (reasons[index] !== null) kept.push({ name: candidates[index] as string, index });
    }
  }
  kept.sort((a, b) => a.index - b.index);

  return { kept: kept.map((entry) => entry.name), dropped: candidates.length - kept.length, reasons };
}
