/**
 * Random brief ideas for the dice button next to the brief field. The pool
 * mixes concrete sensory prompts with genre-targeted briefs (hip-hop, wave,
 * UK garage, future garage, drum & bass, electronic), some with a dark /
 * atmospheric / instrumental slant — so a single dice roll feels as useful as
 * the old style dropdowns, without any extra UI.
 */

/**
 * Genre-flavoured briefs (formerly the style dropdown options). Every entry
 * ends with a light, unexpected twist so a rolled brief never reads generic.
 */
const GENRE_BRIEFS: readonly string[] = [
  'Hip-hop: boom-bap drums over a dusty sample flip, someone rhyming about the corner store, bass that moves air in the room — and the hook is an old answering-machine message from 1998.',
  'Wave: slow, weightless synth chords and sparse 808s in half-time, a voice treated like it is underwater, wide empty space between the notes — plus one stubborn field recording of someone unlocking a bike.',
  'UK garage: a 2-step shuffle with swingy off-beat bass and chopped stabs, rooftop-party energy under a light rain — the melody is carried by a dripping tap.',
  'Future garage: half-time garage with widescreen pads, sub-bass throbs and a rinsed vocal chop echoing over the drop — the vocal is a grandmother humming through a desk fan.',
  'Drum & bass: a breakbeat chopped into new shapes at 174, rolling bassline and amen variations, rain-slick streets at speed — the break itself comes from a dishwasher cycle.',
  'Electronic: modular bleeps over a sturdy kick, west-coast acid lines, an arrangement that keeps breathing and shifting — until a seagull lands on the mix and stays in tune.',
];

const GENRE_SLANTS: readonly string[] = ['Dark: ', 'Atmospheric: ', 'Instrumental: '];

/** Concrete sensory ideas that work in any genre. */
const CONCRETE_IDEAS: readonly string[] = [
  'Rain on a tin roof at 4am, a Wurlitzer organ through one speaker, faint hiss between verses.',
  'A bicycle wheel clicking against a bent spoke, recorded in a parking garage, slowed to a lurching half-time.',
  'A choir warming up in a school gym, a distant marching-band bass drum, the smell of floor wax.',
  'Frying oil, a late-night diner radio talking over itself, the short-order bell as the only melody.',
  'Wind across an empty stadium, seat numbers rattling, a lone trumpet trying scales in the tunnel.',
  'A sunrise watering ritual: kettle clicks, two cats arguing in another room.',
  'A ferry horn answered by a car alarm on shore; everything played at walking speed.',
  'A dial-up modem handshake stretched into a drone, then a lullaby riding the carrier wave.',
  'Cash register and coin sorter as percussion, a bossa nova played on a toy xylophone.',
  'Fog over a parking lot, footsteps on wet asphalt, the distant hum of a 24-hour laundromat.',
  'Typewriter keys, the page-up lever, a desk fan clicking; arrange like a library after closing.',
  'A broken pinball machine, tilt light stuck on, ball bearings rolling under the cabinet.',
  'The last train on a subway platform: gusts, turnstile clatter, a busker packing up mid-song.',
  'Sprinklers at dusk, a screen door slamming, a neighbor practicing scales on a trombone.',
  'Gravel driveway, an idling delivery van, two dogs barking in agreement, then silence.',
  'A karaoke bar at closing: one person singing alone over the backing track, off-key and sincere.',
  'Rainwater gurgling down a drainpipe into a barrel, a wind chime made of spoons, slow waltz time.',
  'A pottery wheel stopping mid-spin, wet clay slaps, the radio through the studio wall.',
  'Harbor ropes creaking against cleats, gulls negotiating over a dropped sandwich, low tide smell.',
  'A grandfather clock and a digital alarm competing in different rooms; resolve them kindly.',
];

export const RANDOM_BRIEFS: readonly string[] = [
  ...CONCRETE_IDEAS,
  ...GENRE_BRIEFS,
  ...GENRE_BRIEFS.flatMap((genre) => GENRE_SLANTS.map((slant) => `${slant}${genre}`)),
];

/** Picks a random idea, never the same one twice in a row when avoidable. */
export function pickRandomBrief(previous: string | null = null, rand: () => number = Math.random): string {
  const pool = RANDOM_BRIEFS.filter((idea) => idea !== previous);
  const index = Math.floor(rand() * pool.length);
  return pool[Math.min(index, pool.length - 1)] ?? RANDOM_BRIEFS[0];
}
