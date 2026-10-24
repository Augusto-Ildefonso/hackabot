# Hackabot

<img src="assets/pfp.png" alt="Hackabot" width="120" align="right">

A Telegram bot that watches [Devpost](https://devpost.com/hackathons) and messages you when a new hackathon is listed. Each user sets their own filters (organizer, theme, location) with chat commands.

Runs entirely on Cloudflare's free tier: a Worker, a D1 database and a Queue.

## Using the bot

Open the bot in Telegram and send `/start`. With no filters you get every new hackathon.

| Command | What it does |
|---|---|
| `/add <organizer\|theme\|location> <value>` | Only send hackathons that match |
| `/block <field> <value>` | Never send hackathons that match |
| `/remove <field> <value>` | Delete one filter |
| `/list` | Show your filters |
| `/clear` | Delete all your filters |
| `/latest` | Show the 5 most recent hackathons seen |
| `/pause` / `/resume` | Stop or restart alerts |
| `/stop` | Delete all your data |
| `/help` | Show help |
| `/stats` | Admin only: user and hackathon counts |

**How filters combine**

- Matching is case-insensitive and partial (`/add theme AI` matches "Machine Learning/AI").
- Several `/add` values for the same field mean *any of them*. Different fields must *all* match.
- `/block` always wins over `/add`.

Example: `/add theme AI`, `/add theme Web`, `/add organizer Google`, `/block location Online` sends hackathons themed AI or Web, organized by Google, and not located online.

## How it works

```
cron (every 15 min) ──► Devpost JSON API ──► new hackathons stored in D1
                                                   │
                         match against each user's filters
                                                   ▼
Telegram ◄── queue consumer (rate-limited sends) ◄── Cloudflare Queue
   │
   └── webhook ──► command handler ──► D1 (users, filters)
```

- **Source:** the unauthenticated JSON endpoint behind devpost.com/hackathons. It is not an official API, so responses are parsed defensively and the admin is alerted after 3 failed polls in a row.
- **First run** stores the current listing silently, so nobody gets a flood of old hackathons.
- **Queue** fan-out keeps each invocation under the free plan's ~50 subrequest limit. Users who block the bot are marked and skipped.
- **Safeguards:** webhook secret check, private chats only, per-user rate limit, filter count and length caps, HTML escaping, and `/stop` deletes all of a user's data.

```
src/
  index.ts      fetch (webhook), scheduled (cron), queue (delivery) handlers
  devpost.ts    fetch and normalize Devpost data
  filters.ts    matching logic
  commands.ts   command parsing and handlers
  db.ts         D1 queries
  telegram.ts   sendMessage with error classification
  format.ts     message formatting
schema.sql      D1 tables
test/           unit tests
```

## Deploy your own

Requires Node 20+, a Cloudflare account and a bot token from [@BotFather](https://t.me/BotFather).

```bash
npm install
npx wrangler login

# Create resources
npx wrangler d1 create hackabot            # put the returned id in wrangler.toml
npx wrangler queues create hackabot-messages
npx wrangler d1 execute hackabot --remote --file=schema.sql

# Secrets (each command prompts for the value)
npx wrangler secret put BOT_TOKEN          # from @BotFather
npx wrangler secret put WEBHOOK_SECRET     # any long random string, e.g. openssl rand -hex 24
npx wrangler secret put ADMIN_CHAT_ID      # optional: your Telegram ID, from @userinfobot

npm run deploy
```

Then register the webhook, using the worker URL printed by the deploy:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>/webhook&secret_token=<WEBHOOK_SECRET>
```

`WEBHOOK_SECRET` must match the secret you set above. The response should be `{"ok":true,...}`. Never share this URL, since it contains your token.

If you have not registered a `workers.dev` subdomain yet, run `npm run deploy` in an interactive terminal and answer the prompt.

## Development

```bash
npm test            # unit tests (vitest)
npm run typecheck   # tsc
npm run dev         # wrangler dev with scheduled-event testing
```

For local runs, put `BOT_TOKEN`, `WEBHOOK_SECRET` and `ADMIN_CHAT_ID` in a `.dev.vars` file (git-ignored), apply the schema with `npx wrangler d1 execute hackabot --local --file=schema.sql`, then trigger the cron with `curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"`.

## Free-tier limits

Cloudflare Queues' free tier allows roughly 10,000 operations a day, about 3,000 messages a day. That is comfortable for a few hundred users. Beyond that, move to the Workers paid plan.

## Credits

Hackathon data comes from [Devpost](https://devpost.com). Every alert links back to the original page. This project is not affiliated with Devpost.
