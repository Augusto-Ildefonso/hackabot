import * as db from './db';
import { esc, formatHackathon } from './format';
import type { Env, Filter, FilterField, FilterMode } from './types';

export interface ParsedCommand {
  cmd: string;
  args: string;
}

/** "/add@MyBot theme AI" -> { cmd: "add", args: "theme AI" }; null for non-commands. */
export function parseCommand(text: string): ParsedCommand | null {
  const m = text.trim().match(/^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: (m[2] ?? '').trim() };
}

const FIELD_ALIASES: Record<string, FilterField> = {
  organizer: 'organizer',
  organiser: 'organizer',
  org: 'organizer',
  theme: 'theme',
  themes: 'theme',
  topic: 'theme',
  location: 'location',
  loc: 'location',
};

/** "theme AI/ML" -> { field: "theme", value: "AI/ML" }; null if malformed. */
export function parseFilterArgs(args: string): { field: FilterField; value: string } | null {
  const m = args.match(/^(\S+)\s+([\s\S]+)$/);
  if (!m) return null;
  const field = FIELD_ALIASES[m[1].toLowerCase()];
  const value = m[2].trim().replace(/\s+/g, ' ');
  if (!field || !value) return null;
  return { field, value };
}

const HELP = [
  '<b>Hackabot</b> sends you new hackathons from Devpost.',
  '',
  '<b>Filters</b> (case-insensitive, partial match)',
  '/add &lt;organizer|theme|location&gt; &lt;value&gt; — only send matches',
  '/block &lt;field&gt; &lt;value&gt; — never send matches',
  '/remove &lt;field&gt; &lt;value&gt; — delete a filter',
  '/list — show your filters',
  '/clear — delete all filters',
  '',
  'Several /add values for the same field mean <i>any of them</i>; different fields must <i>all</i> match. With no filters you get everything.',
  '',
  '/latest — last 5 hackathons seen',
  '/pause · /resume — stop or restart alerts',
  '/stop — delete all your data',
  '',
  'Example: <code>/add theme Machine Learning</code>',
].join('\n');

const WELCOME = [
  '👋 Welcome! You will now get a message whenever a new hackathon appears on Devpost.',
  'We store only your chat ID and your filters. Use /stop to delete them anytime.',
  '',
  HELP,
].join('\n');

function renderFilters(filters: Filter[]): string {
  if (filters.length === 0) return 'No filters set: you get every new hackathon.';
  const fmt = (mode: Filter['mode'], title: string) => {
    const items = filters.filter((f) => f.mode === mode);
    if (!items.length) return [];
    return [`<b>${title}</b>`, ...items.map((f) => `• ${f.field}: ${esc(f.value)}`)];
  };
  return [...fmt('allow', 'Only send when'), ...fmt('block', 'Never send when')].join('\n');
}

async function addOrBlock(env: Env, chatId: number, args: string, mode: FilterMode): Promise<string> {
  const parsed = parseFilterArgs(args);
  if (!parsed) return `Usage: /${mode === 'allow' ? 'add' : 'block'} &lt;organizer|theme|location&gt; &lt;value&gt;`;
  if (parsed.value.length > db.MAX_VALUE_LENGTH) return `Value too long (max ${db.MAX_VALUE_LENGTH} characters).`;
  const result = await db.addFilter(env.DB, chatId, parsed.field, parsed.value, mode);
  if (result === 'limit') return `You reached the limit of ${db.MAX_FILTERS} filters. Remove some with /remove or /clear.`;
  if (result === 'exists') return 'That filter already exists.';
  return `✅ ${mode === 'allow' ? 'Added' : 'Blocked'} ${parsed.field}: ${esc(parsed.value)}`;
}

/** Returns the reply text (HTML) for a message from `chatId`, or null for no reply. */
export async function handleMessage(env: Env, chatId: number, text: string): Promise<string | null> {
  const parsed = parseCommand(text);
  if (!parsed) return null;
  const { cmd, args } = parsed;

  if (cmd === 'start') {
    await db.upsertUser(env.DB, chatId);
    return WELCOME;
  }
  if (cmd === 'help') return HELP;

  if (!(await db.userExists(env.DB, chatId))) return 'Send /start first to register.';
  if (!(await db.allowCommand(env.DB, chatId))) return 'Slow down a little, too many commands. Try again in a minute.';

  switch (cmd) {
    case 'add':
      return addOrBlock(env, chatId, args, 'allow');
    case 'block':
      return addOrBlock(env, chatId, args, 'block');
    case 'remove': {
      const p = parseFilterArgs(args);
      if (!p) return 'Usage: /remove &lt;organizer|theme|location&gt; &lt;value&gt;';
      return (await db.removeFilter(env.DB, chatId, p.field, p.value))
        ? `🗑 Removed ${p.field}: ${esc(p.value)}`
        : 'No such filter. Check /list.';
    }
    case 'list': {
      const paused = await db.isPaused(env.DB, chatId);
      return `${renderFilters(await db.listFilters(env.DB, chatId))}${paused ? '\n\n⏸ Alerts are paused.' : ''}`;
    }
    case 'clear':
      await db.clearFilters(env.DB, chatId);
      return 'All filters cleared.';
    case 'pause':
      await db.setPaused(env.DB, chatId, true);
      return '⏸ Alerts paused. Use /resume to continue.';
    case 'resume':
      await db.setPaused(env.DB, chatId, false);
      return '▶️ Alerts resumed.';
    case 'latest': {
      const recent = await db.recentHackathons(env.DB, 5);
      return recent.length ? recent.map(formatHackathon).join('\n\n') : 'Nothing seen yet.';
    }
    case 'stop':
      await db.deleteUser(env.DB, chatId);
      return 'Your data was deleted and alerts are off. Send /start to come back.';
    case 'stats': {
      if (String(chatId) !== env.ADMIN_CHAT_ID) return 'Unknown command. Try /help.';
      const c = await db.userCount(env.DB);
      return `Users: ${c.total} (active ${c.active}), hackathons stored: ${await db.hackathonCount(env.DB)}`;
    }
    default:
      return 'Unknown command. Try /help.';
  }
}
