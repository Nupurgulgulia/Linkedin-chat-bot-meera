import { Type } from '@google/genai';
import { verifiedFacts } from './prompts.js';

// Weights from the scoring rubric. They sum to 0.80, so the weighted score is divided by
// that total to keep it on a 0-10 scale (otherwise a perfect note would score 8.0 and
// "qualified" at 7.0 would be nearly unreachable). Relative importance is unchanged.
export const WEIGHTS = {
  specificity: 0.25,
  mechanism_depth: 0.2,
  verifiability: 0.15,
  raw_material: 0.1,
  fairness_risk: 0.1,
};

export const THRESHOLDS = { qualified: 7.0, borderline: 4.5 };

const RUBRIC = `You are scoring a voice-note transcript (or typed notes) from Meera Pillai, founder of
Skinstinct, to decide if it has enough substance to become a LinkedIn post.

Score the note on these components, each 0-10:

1. specificity (weight 25%) — Does it contain a number, a named mechanism,
   or a concrete detail? Vague opinions score low. A pH value, a percentage,
   a specific ingredient interaction scores high.

2. mechanism_depth (weight 20%) — Does it explain WHY something happens,
   not just THAT it happens? "Labels are misleading" = low. "Niacinamide
   converts to niacin below pH 4, causing flushing" = high.

3. verifiability (weight 15%) — Could this become a post without inventing
   facts, numbers, or quotes? If writing it up would require making things
   up to sound complete, score low even if the idea is interesting.

4. raw_material (weight 10%) — Is there enough substance here for 300-550
   words, or is it a single thin sentence?

5. fairness_risk (weight 10%) — Can this be written without attacking a
   named competitor or making a medical/diagnostic claim? Score 10 if
   clean, 0 if it requires either of those to make sense.

Then apply hard gates. List each one that is true in gates_triggered:
- note names or clearly identifies a specific competitor
- note makes or implies a medical/diagnostic claim
- note states a "fact" that sounds fabricated or unverifiable and isn't
  flagged by Meera herself as speculative

The facts below are Meera's own verified background and published statements. When the
note uses them, they count as verifiable and must not trigger the fabrication gate.
Explaining how a cosmetic ingredient behaves (for example pH-dependent conversion or
sensitisation risk) is not a medical or diagnostic claim; diagnosing or promising to
treat a skin condition is.

=== VERIFIED FACTS ===
${verifiedFacts()}
=== END VERIFIED FACTS ===

Return the scores, the gates triggered (empty list if none), and one sentence of
reasoning. If the verdict is not "qualified", the reasoning should say what Meera could
add to make it one.

Also return:
- core_point: the note's actual point in one plain sentence.
- news_queries: 2 or 3 short news search queries (2 to 5 words each) that would find
  recent news articles about the specific issue this note is about, for example
  "niacinamide serum pH" or "CDSCO cosmetics labelling". Prefer specific ingredients,
  regulations and events over generic words like "skincare".`;

const SCORE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scores: {
      type: Type.OBJECT,
      properties: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, { type: Type.NUMBER }])),
      required: Object.keys(WEIGHTS),
    },
    gates_triggered: { type: Type.ARRAY, items: { type: Type.STRING } },
    reasoning: { type: Type.STRING },
    core_point: { type: Type.STRING },
    news_queries: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['scores', 'gates_triggered', 'reasoning', 'core_point', 'news_queries'],
  propertyOrdering: ['scores', 'gates_triggered', 'reasoning', 'core_point', 'news_queries'],
};

/** Weighted score (0-10, one decimal) and verdict, computed here rather than trusted to the model. */
export function computeVerdict(scores, gatesTriggered = []) {
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const raw = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => {
    const value = Math.min(10, Math.max(0, Number(scores[key]) || 0));
    return sum + value * weight;
  }, 0);
  const weightedScore = Math.round((raw / totalWeight) * 10) / 10;

  let verdict;
  if (gatesTriggered.length > 0) verdict = 'rejected';
  else if (weightedScore >= THRESHOLDS.qualified) verdict = 'qualified';
  else if (weightedScore >= THRESHOLDS.borderline) verdict = 'borderline';
  else verdict = 'rejected';

  return { weightedScore, verdict };
}

export function createScorer(gemini) {
  return {
    /** Returns { scores, weighted_score, gates_triggered, verdict, reasoning, core_point, news_queries }. */
    async score(note) {
      const parsed = await gemini.generateJson(`<note>\n${note}\n</note>`, SCORE_SCHEMA, {
        temperature: 0,
        system: RUBRIC,
      });
      const gates = (parsed.gates_triggered ?? []).filter((g) => g?.trim());
      const { weightedScore, verdict } = computeVerdict(parsed.scores ?? {}, gates);
      return {
        scores: parsed.scores,
        weighted_score: weightedScore,
        gates_triggered: gates,
        verdict,
        reasoning: parsed.reasoning ?? '',
        core_point: parsed.core_point ?? '',
        news_queries: (parsed.news_queries ?? []).filter((q) => q?.trim()).slice(0, 3),
      };
    },
  };
}
