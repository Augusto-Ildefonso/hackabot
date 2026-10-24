import type { Hackathon } from './types';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatHackathon(h: Hackathon): string {
  const lines = [`🚀 <b><a href="${esc(h.url)}">${esc(h.title)}</a></b>`];
  if (h.organizer) lines.push(`🏢 ${esc(h.organizer)}`);
  if (h.themes.length) lines.push(`🏷 ${h.themes.map(esc).join(', ')}`);
  if (h.location) lines.push(`📍 ${esc(h.location)}`);
  if (h.prize) lines.push(`💰 ${esc(h.prize)}`);
  if (h.dates) lines.push(`📅 ${esc(h.dates)}${h.timeLeft ? ` (${esc(h.timeLeft)})` : ''}`);
  if (h.inviteOnly) lines.push('🔒 Invite only');
  lines.push('<i>via Devpost</i>');
  return lines.join('\n');
}
