# Meera LinkedIn Bot

A Telegram bot that turns Meera Pillai's raw notes and voice memos into ready-to-post LinkedIn posts in her voice, using Gemini.

## How it works

1. Meera sends the bot raw material: typed notes, bullet points, a rough paragraph or a voice note.
2. Voice notes are transcribed by Gemini.
3. Gemini writes the post using `prompts/meera-voice.md` (the voice guide) and `prompts/corpus.md` (her published writing) as its system instruction.
4. The draft is checked against the hard voice rules (no em dashes, exclamation marks, emojis, hashtags, banned phrases, American spelling or one-line "broetry"). If it breaks one, Gemini repairs it once, then a final mechanical cleanup runs.
5. The bot sends the post as its own message so it copies cleanly. A second message lists anything Meera needs to fill in (`[PLACEHOLDERS]`), assumptions worth checking and any questions.
6. Buttons under the draft: **New version**, **Shorter**, **Simpler**, **More technical**, **Give feedback**. She can also reply directly to the draft with changes or missing facts.

The bot never invents stories, numbers or claims. Missing facts become placeholders.

## Setup

Requires Node.js 22 or newer.

1. **Create the Telegram bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token.
2. **Get a Gemini API key** at <https://aistudio.google.com/apikey>.
3. **Configure:**
   ```bash
   cp .env.example .env
   ```
   Paste both keys into `.env`.
4. **Install and run:**
   ```bash
   npm install
   npm start
   ```
5. **Lock it down.** Message your bot `/start`. It replies with your Telegram user ID. Put Meera's ID (and yours, for testing) in `ALLOWED_TELEGRAM_USER_IDS` in `.env`, comma-separated, then restart. Until you do, anyone who finds the bot can use your Gemini quota.

## Updating Meera's voice

The voice lives in `prompts/meera-voice.md` and `prompts/corpus.md`. These are copies of the Claude Code skill at `~/.claude/skills/meera-voice/`. If you improve the skill, copy the files over again and restart the bot. To add new published posts to the corpus, append them to `prompts/corpus.md` in the same format.

## Project layout

```
prompts/           Voice guide and corpus (the "brain" of the bot)
src/index.js       Entry point: loads config, wires everything, starts polling
src/config.js      Reads environment variables
src/bot.js         Telegram handlers: text, voice, buttons, commands
src/writer.js      Draft, style-check, repair pipeline
src/gemini.js      Gemini API calls (JSON output, transcription, retries)
src/prompts.js     System instruction and per-request prompts
src/style-check.js Rule checks for the voice guide's hard rules
src/messages.js    Telegram message formatting and splitting
test/              Unit tests (npm test)
```

## Running it permanently

`npm start` uses long polling, so it works anywhere with internet access and needs no public URL. The bot only answers while the process is running. To keep it up around the clock, run it on a small always-on host (Railway, Render, Fly.io, a VPS or a Raspberry Pi), with the same environment variables set there.

Drafts are kept in memory. If the bot restarts, Meera just sends the raw material again.

## Notes

- `GEMINI_MODEL` defaults to `gemini-3.6-flash`. Any Gemini model with JSON output and audio input works. A "pro" model gives better writing but is slower and costs more.
- Telegram bots can only download files up to 20 MB, which is roughly 20 minutes of voice note.
