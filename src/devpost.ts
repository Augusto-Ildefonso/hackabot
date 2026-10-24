import type { Hackathon } from './types';

const API = 'https://devpost.com/api/hackathons';

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Returns null for entries missing the fields we cannot do without. */
export function normalize(raw: any): Hackathon | null {
  if (!raw || typeof raw.id !== 'number' || !str(raw.title) || !str(raw.url)) return null;
  const themes: string[] = Array.isArray(raw.themes)
    ? raw.themes.map((t: any) => str(t?.name)).filter(Boolean)
    : [];
  return {
    id: raw.id,
    title: str(raw.title),
    url: str(raw.url),
    organizer: str(raw.organization_name),
    themes,
    location: str(raw.displayed_location?.location),
    prize: stripHtml(str(raw.prize_amount)),
    dates: str(raw.submission_period_dates),
    timeLeft: str(raw.time_left_to_submission),
    inviteOnly: raw.invite_only === true,
  };
}

export async function fetchHackathons(page = 1): Promise<Hackathon[]> {
  const url = `${API}?order_by=recently-added&status[]=upcoming&status[]=open&page=${page}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Devpost responded ${res.status}`);
  const body: any = await res.json();
  if (!body || !Array.isArray(body.hackathons)) throw new Error('Unexpected Devpost response shape');
  return body.hackathons.map(normalize).filter((h: Hackathon | null): h is Hackathon => h !== null);
}
