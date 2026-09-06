/**
 * Local Wu-Tang-style hip-hop alias generator for Artist mode. Two-column
 * word mashup in the tradition of classic stage-name generators. Runs fully
 * offline (no provider call) and deliberately avoids real Wu-Tang Clan member
 * aliases and their trademarked suffixes.
 */

export const ALIAS_A: readonly string[] = [
  'Ashen', 'Brass', 'Cobalt', 'Rusted', 'Obsidian', 'Marble', 'Sable', 'Copper',
  'Amber', 'Sulphur', 'Cedar', 'Typhoon', 'Mortar', 'Cobra', 'Lantern', 'Pistol',
  'Velvet', 'Hollow', 'Iron', 'Bitter', 'Silver', 'Falcon', 'Onyx', 'Cinder',
];

export const ALIAS_B: readonly string[] = [
  'Raven', 'Mantra', 'Oracle', 'Serpent', 'Blade', 'Compass', 'Monsoon', 'Temple',
  'Horizon', 'Scepter', 'Furnace', 'Engine', 'Lottery', 'Pilgrim', 'Vandal', 'Nomad',
  'Sermon', 'Meridian', 'Chimney', 'Cartographer', 'Blacksmith', 'Warden', 'Alchemist', 'Stargazer',
];

/** Real Wu-Tang Clan aliases we must not reproduce. */
const PROTECTED = new Set(
  [
    'ghostface killah', 'rza', 'gza', 'method man', 'odb', 'ol dirty bastard',
    'raekwon', 'inspectah deck', 'u-god', 'masta killa', 'cappadonna', 'wu tang clan',
  ].map((n) => n.normalize('NFKD').toLowerCase()),
);

export function rollAlias(previous: string | null = null, rand: () => number = Math.random): string {
  const previousKey = previous?.normalize('NFKD').toLowerCase() ?? null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const a = ALIAS_A[Math.floor(rand() * ALIAS_A.length)];
    const b = ALIAS_B[Math.floor(rand() * ALIAS_B.length)];
    const alias = `${a} ${b}`;
    const key = alias.normalize('NFKD').toLowerCase();
    if (key === previousKey) continue;
    if (PROTECTED.has(key)) continue;
    return alias;
  }
  return `${ALIAS_A[0]} ${ALIAS_B[0]}`;
}
