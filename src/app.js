import { createBot } from './bot.js';
import { loadConfig } from './config.js';
import { createGeminiClient } from './gemini.js';
import { buildSystemInstruction } from './prompts.js';
import { createWriter } from './writer.js';

/** Builds the fully wired bot. Shared by local polling (src/index.js) and the Vercel webhook. */
export function createApp(config = loadConfig()) {
  const gemini = createGeminiClient({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    systemInstruction: buildSystemInstruction(),
  });
  const writer = createWriter(gemini);
  const bot = createBot({ token: config.telegramToken, allowedUserIds: config.allowedUserIds, writer, gemini });
  return { bot, config };
}
