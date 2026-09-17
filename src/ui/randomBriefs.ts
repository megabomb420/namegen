/**
 * Random brief ideas for the dice button next to the brief field. Every entry
 * is written the way a producer would type a brief: a short list of concrete
 * fragments, a direction and a place, and no joke to land at the end. The pool
 * mixes musical directions with scenes, because a rolled brief has to be usable
 * as it stands.
 */

/** Musical directions: genre, texture and energy, without genre-label prefixes. */
const DIRECTION_BRIEFS: readonly string[] = [
  'late-night UK garage, rain on the windscreen, cold hands, driving home alone',
  'boom-bap with dusty drums and a chopped soul sample, someone telling a story about their street',
  'weightless half-time, wide pads and sparse 808s, a voice sunk under water',
  '2-step shuffle, off-beat bass and chopped vocal stabs, a rooftop after the rain',
  'drum & bass at 174, rolling breaks, wet streets at speed, headlights',
  'future garage, shuffled drums and deep sub-bass, a vocal cut into pieces like a memory',
  'slow techno built from field recordings, a foghorn for a bassline, everything half-speed',
  'dub techno, tape hiss, chords that never quite resolve',
  'lo-fi house, cheap keys, a bassline that waits its turn',
  'acid line over a sturdy kick, hardware only, no hook until the fourth minute',
  'sad cloud-rap, a guitar loop, 808s soft enough to sleep on',
  'broken beat, jazz chords, a bassline arguing with the drums',
  'shoegaze guitars under a garage beat, huge and gentle at once',
  'Afrobeat swing, live percussion, a chorus built for a crowded room',
  'ambient techno for an empty escalator, one chord, a slow filter',
  'boom-bap tempo with hand-played drums, no sample, upright bass',
  'something for the walk home at 3am, warm and a little sad',
  'wide and unhurried, like a place you left a long time ago',
];

/** Places and moments: a scene to write a record about. */
const SCENE_BRIEFS: readonly string[] = [
  'a flooded quarry town, the last shift at the lime works, a radio left on in the changing rooms',
  'the last bus home, cracked phone screen, cold hands, a city gone quiet',
  'a seaside town out of season, closed arcades, a pier at dusk',
  'a night shift at a 24-hour garage, humming fridge, traffic on the bypass',
  'moving out of a flat, empty rooms, keys on the counter',
  'the drive back after a funeral, headlights, one radio station fading out',
  'first snow in a city that panics, quiet streets, wet boots, a kettle',
  'a holiday romance that ended at the airport, fluorescent light, announcements',
  'the swimming pool in winter, empty lanes, chlorine, footsteps echoing',
  'a Sunday market packing up, crates stacked, a van door sliding shut',
  'the laundrette at midnight, one machine still running, a magazine from 2009',
  'a power cut in summer, windows open, a radio playing two streets away',
];

export const RANDOM_BRIEFS: readonly string[] = [...DIRECTION_BRIEFS, ...SCENE_BRIEFS];

/** Picks a random idea, never the same one twice in a row when avoidable. */
export function pickRandomBrief(previous: string | null = null, rand: () => number = Math.random): string {
  const pool = RANDOM_BRIEFS.filter((idea) => idea !== previous);
  const index = Math.floor(rand() * pool.length);
  return pool[Math.min(index, pool.length - 1)] ?? RANDOM_BRIEFS[0];
}
