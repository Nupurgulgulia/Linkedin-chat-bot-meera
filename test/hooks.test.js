import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHookFinder, recencyScore, selectHook } from '../src/hooks.js';
import { fetchNews, parseNewsRss } from '../src/news.js';

const NOW = new Date('2026-09-24T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000);

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>CDSCO issues new cosmetic labelling norms &amp; deadlines - The Hindu</title><link>https://news.google.com/a</link><pubDate>Tue, 22 Sep 2026 08:00:00 GMT</pubDate><source url="https://www.thehindu.com">The Hindu</source></item>
<item><title>Why niacinamide is everywhere - Some Blog</title><link>https://news.google.com/b</link><pubDate>Mon, 01 Jan 2026 08:00:00 GMT</pubDate><source url="https://someblog.xyz">Some Blog</source></item>
<item><title>Broken item without a date</title><link>https://news.google.com/c</link></item>
</channel></rss>`;

test('parses Google News RSS, strips the source suffix and decodes entities', () => {
  const items = parseNewsRss(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'CDSCO issues new cosmetic labelling norms & deadlines');
  assert.equal(items[0].source, 'The Hindu');
  assert.equal(items[0].sourceUrl, 'https://www.thehindu.com');
});

test('fetchNews drops old items, dedupes across queries and survives a failed query', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 2) throw new Error('network down');
    return { ok: true, text: async () => RSS };
  };
  const items = await fetchNews(['a', 'b', 'c'], { now: NOW, fetchImpl });
  assert.equal(calls, 3);
  assert.deepEqual(items.map((i) => i.source), ['The Hindu']);
});

test('recency: 10 within 3 days, 0 at 10+ days, linear between', () => {
  assert.equal(recencyScore(daysAgo(1), NOW), 10);
  assert.equal(recencyScore(daysAgo(3), NOW), 10);
  assert.equal(recencyScore(daysAgo(6.5), NOW), 5);
  assert.equal(recencyScore(daysAgo(10), NOW), 0);
  assert.equal(recencyScore(daysAgo(30), NOW), 0);
});

const candidates = [
  { title: 'Strong but spam', link: 'l1', source: 'ContentFarm', publishedAt: daysAgo(1) },
  { title: 'Strong and real', link: 'l2', source: 'The Hindu', publishedAt: daysAgo(2) },
  { title: 'Weak and real', link: 'l3', source: 'Mint', publishedAt: daysAgo(1) },
];

test('selects the best valid candidate at or above 7.0 and ignores invalid sources', () => {
  const r = selectHook(candidates, [
    { number: 1, topical_match: 10, angle_fit: 10, usability: 10, source_valid: false, reasoning: 'x' },
    { number: 2, topical_match: 8, angle_fit: 8, usability: 7, source_valid: true, reasoning: 'Same issue.' },
    { number: 3, topical_match: 5, angle_fit: 2, usability: 3, source_valid: true, reasoning: 'y' },
  ], { now: NOW });
  // 8*.2 + 8*.4 + 7*.25 + 10*.15 = 8.05 -> 8.1 (rounded)
  assert.equal(r.candidates_evaluated, 3);
  assert.equal(r.hook.title, 'Strong and real');
  assert.equal(r.hook.weighted_score, 8.1);
  assert.equal(r.hook.published, daysAgo(2).toISOString().slice(0, 10));
});

test('returns null rather than forcing a weak match', () => {
  const r = selectHook(candidates, [
    { number: 2, topical_match: 8, angle_fit: 5, usability: 5, source_valid: true, reasoning: 'Broad match only.' },
  ], { now: NOW, overallReasoning: 'Only broad matches.' });
  // 8*.2 + 5*.4 + 5*.25 + 10*.15 = 6.35
  assert.equal(r.hook, null);
  assert.equal(r.reasoning_if_null, 'Only broad matches.');
});

test('no candidates means no hook and no Gemini call', async () => {
  let geminiCalled = false;
  const finder = createHookFinder({
    gemini: { generateJson: async () => { geminiCalled = true; } },
    fetchNews: async () => [],
  });
  const r = await finder.find('point', ['query'], { now: NOW });
  assert.equal(r.hook, null);
  assert.equal(r.candidates_evaluated, 0);
  assert.equal(geminiCalled, false);
});
