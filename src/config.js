function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function loadConfig() {
  const allowedUserIds = (process.env.ALLOWED_TELEGRAM_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number);

  return {
    telegramToken: required('TELEGRAM_BOT_TOKEN'),
    geminiApiKey: required('GEMINI_API_KEY'),
    geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash',
    allowedUserIds,
  };
}
