import { Bot, InlineKeyboard } from 'grammy';
import { HELP_TEXT, formatHookLine, formatNotes, formatRejection, formatScoreLine, splitMessage } from './messages.js';
import { PRESET_FEEDBACK, TRANSCRIBE_PROMPT } from './prompts.js';

// The bot keeps no state between messages, so it can run on serverless functions.
// Everything it needs travels with Telegram's messages:
// - Each draft is sent as a reply to Meera's raw material, so a button press on the
//   draft carries both the draft (the message text) and the raw material (the message
//   it replies to).
// - Feedback is given by replying to a draft, which carries the draft text.

const TRANSCRIPT_PREFIX = 'What I heard:\n\n';

const draftKeyboard = new InlineKeyboard()
  .text('New version', 'act:regen')
  .text('Shorter', 'act:shorter')
  .row()
  .text('Simpler', 'act:simpler')
  .text('More technical', 'act:technical')
  .row()
  .text('Give feedback', 'act:feedback');

// Uses a different prefix from the draft buttons so a rejection is never mistaken for a draft.
const writeAnywayKeyboard = new InlineKeyboard().text('Write it anyway', 'score:force');

/** True if the message is a draft this bot sent (it carries the draft buttons). */
function isDraft(message, botId) {
  return (
    message?.from?.id === botId &&
    Boolean(message.text) &&
    message.reply_markup?.inline_keyboard?.some((row) => row.some((b) => b.callback_data?.startsWith('act:')))
  );
}

/** Recovers Meera's raw material from the message a draft replies to, if available. */
function rawInputOf(draftMessage) {
  const source = draftMessage.reply_to_message;
  if (!source?.text) return null;
  return source.text.startsWith(TRANSCRIPT_PREFIX) ? source.text.slice(TRANSCRIPT_PREFIX.length) : source.text;
}

export function createBot({ token, allowedUserIds, writer, gemini, scorer, hookFinder }) {
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

  /**
   * Runs one generation with a typing indicator and sends the draft as a reply to
   * `replyToId` (Meera's raw material, so later button presses can recover it).
   */
  async function sendDraft(ctx, replyToId, job, { header } = {}) {
    await ctx.replyWithChatAction('typing');
    const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 4500);
    try {
      const result = await job();
      // The post goes in its own message so Meera can copy it cleanly. Posts are kept
      // under LinkedIn's 3,000 character limit, so this is almost always one message.
      const chunks = splitMessage(result.post);
      for (const [i, chunk] of chunks.entries()) {
        const isLast = i === chunks.length - 1;
        await ctx.reply(chunk, {
          reply_parameters: { message_id: replyToId, allow_sending_without_reply: true },
          ...(isLast ? { reply_markup: draftKeyboard } : {}),
        });
      }
      await ctx.reply(formatNotes(result, { header }));
    } catch (err) {
      console.error('Generation failed:', err);
      await ctx.reply(`Sorry, something went wrong while writing that (${err.message}). Please try again.`);
    } finally {
      clearInterval(typing);
    }
  }

  /**
   * Scores new raw material and drafts a post only if it has enough substance. Rejected
   * notes get an explanation and a "Write it anyway" button instead. If scoring itself
   * fails, draft anyway rather than block Meera.
   */
  async function startNewPost(ctx, rawInput, replyToId) {
    let assessment = null;
    if (scorer) {
      await ctx.replyWithChatAction('typing');
      try {
        assessment = await scorer.score(rawInput);
      } catch (err) {
        console.error('Scoring failed, drafting anyway:', err);
      }
    }
    if (assessment?.verdict === 'rejected') {
      return ctx.reply(formatRejection(assessment), {
        reply_parameters: { message_id: replyToId, allow_sending_without_reply: true },
        reply_markup: writeAnywayKeyboard,
      });
    }

    // Look for a recent news article to open the post with. Optional: any failure
    // just means the post is written without one.
    let hookResult = null;
    if (hookFinder && assessment?.core_point) {
      try {
        hookResult = await hookFinder.find(assessment.core_point, assessment.news_queries);
      } catch (err) {
        console.error('News hook search failed, drafting without one:', err);
      }
    }

    const header = [assessment && formatScoreLine(assessment), hookResult && formatHookLine(hookResult)]
      .filter(Boolean)
      .join('\n\n');
    return sendDraft(ctx, replyToId, () => writer.draft(rawInput, { hook: hookResult?.hook ?? null }), {
      header: header || undefined,
    });
  }

  async function handleInput(ctx, text) {
    const repliedTo = ctx.message.reply_to_message;
    if (isDraft(repliedTo, ctx.me.id)) {
      // Feedback on a draft. The raw material isn't available here (Telegram only
      // includes one level of reply), but the draft already contains its facts.
      return sendDraft(ctx, ctx.message.message_id, () =>
        writer.revise(rawInputOf(repliedTo), repliedTo.text, text),
      );
    }
    return startNewPost(ctx, text, ctx.message.message_id);
  }

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return ctx.reply("I don't know that command. Send /help to see what I can do.");
    return handleInput(ctx, text);
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

    const repliedTo = ctx.message.reply_to_message;
    if (isDraft(repliedTo, ctx.me.id)) {
      return sendDraft(ctx, ctx.message.message_id, () =>
        writer.revise(rawInputOf(repliedTo), repliedTo.text, transcript),
      );
    }
    // Show the transcript as its own message and reply to it with the draft, so the
    // transcript is the raw material that later button presses recover.
    const shown = await ctx.reply(`${TRANSCRIPT_PREFIX}${transcript}`.slice(0, 4000), {
      reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
    });
    return startNewPost(ctx, transcript, shown.message_id);
  });

  bot.callbackQuery('score:force', async (ctx) => {
    const message = ctx.callbackQuery.message;
    const rawInput = message && rawInputOf(message);
    if (!rawInput) {
      return ctx.answerCallbackQuery({ text: "I can't find the original notes any more. Send them again." });
    }
    await ctx.answerCallbackQuery({ text: 'On it' });
    return sendDraft(ctx, message.reply_to_message.message_id, () => writer.draft(rawInput), {
      header: 'Written on request, although the note scored low. Check it carefully before posting.',
    });
  });

  bot.callbackQuery(/^act:(\w+)$/, async (ctx) => {
    const action = ctx.match[1];
    const draftMessage = ctx.callbackQuery.message;

    if (action === 'feedback') {
      await ctx.answerCallbackQuery();
      return ctx.reply('Reply to the draft (swipe left on it, or long-press and tap Reply) and tell me what to change. Typing or a voice note both work.');
    }
    if (!draftMessage?.text || !PRESET_FEEDBACK[action]) {
      return ctx.answerCallbackQuery({ text: "I can't read that draft any more. Send the raw material again." });
    }

    await ctx.answerCallbackQuery({ text: 'On it' });
    const rawInput = rawInputOf(draftMessage);
    // Keep replying to the original raw material so the chain stays intact.
    const replyToId = draftMessage.reply_to_message?.message_id ?? draftMessage.message_id;
    return sendDraft(ctx, replyToId, () => writer.revise(rawInput, draftMessage.text, PRESET_FEEDBACK[action]));
  });

  bot.on('message', (ctx) =>
    ctx.reply('I can work with text messages and voice notes. Send me your raw notes for the post.'),
  );

  bot.catch((err) => console.error('Unhandled bot error:', err.error ?? err));

  return bot;
}
