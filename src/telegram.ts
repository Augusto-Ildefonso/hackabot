export type SendResult =
  | { ok: true }
  | { ok: false; kind: 'blocked' }
  | { ok: false; kind: 'rate_limited'; retryAfter: number }
  | { ok: false; kind: 'error'; status: number };

export async function sendMessage(token: string, chatId: number, text: string): Promise<SendResult> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (res.ok) return { ok: true };
  // 403: user blocked the bot or deleted the chat. 400 "chat not found" is the same in practice.
  if (res.status === 403) return { ok: false, kind: 'blocked' };
  if (res.status === 429) {
    const body: any = await res.json().catch(() => ({}));
    return { ok: false, kind: 'rate_limited', retryAfter: body?.parameters?.retry_after ?? 5 };
  }
  if (res.status === 400) {
    const body: any = await res.json().catch(() => ({}));
    if (String(body?.description).includes('chat not found')) return { ok: false, kind: 'blocked' };
  }
  return { ok: false, kind: 'error', status: res.status };
}
