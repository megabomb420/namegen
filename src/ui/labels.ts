import type { AliasStyle, Mode } from '../../shared/contracts';

export const MODE_LABELS: Record<Mode, string> = {
  track: 'Track',
  release: 'Release',
  artist: 'Artist',
};

export const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'track', label: 'Track' },
  { value: 'release', label: 'Release' },
  { value: 'artist', label: 'Artist' },
];

export const LENGTH_OPTIONS: { value: 'auto' | 'short'; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'short', label: 'Short' },
];

export interface AliasStyleOption {
  value: AliasStyle;
  label: string;
  blurb: string;
  /** Label of the main generate button while this persona is selected. */
  action: string;
}

export const ALIAS_STYLE_OPTIONS: AliasStyleOption[] = [
  {
    value: 'wu',
    label: 'Keeper of the Iron Tongue',
    blurb: 'Wu-Tang style — gritty, memorable two-word stage names.',
    action: 'Have the Keeper name you',
  },
  {
    value: 'emo',
    label: "Nobody's Darling",
    blurb: 'Emo / cloud-rap — soft, melancholic two-word names.',
    action: 'Summon a sad name',
  },
];

export function aliasActionLabel(style: AliasStyle): string {
  const option = ALIAS_STYLE_OPTIONS.find((candidate) => candidate.value === style);
  return option === undefined ? ALIAS_STYLE_OPTIONS[0].action : option.action;
}

/** Header meta for an album batch; names batches keep the ideas count. */
export function albumMeta(trackCount: number): string {
  return `Release / 01 album · ${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`;
}

export const ALBUM_TITLE_KICKER = 'Album title';

/** Replace action on a track row of an album batch. */
export function replaceTrackLabel(track: string): string {
  return `Replace “${track}” with a new one`;
}

export const REPLACE_TRACK_HINT = 'Ask for a new title for this one slot';

export function formatSavedDate(savedAt: number): string {
  try {
    return new Date(savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
