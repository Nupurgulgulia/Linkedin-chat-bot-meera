import { draftPrompt, repairPrompt, revisePrompt } from './prompts.js';
import { checkStyle, countWords, findPlaceholders, sanitize } from './style-check.js';

/**
 * Wraps the Gemini client with the voice-guide checks: every draft is style-checked,
 * repaired once by the model if it breaks a hard rule, then mechanically cleaned.
 */
export function createWriter(gemini) {
  async function finalise(result) {
    let { post } = result;
    const issues = checkStyle(post);
    if (issues.length > 0) {
      try {
        const repaired = await gemini.generatePost(repairPrompt(post, issues), { temperature: 0.2 });
        post = repaired.post;
      } catch (err) {
        console.warn('Repair pass failed, keeping original draft:', err.message);
      }
    }
    post = sanitize(post);

    // Make sure every placeholder in the text is explained, even if the model forgot one.
    const listed = new Set(result.placeholders.map((p) => p.placeholder));
    const placeholders = [
      ...result.placeholders.filter((p) => post.includes(p.placeholder)),
      ...findPlaceholders(post)
        .filter((p) => !listed.has(p))
        .map((placeholder) => ({ placeholder, needed: 'Fill this in before posting.' })),
    ];

    return {
      ...result,
      post,
      placeholders,
      wordCount: countWords(post),
      remainingIssues: checkStyle(post),
    };
  }

  return {
    draft: async (rawInput, options) => finalise(await gemini.generatePost(draftPrompt(rawInput, options))),
    revise: async (rawInput, draft, feedback) =>
      finalise(await gemini.generatePost(revisePrompt(rawInput, draft, feedback), { temperature: 0.5 })),
  };
}
