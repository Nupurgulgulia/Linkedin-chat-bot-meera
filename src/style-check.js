// Mechanical checks for the hard rules in the voice guide. The model is asked to follow
// them already; this catches the slips so they can be repaired before Meera sees them.

const BANNED_PHRASES = [
  'journey',
  'passionate',
  'game-changer',
  'game changer',
  'holy grail',
  'skin-loving',
  'miracle',
  'unlock',
  'elevate',
  'curated',
  "let's dive in",
  "here's the thing",
  "in today's world",
  'you deserve better',
  'we believe',
];

const ENGAGEMENT_BAIT = [
  /\bthoughts\?/i,
  /\bagree\?/i,
  /\bdrop a comment\b/i,
  /\btag someone\b/i,
  /\bcomment below\b/i,
  /\blet me know in the comments\b/i,
];

// Common American spellings that would slip into skincare writing.
const AMERICAN_SPELLINGS = {
  color: 'colour',
  colors: 'colours',
  favor: 'favour',
  favorite: 'favourite',
  behavior: 'behaviour',
  behaviors: 'behaviours',
  oxidize: 'oxidise',
  oxidizes: 'oxidises',
  oxidized: 'oxidised',
  optimize: 'optimise',
  optimized: 'optimised',
  maximize: 'maximise',
  minimize: 'minimise',
  standardized: 'standardised',
  sensitization: 'sensitisation',
  organization: 'organisation',
  program: 'programme',
  analyze: 'analyse',
  realize: 'realise',
  recognize: 'recognise',
  stabilize: 'stabilise',
  stabilized: 'stabilised',
  center: 'centre',
  fiber: 'fibre',
};

const LINKEDIN_LIMIT = 3000;

const EMOJI =/\p{Extended_Pictographic}/u;
const HASHTAG = /(^|\s)#[\p{L}\d_]+/u;

export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function findPlaceholders(text) {
  return [...new Set(text.match(/\[[A-Z0-9][A-Z0-9 ,/&'()-]*\]/g) ?? [])];
}

/** Returns a list of human-readable rule violations; empty means the post passes. */
export function checkStyle(text) {
  const issues = [];
  const lower = text.toLowerCase();

  if (text.length > LINKEDIN_LIMIT) {
    issues.push(`Is ${text.length} characters; LinkedIn's limit is ${LINKEDIN_LIMIT}. Shorten it to under 2,800 characters by cutting secondary points.`);
  }
  if (/[—–]/.test(text)) issues.push('Contains em dashes or en dashes. Rewrite those sentences with full stops, commas, colons or parentheses.');
  if (text.includes('!')) issues.push('Contains exclamation marks. Remove them.');
  if (EMOJI.test(text)) issues.push('Contains emojis. Remove them.');
  if (HASHTAG.test(text)) issues.push('Contains hashtags. Remove them.');
  if (/\*\*|__|^#{1,6}\s/m.test(text)) issues.push('Contains markdown formatting. LinkedIn shows it literally; use plain text.');

  for (const phrase of BANNED_PHRASES) {
    if (new RegExp(`\\b${phrase.replace(/[-']/g, '[-\']?')}\\b`, 'i').test(lower)) {
      issues.push(`Uses "${phrase}", which Meera avoids.`);
    }
  }
  for (const pattern of ENGAGEMENT_BAIT) {
    if (pattern.test(text)) issues.push('Ends with engagement bait. Close with something the reader can ask or understand instead.');
  }
  for (const [us, uk] of Object.entries(AMERICAN_SPELLINGS)) {
    if (new RegExp(`\\b${us}\\b`, 'i').test(text)) issues.push(`American spelling "${us}". Use "${uk}".`);
  }

  // Broetry: many very short lines each on their own paragraph.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const oneLiners = paragraphs.filter((p) => countWords(p) <= 12).length;
  if (paragraphs.length >= 6 && oneLiners / paragraphs.length > 0.5) {
    issues.push('Too many one-line paragraphs. Meera writes in full paragraphs.');
  }

  return [...new Set(issues)];
}

/** Last-resort cleanup for anything a repair pass missed. */
export function sanitize(text) {
  return text
    .replace(/\s*[—–]\s*/g, ' - ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
