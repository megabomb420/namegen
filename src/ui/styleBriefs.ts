/**
 * Style + variant brief composer: the dropdown pair next to the brief field.
 * Choosing a style and a variant (dark / instrumental / atmospheric / none)
 * and pressing "Write brief" fills the active-mode brief like the dice does —
 * deterministically, tuned to the selected combination. Texts avoid the
 * warning-sign vocabulary from [RUNTIME].
 */

export type StyleId = 'hip-hop' | 'wave' | 'uk-garage' | 'future-garage' | 'dnb' | 'electronic';

export interface StyleOption {
  id: StyleId;
  label: string;
  brief: string;
}

export const STYLES: readonly StyleOption[] = [
  {
    id: 'hip-hop',
    label: 'Hip-hop',
    brief:
      'Boom-bap drums over a dusty sample flip, someone rhyming about the corner store, bass that moves air in the room.',
  },
  {
    id: 'wave',
    label: 'Wave',
    brief:
      'Slow, weightless synth chords and sparse 808s in half-time, a voice treated like it is underwater, wide empty space between the notes.',
  },
  {
    id: 'uk-garage',
    label: 'UK garage',
    brief:
      'A 2-step shuffle with swingy off-beat bass and chopped stabs, rooftop-party energy under a light rain.',
  },
  {
    id: 'future-garage',
    label: 'Future garage',
    brief:
      'Half-time garage with widescreen pads, sub-bass throbs and a rinsed vocal chop echoing over the drop.',
  },
  {
    id: 'dnb',
    label: 'Drum & bass',
    brief:
      'A breakbeat chopped into new shapes at 174, rolling bassline and amen variations, rain-slick streets at speed.',
  },
  {
    id: 'electronic',
    label: 'Electronic',
    brief:
      'Modular bleeps over a sturdy kick, west-coast acid lines, an arrangement that keeps breathing and shifting.',
  },
];

export type VariantId = 'none' | 'dark' | 'instrumental' | 'atmospheric';

export interface VariantOption {
  id: VariantId;
  label: string;
  prefix: string;
}

export const VARIANTS: readonly VariantOption[] = [
  { id: 'none', label: '—', prefix: '' },
  { id: 'dark', label: 'Dark', prefix: 'Dark version: low-lit and uneasy, minor-key weight, tension over comfort. ' },
  { id: 'instrumental', label: 'Instrumental', prefix: 'Instrumental only: no vocals; the arrangement and textures do the talking. ' },
  { id: 'atmospheric', label: 'Atmospheric', prefix: 'Atmospheric version: wide spaces, long tails, pads and field textures carry the mood. ' },
];

export function composeBrief(style: StyleId, variant: VariantId): string {
  const styleOption = STYLES.find((s) => s.id === style) ?? STYLES[0];
  const variantOption = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0];
  return `${variantOption.prefix}${styleOption.brief}`;
}
