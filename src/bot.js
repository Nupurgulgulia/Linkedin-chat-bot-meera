import { Bot, InlineKeyboard } from 'grammy';
import { HELP_TEXT, formatNotes, splitMessage } from './messages.js';
import { PRESET_FEEDBACK, TRANSCRIBE_PROMPT } from './prompts.js';

// One conversation per chat, kept in memory. A restart forgets drafts, which is fine
// for a single-user bot: Meera just sends the raw material again.
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { rawInput: null, draft: null, draftMessageIds: [], awaitingFeedback: false, busy: false });
  }
  return sessions.get(chatId);
}

const draftKeyboard = new InlineKeyboard()
  .text('New version', 'act:regen')
  .text('Shorter', 'act:shorter')
  .row()
  .text('Simpler', 'act:simpler')
  .text('More technical', 'act:technical')
  .row()
  .text('Give feedback', 'act:feedback');

export function createBot({ token, allowedUserIds, writer, gemini }) {
  const bot = new Bot(token);

  // Access control: only listed users can use the bot. /start always answers so a new
  // user can find out their ID and ask to be added.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (allowedUserIds.length === 0 || allowedUserIds.includes(userId)) return next();
    if (ctx.message?.text?.startsWith('/start')) {
      await ctx.reply(`This bot is private. Your Telegram user ID is ${userId}. Ask the owner to add it to ALLOWED_TELEGRAM_USER_IDS.`);
    }
  });

  bot.command('start', (ctx) =>
    ctx.reply(`Hi Meera. ${HELP_TEXT}\n\n(Your Telegram user ID is ${ctx.from.id}.)`),
  );
  bot.command('help', (ctx) => ctx.reply(HELP_TEXT));
  bot.command('new', (ctx) => {
    sessions.delete(ctx.chat.id);
    return ctx.reply('Cleared. Send me the raw material for the next post.');
  });

  /** Runs one generation with a typing indicator, one-at-a-time per chat, and sends the result. */
  async function runJob(ctx, session, job, { transcript } = {}) {
    if (session.busy) {
      await ctx.reply("I'm still working on the last one. Give me a moment.");
      return;
    }
    session.busy = true;
    session.awaitingFeedback = false;
    await ctx.replyWithChatAction('typing');
    const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 4500);

    try {
      const result = await job();
      session.draft = result.post;

      // The post goes in its own message(s) so Meera can copy it cleanly.
      const chunks = splitMessage(result.post);
      session.draftMessageIds = [];
      for (const [i, chunk] of chunks.entries()) {
        const isLast = i === chunks.length - 1;
        const sent = await ctx.reply(chunk, isLast ? { reply_markup: draftKeyboard } : {});
        session.draftMessageIds.push(sent.message_id);
      }
      await ctx.reply(formatNotes(result, { transcript }));
    } catch (err) {
      console.error('Generation failed:', err);
      await ctx.reply(`Sorry, something went wrong while writing that (${err.message}). Please try again.`);
    } finally {
      clearInterval(typing);
      session.busy = false;
    }
  }

  function startNewPost(ctx, rawInput, options) {
    const session = getSession(ctx.chat.id);
    session.rawInput = rawInput;
    session.draft = null;
    return runJob(ctx, session, () => writer.draft(rawInput), options);
  }

  function reviseCurrent(ctx, feedback) {
    const session = getSession(ctx.chat.id);
    // Keep the facts she supplies in feedback, so later revisions and new versions can use them.
    session.rawInput = `${session.rawInput}\n\nAdditional notes from Meera:\n${feedback}`;
    const { rawInput, draft } = session;
    return runJob(ctx, session, () => writer.revise(rawInput, draft, feedback));
  }

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return ctx.reply('I don\'t know that command. Send /help to see what I can do.');

    const session = getSession(ctx.chat.id);
    const repliedTo = ctx.message.reply_to_message?.message_id;
    const isReplyToDraft = repliedTo && session.draftMessageIds.includes(repliedTo);

    if (session.draft && (session.awaitingFeedback || isReplyToDraft)) {
      return reviseCurrent(ctx, text);
    }
    return startNewPost(ctx, text);
  });

  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    const media = ctx.message.voice ?? ctx.message.audio;
    if (media.file_size && media.file_size > 20 * 1024 * 1024) {
      return ctx.reply('That recording is too large for Telegram bots (20 MB limit). Could you send a shorter one?');
    }

    await ctx.replyWithChatAction('typing');
    let transcript;
    try {
      const file = await ctx.getFile();
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!res.ok) throw new Error(`download failed with status ${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());
      transcript = await gemini.transcribe(audio, media.mime_type ?? 'audio/ogg', TRANSCRIBE_PROMPT);
    } catch (err) {
      console.error('Voice note failed:', err);
      return ctx.reply(`I couldn't process that voice note (${err.message}). Could you try again or type it out?`);
    }

    const session = getSession(ctx.chat.id);
    const repliedTo = ctx.message.reply_to_message?.message_id;
    if (session.draft && (session.awaitingFeedback || session.draftMessageIds.includes(repliedTo))) {
      return reviseCurrent(ctx, transcript);
    }
    return startNewPost(ctx, transcript, { transcript });
  });

  bot.callbackQuery(/^act:(\w+)$/, async (ctx) => {
    const action = ctx.match[1];
    const session = getSession(ctx.chat.id);

    if (!session.rawInput || !session.draft) {
      await ctx.answerCallbackQuery();
      return ctx.reply('That draft has expired (the bot was restarted). Send me the raw material again.');
    }

    if (action === 'feedback') {
      session.awaitingFeedback = true;
      await ctx.answerCallbackQuery();
      return ctx.reply('What should I change? Type it or send a voice note.');
    }

    await ctx.answerCallbackQuery({ text: 'On it' });
    if (action === 'regen') {
      const { rawInput } = session;
      return runJob(ctx, session, () => writer.draft(rawInput, { variation: true }));
    }
    if (PRESET_FEEDBACK[action]) {
      const { rawInput, draft } = session;
      return runJob(ctx, session, () => writer.revise(rawInput, draft, PRESET_FEEDBACK[action]));
    }
  });

  bot.on('message', (ctx) =>
    ctx.reply('I can work with text messages and voice notes. Send me your raw notes for the post.'),
  );

  bot.catch((err) => console.error('Unhandled bot error:', err.error ?? err));

  return bot;
}
