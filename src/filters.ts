import type { Filter, FilterField, Hackathon } from './types';

function valuesFor(h: Hackathon, field: FilterField): string[] {
  switch (field) {
    case 'organizer':
      return [h.organizer];
    case 'theme':
      return h.themes;
    case 'location':
      return [h.location];
  }
}

function hit(h: Hackathon, f: Filter): boolean {
  const needle = f.value.toLowerCase();
  return valuesFor(h, f.field).some((v) => v.toLowerCase().includes(needle));
}

/**
 * Block filters win. Allow filters are OR within a field and AND across
 * fields. A user with no allow filters receives everything not blocked.
 */
export function matches(h: Hackathon, filters: Filter[]): boolean {
  if (filters.some((f) => f.mode === 'block' && hit(h, f))) return false;

  const allowByField = new Map<FilterField, Filter[]>();
  for (const f of filters) {
    if (f.mode !== 'allow') continue;
    const list = allowByField.get(f.field) ?? [];
    list.push(f);
    allowByField.set(f.field, list);
  }
  for (const list of allowByField.values()) {
    if (!list.some((f) => hit(h, f))) return false;
  }
  return true;
}
