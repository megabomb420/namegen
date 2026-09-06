import type { Mode } from '../../shared/contracts';

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

export function formatSavedDate(savedAt: number): string {
  try {
    return new Date(savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
