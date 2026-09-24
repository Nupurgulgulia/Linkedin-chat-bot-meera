// Points the Telegram bot at the Vercel deployment.
// Usage: npm run set-webhook [-- https://your-app.vercel.app]
import { webhookSecret } from '../src/config.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is missing from .env');
  process.exit(1);
}

const base = (process.argv[2] ?? process.env.WEBHOOK_BASE_URL ?? 'https://linkedin-chat-bot-meera.vercel.app').replace(/\/+$/, '');
const url = `${base}/api/webhook`;

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.description}`);
  return json.result;
}

await call('setWebhook', {
  url,
  secret_token: webhookSecret(token),
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
});
await call('setMyCommands', { commands: [{ command: 'help', description: 'How to use this bot' }] });

const info = await call('getWebhookInfo');
console.log(`Webhook set to ${info.url}`);
if (info.last_error_message) console.log(`Last delivery error: ${info.last_error_message}`);
