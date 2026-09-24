import { describe, expect, it } from 'vitest';
import { applyQualityGate, assessTitle } from './title-quality';

const brief = (text: string) => ({ brief: text });

describe('assessTitle', () => {
  it('drops a bare mood noun and keeps a concrete name', () => {
    expect(assessTitle('Midnight', brief(''))).toBe('generic-word');
    expect(assessTitle('Echoes', brief(''))).toBe('generic-word');
    expect(assessTitle('Afterglow', brief(''))).toBe('generic-word');
    expect(assessTitle('Quarry Ledger', brief(''))).toBeNull();
    expect(assessTitle('Pump House', brief(''))).toBeNull();
    expect(assessTitle('Last Bus Home', brief(''))).toBeNull();
  });

  it('drops an atmospheric adjective welded to a mood noun', () => {
    expect(assessTitle('Neon Dreams', brief('a slow record about a flooded town'))).toBe('generic-pair');
    expect(assessTitle('Velvet Shadows', brief(''))).toBe('generic-pair');
    expect(assessTitle('Silent Echoes', brief(''))).toBe('generic-pair');
    expect(assessTitle('Golden Dust', brief(''))).toBe('generic-pair');
    expect(assessTitle('Velvet Cushion', brief(''))).toBeNull();
  });

  it('drops the stock constructions and the stock endings', () => {
    expect(assessTitle('Echoes of the Harbour', brief(''))).toBe('generic-template');
    expect(assessTitle('Whispers of Winter', brief(''))).toBe('generic-template');
    expect(assessTitle('The Art of Letting Go', brief(''))).toBe('generic-template');
    expect(assessTitle('The Weight of Small Rooms', brief(''))).toBeNull();
    expect(assessTitle('Dancing in the Dark', brief(''))).toBe('generic-template');
    expect(assessTitle('Harbor Static', brief(''))).toBe('generic-template');
    expect(assessTitle('Static Kings', brief(''))).toBe('generic-template');
    expect(assessTitle('Neon Highway', brief(''))).toBe('generic-template');
    expect(assessTitle('Tokyo Nights', brief(''))).toBe('generic-template');
    expect(assessTitle('Saturday Night', brief(''))).toBe('generic-template');
    expect(assessTitle('Night Shift Whistle', brief(''))).toBeNull();
  });

  it('drops placeholder track titles on a track list but not as a free-standing name', () => {
    expect(assessTitle('Interlude', { brief: '', albumTrack: true })).toBe('filler-title');
    expect(assessTitle('Track 3', { brief: '', albumTrack: true })).toBe('filler-title');
    expect(assessTitle('Untitled', { brief: '', albumTrack: true })).toBe('filler-title');
    expect(assessTitle('Outro', { brief: '', albumTrack: true })).toBe('filler-title');
    expect(assessTitle('Interlude', brief(''))).toBeNull();
    expect(assessTitle('Prelude to a Flood', { brief: '', albumTrack: true })).toBeNull();
  });

  it('stands down when the brief uses the same words for the same idea', () => {
    expect(assessTitle('Midnight', brief('a tape loop recorded at midnight'))).toBeNull();
    expect(assessTitle('Neon Dreams', brief('neon dreams, literally the feeling'))).toBeNull();
    expect(assessTitle('Static Kings', brief('about radio static and kings'))).toBeNull();
    // Licensing one half of a banned pair does not license the pair.
    expect(assessTitle('Neon Dreams', brief('neon garage, hard drums'))).toBe('generic-pair');
  });

  it('does not flag specific names a real provider run produced', () => {
    // Captured live from the deployed Worker on 2026-09-24 (blank and vague
    // briefs): the gate exists to raise the floor, not to argue with good work.
    const live = [
      'Last Bell at the Lime Works', 'Quarry Water Rising', 'Radio in the Changing Room',
      'Shift Change, Water Line', 'Hollowed Hillside', 'Nine Feet Under the Shovel',
      'Waterline at the Lime Works', 'Waders on the Hook', 'Pay Packet, Soaked',
      'Chalk in the Shower Drain', 'Buzzer at Six', "Somebody's Coat Still Hanging",
      'Drowned Road to the Crusher', 'Lime Dust on the Dial', 'Nobody Called the Station',
      'Paper Cup Overpass', 'Grit in the Ice Machine', 'Lemonade on the Amp',
      'Tuesday in the Breakdown Lane', 'Whistling Past the Dumpster', 'Two Left Boots',
      'The Weight of Small Rooms', 'Woke Up and Nothing Had Changed', 'Salt on the Windowsill',
      'Your Side of the Bed', 'Sunday Without You', 'Held to the Light', 'Paper Airmail',
      'Two Kettles Boiling', 'The Long Way Back to Yes', 'Dial Tone Confession',
      'Borrowed Raincoat Weather',
    ];
    for (const name of live) {
      expect(assessTitle(name, { brief: '', albumTrack: true }), name).toBeNull();
    }
  });

  it('matches accented and mixed-case input through the folded key', () => {
    expect(assessTitle('  MIDNIGHT  ', brief(''))).toBe('generic-word');
    expect(assessTitle('Echoes of the Harbør', brief(''))).toBe('generic-template');
    expect(assessTitle('Słodki Dym', brief(''))).toBeNull();
  });
});

describe('applyQualityGate', () => {
  it('keeps provider order and drops the clichés in place', () => {
    const result = applyQualityGate(
      ['Quarry Ledger', 'Midnight', 'Pump House', 'Neon Dreams', 'Last Bus Home'],
      brief(''),
      3,
    );
    expect(result.kept).toEqual(['Quarry Ledger', 'Pump House', 'Last Bus Home']);
    expect(result.dropped).toBe(2);
    expect(result.reasons).toEqual([null, 'generic-word', null, 'generic-pair', null]);
  });

  it('drops a second candidate that repeats a watched root', () => {
    const result = applyQualityGate(['Concrete Ledger', 'Concrete Tide', 'Brass Rung'], brief(''), 2);
    expect(result.kept).toEqual(['Concrete Ledger', 'Brass Rung']);
    expect(result.reasons[1]).toBe('repeated-root');
  });

  it('never collapses a usable batch: the floor keeps the earliest rejects in place', () => {
    const result = applyQualityGate(['Midnight', 'Echoes', 'Shadows', 'Brass Rung'], brief(''), 3);
    expect(result.kept).toEqual(['Midnight', 'Echoes', 'Brass Rung']);
    expect(result.dropped).toBe(1);
  });

  it('returns a batch smaller than the floor unchanged', () => {
    const result = applyQualityGate(['Midnight', 'Echoes'], brief(''), 3);
    expect(result.kept).toEqual(['Midnight', 'Echoes']);
    expect(result.dropped).toBe(0);
  });

  it('is not order-dependent for the floor top-up', () => {
    const result = applyQualityGate(['Midnight', 'Brass Rung', 'Echoes', 'Shadows'], brief(''), 3);
    expect(result.kept).toEqual(['Midnight', 'Brass Rung', 'Echoes']);
  });
});
