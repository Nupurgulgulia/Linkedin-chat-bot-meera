import { Type } from '@google/genai';

// Picks a recent news article to use as the post's hook, or none. Gemini judges relevance
// and source quality; recency, the weighted score and the final choice are computed here.

export const HOOK_WEIGHTS = { topical_match: 0.2, angle_fit: 0.4, usability: 0.25, recency: 0.15 };
export const HOOK_THRESHOLD = 7.0;

const RUBRIC = `You are deciding whether any recent news article is a genuinely relevant
hook for a LinkedIn post Meera Pillai (founder, Skinstinct) is about to
write, based on a voice note she recorded.

You will be given:
1. The note's core point (a short summary)
2. Up to 8 candidate news headlines, each with a source and publish date

Score EACH candidate on these components, 0-10:

1. topical_match (weight 20%) — Is the article about the same general
   subject area as the note (e.g. skincare regulation, ingredient claims,
   formulation science)?

2. angle_fit (weight 40%) — Does the article's SPECIFIC fact or event
   connect to the note's actual point, not just share a broad category?
   An article that happens to mention the same ingredient but makes an
   unrelated point scores low. An article describing the exact issue,
   ruling, or trend the note is about scores high.

3. usability (weight 25%) — Does the article contain something concrete
   enough to reference in a post — a ruling, a stat, a named event, a
   specific company action? Vague trend pieces with nothing citable score
   low, even if on-topic.

4. recency (weight 15%) — Score 10 if published within the last 3 days,
   scaling down to 0 at 10+ days old. (Recency is calculated from the publish
   date automatically, so you do not need to score it.)

Also apply this gate per candidate: if the source is not a real,
identifiable news outlet (spam aggregator, content farm, unclear origin),
set source_valid = false and exclude it from consideration regardless of
its score.

You only see headlines, not article text. Judge usability on what the headline
itself establishes. Do NOT force a weak match: low scores are the right answer
when nothing genuinely connects.

Return one evaluation per candidate, using its number, plus a one-sentence
overall_reasoning that says why the best candidate does or does not work as a hook.`;

const EVAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    evaluations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          number: { type: Type.INTEGER },
          topical_match: { type: Type.NUMBER },
          angle_fit: { type: Type.NUMBER },
          usability: { type: Type.NUMBER },
          source_valid: { type: Type.BOOLEAN },
          reasoning: { type: Type.STRING, description: 'One sentence on how this connects (or not) to the note.' },
        },
        required: ['number', 'topical_match', 'angle_fit', 'usability', 'source_valid', 'reasoning'],
      },
    },
    overall_reasoning: { type: Type.STRING },
  },
  required: ['evaluations', 'overall_reasoning'],
};

export function ageInDays(publishedAt, now = new Date()) {
  return Math.max(0, (now.getTime() - publishedAt.getTime()) / 86_400_000);
}

/** 10 within 3 days, falling linearly to 0 at 10 days. */
export function recencyScore(publishedAt, now = new Date()) {
  const days = ageInDays(publishedAt, now);
  if (days <= 3) return 10;
  if (days >= 10) return 0;
  return Math.round(((10 - days) / 7) * 100) / 10;
}

const clamp = (n) => Math.min(10, Math.max(0, Number(n) || 0));

/** Applies the gate, weights and threshold. Returns the rubric's output shape. */
export function selectHook(candidates, evaluations, { now = new Date(), overallReasoning = '' } = {}) {
  let best = null;
  for (const evaluation of evaluations) {
    const candidate = candidates[evaluation.number - 1];
    if (!candidate || evaluation.source_valid !== true) continue;
    const scores = {
      topical_match: clamp(evaluation.topical_match),
      angle_fit: clamp(evaluation.angle_fit),
      usability: clamp(evaluation.usability),
      recency: recencyScore(candidate.publishedAt, now),
    };
    const weighted = Math.round(Object.entries(HOOK_WEIGHTS).reduce((s, [k, w]) => s + scores[k] * w, 0) * 10) / 10;
    if (!best || weighted > best.weighted_score) {
      best = { candidate, weighted_score: weighted, reasoning: evaluation.reasoning };
    }
  }

  if (best && best.weighted_score >= HOOK_THRESHOLD) {
    const { candidate } = best;
    return {
      candidates_evaluated: candidates.length,
      hook: {
        title: candidate.title,
        link: candidate.link,
        source: candidate.source,
        published: candidate.publishedAt.toISOString().slice(0, 10),
        weighted_score: best.weighted_score,
        reasoning: best.reasoning,
      },
    };
  }
  return {
    candidates_evaluated: candidates.length,
    hook: null,
    reasoning_if_null:
      candidates.length === 0
        ? 'No recent news turned up for this topic.'
        : overallReasoning || `No candidate reached ${HOOK_THRESHOLD}.`,
    best_score: best?.weighted_score ?? null,
  };
}

export function createHookFinder({ gemini, fetchNews }) {
  return {
    async find(corePoint, queries, { now = new Date() } = {}) {
      const candidates = queries?.length ? await fetchNews(queries, { now }) : [];
      if (candidates.length === 0) return selectHook([], [], { now });

      const list = candidates
        .map((c, i) => `${i + 1}. "${c.title}" | source: ${c.source}${c.sourceUrl ? ` (${c.sourceUrl})` : ''} | published: ${c.publishedAt.toISOString().slice(0, 10)} (${ageInDays(c.publishedAt, now).toFixed(1)} days ago)`)
        .join('\n');
      const prompt = `Today is ${now.toISOString().slice(0, 10)}.\n\nThe note's core point:\n${corePoint}\n\nCandidate headlines:\n${list}`;

      const parsed = await gemini.generateJson(prompt, EVAL_SCHEMA, { temperature: 0, system: RUBRIC });
      return selectHook(candidates, parsed.evaluations ?? [], { now, overallReasoning: parsed.overall_reasoning });
    },
  };
}
