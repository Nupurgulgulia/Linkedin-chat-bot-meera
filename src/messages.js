const TELEGRAM_LIMIT = 4000; // Telegram's hard limit is 4096 characters per message.

/** Splits long text at paragraph, then line, then word boundaries. */
export function splitMessage(text, limit = TELEGRAM_LIMIT) {
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n\n');
    if (cut < limit / 2) cut = window.lastIndexOf('\n');
    if (cut < limit / 2) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** The notes that go with a draft: word count, placeholders, assumptions, questions. */
export function formatNotes(result, { transcript } = {}) {
  const lines = [`${result.wordCount} words.`];

  if (transcript) {
    const preview = transcript.length > 300 ? `${transcript.slice(0, 300)}...` : transcript;
    lines.push('', `What I heard: "${preview}"`);
  }
  if (result.placeholders.length > 0) {
    lines.push('', "Fill these in before posting (or reply to the draft with the facts and I'll put them in):");
    for (const p of result.placeholders) lines.push(`- ${p.placeholder}: ${p.needed}`);
  }
  if (result.assumptions.length > 0) {
    lines.push('', 'Worth checking:');
    for (const a of result.assumptions) lines.push(`- ${a}`);
  }
  if (result.questions.length > 0) {
    lines.push('', 'Answer these for a stronger post (reply to the draft with your answers):');
    for (const q of result.questions) lines.push(`- ${q}`);
  }
  if (result.remainingIssues.length > 0) {
    lines.push('', 'Style issues I could not fix automatically:');
    for (const i of result.remainingIssues) lines.push(`- ${i}`);
  }
  if (result.placeholders.length === 0 && result.assumptions.length === 0 && result.questions.length === 0) {
    lines.push('Ready to post.');
  }
  return lines.join('\n');
}

export const HELP_TEXT = `Send me the raw material for a LinkedIn post and I'll turn it into a ready-to-post draft in Meera's voice.

You can send:
- Typed notes, bullet points or a rough paragraph
- A voice note with your thoughts
- Anything you'd like to react to, pasted in with your take

Under each draft you can ask for a new version, a shorter one, or a simpler or more technical one. To change anything else, reply to the draft (swipe left on it) and tell me what to change.

If a draft has [PLACEHOLDERS], it needs a fact from you. Reply to the draft with the facts and I'll put them in.

Any message that isn't a reply to a draft starts a new post.

/help - show this message`;
