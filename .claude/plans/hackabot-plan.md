# Hackabot: public Telegram bot for new Devpost hackathons

## Context
Public Telegram bot (anyone can `/start`) that watches Devpost for newly listed hackathons and messages each subscriber whose personal filters match. Filters (organizer, theme, location) are managed via Telegram commands. Target scale: up to a few hundred users, on Cloudflare's free tier. Project dir `/Users/augusto/Documents/Projetos/hackabot` is empty (not a git repo).

## Decisions (from user)
- Host: **Cloudflare Workers (free)**, TypeScript
- **Public, multi-user**, open to anyone via `/start`; up to ~100s of users
- Filters via Telegram commands; **allow + block lists** (OR within a field, AND across fields; no filters = notify everything)

## Data source
`GET https://devpost.com/api/hackathons?order_by=recently-added&status[]=upcoming&status[]=open` (unauthenticated JSON, verified).
Fields used: `id`, `title`, `url`, `organization_name`, `themes[].name`, `displayed_location.location`, `prize_amount` (HTML, strip tags), `submission_period_dates`, `time_left_to_submission`, `invite_only`.
Unofficial endpoint: parse defensively; one shared poll serves all users (never per-user polling). Attribute Devpost and link to the original page in every message.

## Architecture
Why not KV: free tier is 1,000 writes/day. Why a queue: free Workers plan allows ~50 outbound subrequests per invocation, and each Telegram message is one.

- **D1 (SQLite)** tables: `users(chat_id PK, paused, created_at, blocked)`, `filters(chat_id, field, value, mode allow|block)`, `hackathons(id PK, payload JSON, first_seen_at)`
- **Cron Worker (every 15 min):** fetch Devpost, insert unseen hackathons into D1 (first run seeds silently). For each new hackathon, enqueue one message per matching user onto a **Cloudflare Queue**.
- **Queue consumer:** sends Telegram messages in small batches (stay under Telegram's ~30 msg/s), retries on 429 using `retry_after`, marks the user `blocked` on 403 so we stop messaging them.
- **Webhook Worker:** handles Telegram commands for any user; verifies `X-Telegram-Bot-Api-Secret-Token`.

Files:
- `src/index.ts`: `fetch`, `scheduled`, `queue` handlers
- `src/devpost.ts`: fetch + normalize
- `src/filters.ts`: pure `matches(hackathon, filters)`, case-insensitive substring per field
- `src/db.ts`: D1 queries
- `src/telegram.ts`: `sendMessage`, command parser/handlers, HTML message formatting
- `schema.sql`, `wrangler.toml` (cron, D1, Queue bindings; secrets `BOT_TOKEN`, `WEBHOOK_SECRET`)
- `test/`: vitest for filters, parser, normalization (fixture from the real API response)

## Commands
`/start` (register + short help), `/add <organizer|theme|location> <value>`, `/block <field> <value>`, `/remove <field> <value>`, `/list`, `/clear`, `/pause`, `/resume`, `/latest`, `/stop` (delete all my data), `/help`.

## Public-bot safeguards
- Cap filters per user (e.g. 30) and value length; per-user command rate limit
- Escape all user text in HTML replies
- `/stop` deletes the user's rows; short privacy note in `/start` (we store only chat ID and filters)
- Admin-only `/stats` (user count) gated by an `ADMIN_CHAT_ID` secret
- Alert admin after N consecutive Devpost fetch failures
- Prune `hackathons` older than ~90 days

## Steps
1. User prereqs: create bot via @BotFather, Cloudflare account, `wrangler login`
2. Scaffold Worker project (wrangler, TS, vitest); copy this plan to `.claude/plans/hackabot-plan.md` per global CLAUDE.md
3. TDD: filters, normalization (fixture), command parser
4. Implement D1 layer, cron, queue consumer, webhook
5. Create D1 + Queue, `wrangler deploy`, set secrets, `setWebhook` with secret token
6. Keep this plan updated as tasks complete

## Verification
- `vitest` passes
- `wrangler dev --test-scheduled`, trigger cron locally against live Devpost
- Two Telegram accounts with different filters: each receives only matching hackathons, exactly once; a second cron run sends nothing
- Block the bot from one account: the user is marked `blocked` and skipped
- Wrong webhook secret returns 401; `/stop` removes the user's data
- Simulate 200 users matching one hackathon: all messages delivered via queue without hitting the subrequest limit

## Progress (2026-10-24)
- [x] Scaffold (wrangler, TS, vitest), plan copied to repo
- [x] filters, devpost normalization, command parser + tests (14 passing)
- [x] D1 layer, cron, queue consumer, webhook
- [x] Local smoke test: 401 on bad secret, /start + /add stored, cron seeded 27 hackathons silently
- [ ] Create bot with @BotFather; `wrangler login`
- [ ] `wrangler d1 create hackabot` (paste id into wrangler.toml), `wrangler queues create hackabot-messages`
- [ ] `wrangler d1 execute hackabot --remote --file=schema.sql`
- [ ] `wrangler secret put BOT_TOKEN / WEBHOOK_SECRET / ADMIN_CHAT_ID`, `wrangler deploy`
- [ ] Register webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<worker-url>/webhook&secret_token=<WEBHOOK_SECRET>`
- [ ] End-to-end test with two Telegram accounts
