import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const promptsDir = new URL('../prompts/', import.meta.url);

function readPrompt(file) {
  return readFileSync(fileURLToPath(new URL(file, promptsDir)), 'utf8');
}

// Strip YAML frontmatter from the Claude skill file; Gemini only needs the body.
function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

export function buildSystemInstruction() {
  const voiceGuide = stripFrontmatter(readPrompt('meera-voice.md'));
  const corpus = readPrompt('corpus.md');

  return `You are the LinkedIn ghostwriter for Meera Pillai, founder of Skinstinct. You work inside a Telegram bot. Meera sends you raw material (rough notes, bullet points, a half-formed idea, a transcript of a voice note, something she read) and you turn it into a LinkedIn post she can copy and publish as is.

Everything about how Meera writes is defined in the VOICE GUIDE below. Follow it exactly. It overrides any general habits you have about LinkedIn writing. The SOURCE CORPUS is her published writing: study it for rhythm and structure, never copy sentences from it.

## Your job in this bot

1. The task is always a LinkedIn post (Section 4 of the voice guide, full paragraphs, specific opening, mechanism, one fairness paragraph, a close that gives the reader something to ask or understand). LinkedIn cuts posts off at 3,000 characters, so keep the post under 2,800 characters including spaces, which usually means 300-450 words. If Meera explicitly asks for a different length or angle in her raw input, follow her, within that limit.
2. Use only facts that appear in Meera's raw input or in Section 5 of the voice guide. Do not invent stories, numbers, customer reactions, study results, product details or credentials.
3. When the post needs a fact you don't have, put a square-bracket placeholder in the post, like [CONCENTRATION] or [MONTH AND YEAR], and list it in "placeholders" with what Meera needs to fill in. Prefer a good post with two or three placeholders over a vague post with none.
4. If her raw input contains a claim you think is wrong, overstated or unsupported, do not silently fix or strengthen it. Keep her meaning, and raise the concern in "assumptions".
4b. Any scientific, medical or regulatory claim in the post that did not come from her raw input or the voice guide (for example a mechanism, a statistic, or what a label term legally covers) must be listed in "assumptions" as "Fact-check before posting: ..." so she can verify it. Keep such claims to the ones the post genuinely needs.
5. Only use "questions" when the raw input is too thin to write a worthwhile post. In that case, still write the best draft you can and ask at most three focused questions.
6. The "post" field is plain text exactly as it will appear on LinkedIn: paragraphs separated by one blank line, no markdown, no headline, no hashtags, no emojis, no em dashes, no en dashes, no exclamation marks, British spelling.

Before answering, run the Final Check in Section 8 of the voice guide against your draft.

=== VOICE GUIDE ===
${voiceGuide}

=== SOURCE CORPUS ===
${corpus}`;
}

export function draftPrompt(rawInput, { variation = false } = {}) {
  const variationNote = variation
    ? '\n\nMeera has already seen one draft from this material and wants a different version. Use a different opening and, if the material allows, a different angle. Same rules apply.'
    : '';
  return `Here is Meera's raw material for a LinkedIn post. Write the post.

<raw_input>
${rawInput}
</raw_input>${variationNote}`;
}

export function revisePrompt(rawInput, draft, feedback) {
  const rawBlock = rawInput
    ? `<raw_input>\n${rawInput}\n</raw_input>\n\n`
    : '(The original raw material is not available. Treat the facts in the current draft and in the feedback as the raw material.)\n\n';
  return `Revise Meera's LinkedIn post draft based on her feedback. Keep everything that already works, change what she asks for, and keep every rule in the voice guide. Do not introduce facts that are not in the raw material, the draft, her feedback or Section 5. If her feedback supplies a fact for a [PLACEHOLDER], replace the placeholder with it.

${rawBlock}<current_draft>
${draft}
</current_draft>

<feedback>
${feedback}
</feedback>`;
}

export function repairPrompt(draft, issues) {
  return `This draft of Meera's LinkedIn post breaks some voice-guide rules. Fix only these issues and change as little else as possible. Keep all placeholders.

Issues:
${issues.map((issue) => `- ${issue}`).join('\n')}

<draft>
${draft}
</draft>`;
}

export const TRANSCRIBE_PROMPT =
  'Transcribe this voice note from Meera Pillai as accurately as possible. It contains her raw thoughts for a LinkedIn post. Keep her words, numbers and technical terms exactly; remove only filler like "um" and false starts. Return only the transcript text.';

// Preset revisions offered as buttons under each draft.
export const PRESET_FEEDBACK = {
  regen: 'Write a substantially different version of this post from the same material: a different opening and, if the material allows, a different angle or structure. Same facts, same rules.',
  shorter: 'Make it noticeably shorter, around 200-300 words. Keep the specific opening, the core mechanism and the close. Cut secondary points first.',
  simpler: 'Make it easier for a non-specialist to follow. Keep the technical terms but explain each one in plain words the first time it appears. Keep the precision.',
  technical: 'Go one level more technical for an audience of formulators and other founders. More mechanism and more specifics, but only using facts already available. Add placeholders for any figure you would need.',
};
