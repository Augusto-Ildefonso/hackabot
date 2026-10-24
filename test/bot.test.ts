import { describe, expect, it } from 'vitest';
import { parseCommand, parseFilterArgs } from '../src/commands';
import { normalize } from '../src/devpost';
import { matches } from '../src/filters';
import { formatHackathon } from '../src/format';
import type { Filter, Hackathon } from '../src/types';

// Shape copied from a real https://devpost.com/api/hackathons response.
const raw = {
  id: 31604,
  title: 'ClaudeTec Hackathon',
  displayed_location: { icon: 'map-marker-alt', location: 'Expedition FEMSA' },
  url: 'https://claudetec-hack26.devpost.com/',
  time_left_to_submission: 'about 9 hours left',
  submission_period_dates: 'Oct 24, 2026',
  themes: [
    { id: 6, name: 'Machine Learning/AI' },
    { id: 13, name: 'Social Good' },
  ],
  prize_amount: 'MEX$<span data-currency-value>17</span>',
  organization_name: 'Tecnologico de Monterrey',
  invite_only: false,
};

const h: Hackathon = normalize(raw)!;
const f = (field: Filter['field'], value: string, mode: Filter['mode'] = 'allow'): Filter => ({ field, value, mode });

describe('normalize', () => {
  it('maps fields and strips HTML from prize', () => {
    expect(h).toMatchObject({
      id: 31604,
      organizer: 'Tecnologico de Monterrey',
      location: 'Expedition FEMSA',
      prize: 'MEX$17',
      themes: ['Machine Learning/AI', 'Social Good'],
    });
  });
  it('rejects entries without id/title/url', () => {
    expect(normalize({ title: 'x' })).toBeNull();
    expect(normalize(null)).toBeNull();
  });
  it('tolerates missing optional fields', () => {
    const n = normalize({ id: 1, title: 't', url: 'u' })!;
    expect(n.themes).toEqual([]);
    expect(n.organizer).toBe('');
  });
});

describe('matches', () => {
  it('matches everything when there are no filters', () => {
    expect(matches(h, [])).toBe(true);
  });
  it('is case-insensitive and partial', () => {
    expect(matches(h, [f('theme', 'machine learning')])).toBe(true);
    expect(matches(h, [f('organizer', 'MONTERREY')])).toBe(true);
  });
  it('ORs values within a field', () => {
    expect(matches(h, [f('theme', 'Health'), f('theme', 'Social')])).toBe(true);
    expect(matches(h, [f('theme', 'Health'), f('theme', 'Fintech')])).toBe(false);
  });
  it('ANDs across fields', () => {
    expect(matches(h, [f('theme', 'Social'), f('organizer', 'Google')])).toBe(false);
    expect(matches(h, [f('theme', 'Social'), f('organizer', 'Monterrey')])).toBe(true);
  });
  it('block wins over allow', () => {
    expect(matches(h, [f('theme', 'Social'), f('organizer', 'Monterrey', 'block')])).toBe(false);
  });
  it('block-only users still get non-blocked items', () => {
    expect(matches(h, [f('organizer', 'Google', 'block')])).toBe(true);
  });
});

describe('parseCommand', () => {
  it('parses commands with args and bot suffix', () => {
    expect(parseCommand('/add@HackaBot theme AI')).toEqual({ cmd: 'add', args: 'theme AI' });
    expect(parseCommand('/LIST')).toEqual({ cmd: 'list', args: '' });
  });
  it('ignores plain text', () => {
    expect(parseCommand('hello')).toBeNull();
  });
});

describe('parseFilterArgs', () => {
  it('accepts aliases and multi-word values', () => {
    expect(parseFilterArgs('Org  Tecnologico   de Monterrey')).toEqual({
      field: 'organizer',
      value: 'Tecnologico de Monterrey',
    });
  });
  it('rejects unknown fields or missing values', () => {
    expect(parseFilterArgs('color red')).toBeNull();
    expect(parseFilterArgs('theme')).toBeNull();
  });
});

describe('formatHackathon', () => {
  it('escapes HTML in user-visible text', () => {
    const out = formatHackathon({ ...h, title: 'A <b>&</b> B' });
    expect(out).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
  });
});
