import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitMessage } from '../src/messages.js';
import { buildSystemInstruction } from '../src/prompts.js';
import { checkStyle, findPlaceholders, sanitize } from '../src/style-check.js';

const MEERA_STYLE = `Most niacinamide serums list the ingredient at 5% or 10%. That number tells you less than it seems to. Niacinamide converts to niacin at low pH, and niacin causes flushing.

Most brands don't list pH. This is legal. It is also not helpful.

If you want to know, ask the brand in writing. If the answer is vague or doesn't arrive, that is also useful information.`;

const GENERIC_AI = `🌿 Ever wondered if your serum works? As a founder who's passionate about transparency — I've learned a lot on this journey!

At Skinstinct, we believe you deserve better. #skincare Thoughts?`;

test('a post in Meera style passes', () => {
  assert.deepEqual(checkStyle(MEERA_STYLE), []);
});

test('generic AI style is caught', () => {
  const issues = checkStyle(GENERIC_AI).join('\n');
  for (const expected of ['em dashes', 'exclamation', 'emojis', 'hashtags', '"passionate"', '"journey"', '"we believe"', 'engagement bait']) {
    assert.match(issues, new RegExp(expected), `expected issue about ${expected}`);
  }
});

test('American spelling is caught', () => {
  assert.match(checkStyle('Vitamin C can oxidize quickly.').join(), /oxidise/);
});

test('broetry is caught', () => {
  const broetry = Array.from({ length: 8 }, (_, i) => `Line number ${i}.`).join('\n\n');
  assert.match(checkStyle(broetry).join(), /one-line paragraphs/);
});

test('sanitize replaces dashes with a spaced hyphen', () => {
  assert.equal(sanitize('pH matters — a lot.'), 'pH matters - a lot.');
  assert.equal(sanitize('pages 3–4'), 'pages 3 - 4');
});

test('placeholders are found', () => {
  assert.deepEqual(findPlaceholders('At [CONCENTRATION] and pH [PH RANGE], see [CONCENTRATION].'), ['[CONCENTRATION]', '[PH RANGE]']);
});

test('long messages split under the Telegram limit on paragraph breaks', () => {
  const para = 'word '.repeat(300).trim();
  const chunks = splitMessage([para, para, para, para].join('\n\n'), 4000);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 4000);
});

test('system instruction includes the voice guide and corpus without frontmatter', () => {
  const system = buildSystemInstruction();
  assert.match(system, /the label is the beginning of the question/);
  assert.match(system, /linkedin_post_001/);
  assert.doesNotMatch(system, /^---\s*\nname: meera-voice/m);
});
