import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBot } from '../src/bot.js';

const BOT_ID = 999;
const MEERA = { id: 42, is_bot: false, first_name: 'Meera' };
const chat = { id: 42, type: 'private' };
const draftMarkup = { inline_keyboard: [[{ text: 'Shorter', callback_data: 'act:shorter' }]] };

// A bot wired to a fake writer and a fake Telegram API that records every call.
function setup({ allowedUserIds = [] } = {}) {
  const writerCalls = [];
  const result = (post) => ({ post, placeholders: [], assumptions: [], questions: [], wordCount: 3, remainingIssues: [] });
  const writer = {
    draft: async (raw) => (writerCalls.push({ fn: 'draft', raw }), result('Fresh draft.')),
    revise: async (raw, draft, feedback) => (writerCalls.push({ fn: 'revise', raw, draft, feedback }), result('Revised draft.')),
  };
  const bot = createBot({ token: '1:test', allowedUserIds, writer, gemini: {} });
  bot.botInfo = { id: BOT_ID, is_bot: true, first_name: 'Bot', username: 'test_bot' };

  const apiCalls = [];
  let nextId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload });
    return { ok: true, result: method === 'sendMessage' ? { message_id: nextId++, chat, date: 0, text: payload.text } : true };
  });
  const sent = () => apiCalls.filter((c) => c.method === 'sendMessage').map((c) => c.payload);
  return { bot, writerCalls, sent };
}

let updateId = 1;
const message = (fields) => ({ update_id: updateId++, message: { message_id: 10, date: 0, chat, from: MEERA, ...fields } });

test('plain text starts a new post, sent as a reply to the raw material', async () => {
  const { bot, writerCalls, sent } = setup();
  await bot.handleUpdate(message({ text: 'my raw notes' }));

  assert.deepEqual(writerCalls, [{ fn: 'draft', raw: 'my raw notes' }]);
  const [draft, notes] = sent();
  assert.equal(draft.text, 'Fresh draft.');
  assert.equal(draft.reply_parameters.message_id, 10);
  assert.ok(draft.reply_markup.inline_keyboard.length > 0);
  assert.match(notes.text, /words/);
});

test('a button press revises using the draft and the raw material it replies to', async () => {
  const { bot, writerCalls, sent } = setup();
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: 'cb1', from: MEERA, chat_instance: 'x', data: 'act:shorter',
      message: {
        message_id: 50, date: 0, chat, from: { id: BOT_ID, is_bot: true, first_name: 'Bot' },
        text: 'Old draft.', reply_markup: draftMarkup,
        reply_to_message: { message_id: 10, date: 0, chat, from: MEERA, text: 'my raw notes' },
      },
    },
  });

  assert.equal(writerCalls[0].fn, 'revise');
  assert.equal(writerCalls[0].raw, 'my raw notes');
  assert.equal(writerCalls[0].draft, 'Old draft.');
  assert.match(writerCalls[0].feedback, /shorter/i);
  assert.equal(sent()[0].reply_parameters.message_id, 10, 'new draft keeps replying to the raw material');
});

test('a voice transcript is recovered as raw material without its prefix', async () => {
  const { bot, writerCalls } = setup();
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: 'cb2', from: MEERA, chat_instance: 'x', data: 'act:regen',
      message: {
        message_id: 51, date: 0, chat, from: { id: BOT_ID, is_bot: true, first_name: 'Bot' },
        text: 'Old draft.', reply_markup: draftMarkup,
        reply_to_message: { message_id: 11, date: 0, chat, from: { id: BOT_ID, is_bot: true, first_name: 'Bot' }, text: 'What I heard:\n\nspoken notes' },
      },
    },
  });
  assert.equal(writerCalls[0].raw, 'spoken notes');
});

test('replying to a draft revises it with the reply as feedback', async () => {
  const { bot, writerCalls } = setup();
  await bot.handleUpdate(message({
    text: 'The concentration is 4%',
    reply_to_message: { message_id: 50, date: 0, chat, from: { id: BOT_ID, is_bot: true, first_name: 'Bot' }, text: 'Draft at [CONCENTRATION].', reply_markup: draftMarkup },
  }));
  assert.deepEqual(writerCalls, [{ fn: 'revise', raw: null, draft: 'Draft at [CONCENTRATION].', feedback: 'The concentration is 4%' }]);
});

test('replying to a non-draft bot message starts a new post', async () => {
  const { bot, writerCalls } = setup();
  await bot.handleUpdate(message({
    text: 'new idea',
    reply_to_message: { message_id: 60, date: 0, chat, from: { id: BOT_ID, is_bot: true, first_name: 'Bot' }, text: '12 words. Ready to post.' },
  }));
  assert.equal(writerCalls[0].fn, 'draft');
});

test('users not on the allow list are ignored', async () => {
  const { bot, writerCalls, sent } = setup({ allowedUserIds: [7] });
  await bot.handleUpdate(message({ text: 'my raw notes' }));
  assert.equal(writerCalls.length, 0);
  assert.equal(sent().length, 0);
});
