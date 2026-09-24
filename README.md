# Meera LinkedIn Bot

A Telegram bot that turns Meera Pillai's raw notes and voice memos into ready-to-post LinkedIn posts in her voice, using Gemini. It runs on Vercel as a webhook.

## How it works

1. Meera sends the bot raw material: typed notes, bullet points, a rough paragraph or a voice note.
2. Voice notes are transcribed by Gemini.
3. Gemini writes the post using `prompts/meera-voice.md` (the voice guide) and `prompts/corpus.md` (her published writing) as its system instruction.
4. The draft is checked against the hard voice rules (no em dashes, exclamation marks, emojis, hashtags, banned phrases, American spelling or one-line "broetry"). If it breaks one, Gemini repairs it once, then a final mechanical cleanup runs.
5. The bot sends the post as its own message so it copies cleanly. A second message lists anything Meera needs to fill in (`[PLACEHOLDERS]`), assumptions worth checking and any questions.
6. Buttons under the draft: **New version**, **Shorter**, **Simpler**, **More technical**. To change anything else, or fill in placeholders, she replies to the draft.

The bot never invents stories, numbers or claims. Missing facts become placeholders.

## Deploying on Vercel

Requires Node.js 22 or newer locally.

1. **Create the Telegram bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token.
2. **Get a Gemini API key** at <https://aistudio.google.com/apikey>.
3. **Import the GitHub repo into Vercel** (Add New → Project). No build settings are needed. Every push to `main` redeploys.
4. **Add environment variables** in Vercel → Project → Settings → Environment Variables:
   - `TELEGRAM_BOT_TOKEN` (required)
   - `GEMINI_API_KEY` (required)
   - `ALLOWED_TELEGRAM_USER_IDS` (comma-separated; strongly recommended)
   - `GEMINI_MODEL` (optional, defaults to `gemini-3.6-flash`)

   Then redeploy (Deployments → ⋯ → Redeploy) so the function picks them up.
5. **Check the deployment:** open `https://<your-app>.vercel.app/api/webhook`. It should show `"telegramTokenSet": true` and `"geminiKeySet": true`.
6. **Point Telegram at it** (once, from your computer, with the token in `.env`):
   ```bash
   npm install
   npm run set-webhook -- https://<your-app>.vercel.app
   ```
7. **Lock it down.** Message the bot `/start`. It replies with your Telegram user ID. Put Meera's ID and yours in `ALLOWED_TELEGRAM_USER_IDS` on Vercel and redeploy.

The webhook only accepts requests carrying a secret derived from the bot token, which Telegram sends automatically, so nobody else can post fake messages to it.

## Running locally

```bash
cp .env.example .env   # then fill in the keys
npm install
npm start
```

`npm start` uses long polling, which **removes the Vercel webhook** (Telegram only allows one or the other). When you're done, run `npm run set-webhook` to hand the bot back to Vercel.

## Updating Meera's voice

The voice lives in `prompts/meera-voice.md` and `prompts/corpus.md`. These are copies of the Claude Code skill at `~/.claude/skills/meera-voice/`. If you improve the skill, copy the files over again and push to GitHub so Vercel redeploys. To add new published posts to the corpus, append them to `prompts/corpus.md` in the same format.

## Project layout

```
prompts/           Voice guide and corpus (the "brain" of the bot)
api/webhook.js     Vercel function: receives Telegram updates
scripts/           set-webhook.js points Telegram at the deployment
src/app.js         Wires config, Gemini, writer and bot together
src/index.js       Local mode: long polling
src/config.js      Reads environment variables, derives the webhook secret
src/bot.js         Telegram handlers: text, voice, buttons, commands
src/writer.js      Draft, style-check, repair pipeline
src/gemini.js      Gemini API calls (JSON output, transcription, retries)
src/prompts.js     System instruction and per-request prompts
src/style-check.js Rule checks for the voice guide's hard rules
src/messages.js    Telegram message formatting and splitting
test/              Unit tests (npm test)
```

## No database

The bot keeps nothing in memory between messages. Each draft is sent as a reply to Meera's raw material, so a button press carries both. Replying to a draft carries the draft text. That's why it can run on serverless functions without a database.

## Notes

- `GEMINI_MODEL` defaults to `gemini-3.6-flash`. Any Gemini model with JSON output and audio input works. A "pro" model gives better writing but is slower and costs more.
- Telegram bots can only download files up to 20 MB, which is roughly 20 minutes of voice note.
