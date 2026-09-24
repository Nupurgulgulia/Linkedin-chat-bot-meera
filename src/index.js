// Local mode: long polling from this computer. Starting this removes the Vercel webhook,
// so run `npm run set-webhook` afterwards to hand the bot back to Vercel.
import { createApp } from './app.js';

let app;
try {
  app = createApp();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { bot, config } = app;

if (config.allowedUserIds.length === 0) {
  console.warn('ALLOWED_TELEGRAM_USER_IDS is empty: anyone who finds the bot can use it (and your Gemini quota).');
}

await bot.api.setMyCommands([
  { command: 'help', description: 'How to use this bot' },
]);

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

console.log(`Bot running locally with model ${config.geminiModel}. Press Ctrl+C to stop.`);
await bot.start({ drop_pending_updates: true });
