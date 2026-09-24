// Vercel serverless entry point. Telegram POSTs each update here.
import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { createApp } from '../src/app.js';
import { webhookSecret } from '../src/config.js';

// Reused across invocations while the function instance stays warm.
let botPromise;
function getBot() {
  botPromise ??= (async () => {
    const { bot } = createApp();
    await bot.init();
    return bot;
  })().catch((err) => {
    botPromise = undefined;
    throw err;
  });
  return botPromise;
}

function isFromTelegram(request, token) {
  const received = Buffer.from(request.headers.get('x-telegram-bot-api-secret-token') ?? '');
  const expected = Buffer.from(webhookSecret(token));
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return new Response('TELEGRAM_BOT_TOKEN is not set', { status: 500 });
  if (!isFromTelegram(request, token)) return new Response('Unauthorized', { status: 401 });

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  // Answer Telegram immediately (writing a post takes ~20s and Telegram would retry a slow
  // response, creating duplicate drafts), then finish the work in the background.
  waitUntil(
    getBot()
      .then((bot) => bot.handleUpdate(update))
      .catch((err) => console.error('Update failed:', err)),
  );
  return new Response('ok');
}

// Health check: open /api/webhook in a browser to see whether the deployment is configured.
export function GET() {
  return Response.json({
    status: 'ok',
    telegramTokenSet: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    geminiKeySet: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash (default)',
    allowListSet: Boolean(process.env.ALLOWED_TELEGRAM_USER_IDS?.trim()),
  });
}
