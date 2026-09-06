/**
 * Curated random brief ideas for the dice button next to the brief field.
 * Concrete and sensory on purpose, and deliberately free of the warning-sign
 * vocabulary from [RUNTIME] so random briefs keep generation quality high.
 */

export const RANDOM_BRIEFS: readonly string[] = [
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

/** Picks a random idea, never the same one twice in a row when avoidable. */
export function pickRandomBrief(previous: string | null = null, rand: () => number = Math.random): string {
  const pool = RANDOM_BRIEFS.filter((idea) => idea !== previous);
  const index = Math.floor(rand() * pool.length);
  return pool[Math.min(index, pool.length - 1)] ?? RANDOM_BRIEFS[0];
}
