import { handleMessage } from './commands';
import * as db from './db';
import { fetchHackathons } from './devpost';
import { matches } from './filters';
import { formatHackathon } from './format';
import { sendMessage } from './telegram';
import type { Env, Hackathon, QueueMessage } from './types';

const MAX_PAGES = 3;
const FAILURE_ALERT_THRESHOLD = 3;

async function pollDevpost(env: Env): Promise<void> {
  const firstRun = (await db.hackathonCount(env.DB)) === 0;
  const fresh: Hackathon[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await fetchHackathons(page);
    if (list.length === 0) break;
    const inserted = await db.insertNew(env.DB, list);
    fresh.push(...inserted);
    // Listing is newest-first: once a page has a known entry, the rest is known too.
    // On the first run we seed several pages so existing hackathons never trigger alerts.
    if (!firstRun && inserted.length < list.length) break;
  }

  if (firstRun || fresh.length === 0) return;

  const users = await db.activeUsers(env.DB);
  const messages: { body: QueueMessage }[] = [];
  for (const h of fresh) {
    const text = formatHackathon(h);
    for (const u of users) {
      if (matches(h, u.filters)) messages.push({ body: { chatId: u.chatId, text } });
    }
  }
  for (let i = 0; i < messages.length; i += 100) {
    await env.MESSAGES.sendBatch(messages.slice(i, i + 100));
  }
}

async function runCron(env: Env): Promise<void> {
  try {
    await pollDevpost(env);
    await db.setMeta(env.DB, 'fetch_failures', '0');
    await db.pruneHackathons(env.DB);
  } catch (err) {
    console.error('poll failed', err);
    const failures = Number((await db.getMeta(env.DB, 'fetch_failures')) ?? '0') + 1;
    await db.setMeta(env.DB, 'fetch_failures', String(failures));
    if (failures === FAILURE_ALERT_THRESHOLD && env.ADMIN_CHAT_ID) {
      await sendMessage(
        env.BOT_TOKEN,
        Number(env.ADMIN_CHAT_ID),
        `⚠️ Devpost polling failed ${failures} times in a row: ${String(err)}`,
      );
    }
  }
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  const update: any = await request.json().catch(() => null);
  const msg = update?.message;
  // Private chats only: keeps filters per person and avoids group spam.
  if (typeof msg?.text === 'string' && msg.chat?.type === 'private') {
    const reply = await handleMessage(env, msg.chat.id, msg.text);
    if (reply) await sendMessage(env.BOT_TOKEN, msg.chat.id, reply);
  }
  return new Response('ok');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/webhook') return handleWebhook(request, env);
    return new Response('hackabot');
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const result = await sendMessage(env.BOT_TOKEN, message.body.chatId, message.body.text);
      if (result.ok) {
        message.ack();
      } else if (result.kind === 'blocked') {
        await db.markBlocked(env.DB, message.body.chatId);
        message.ack();
      } else if (result.kind === 'rate_limited') {
        message.retry({ delaySeconds: result.retryAfter });
      } else {
        message.retry({ delaySeconds: 30 });
      }
      // Stay well under Telegram's ~30 messages/second global limit.
      await new Promise((r) => setTimeout(r, 40));
    }
  },
};
