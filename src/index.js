import { createBot } from './bot.js';
import { loadConfig } from './config.js';
import { createGeminiClient } from './gemini.js';
import { buildSystemInstruction } from './prompts.js';
import { createWriter } from './writer.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (config.allowedUserIds.length === 0) {
  console.warn('ALLOWED_TELEGRAM_USER_IDS is empty: anyone who finds the bot can use it (and your Gemini quota).');
}

const gemini = createGeminiClient({
  apiKey: config.geminiApiKey,
  model: config.geminiModel,
  systemInstruction: buildSystemInstruction(),
});
const writer = createWriter(gemini);
const bot = createBot({ token: config.telegramToken, allowedUserIds: config.allowedUserIds, writer, gemini });

await bot.api.setMyCommands([
  { command: 'new', description: 'Start a fresh post' },
  { command: 'help', description: 'How to use this bot' },
]);

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

console.log(`Bot running with model ${config.geminiModel}. Press Ctrl+C to stop.`);
await bot.start({ drop_pending_updates: true });
