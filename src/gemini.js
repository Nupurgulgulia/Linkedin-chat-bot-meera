import { GoogleGenAI, Type } from '@google/genai';

const POST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    post: {
      type: Type.STRING,
      description: 'The LinkedIn post, plain text, paragraphs separated by a blank line.',
    },
    placeholders: {
      type: Type.ARRAY,
      description: 'Every [PLACEHOLDER] used in the post and what Meera needs to fill in.',
      items: {
        type: Type.OBJECT,
        properties: {
          placeholder: { type: Type.STRING },
          needed: { type: Type.STRING },
        },
        required: ['placeholder', 'needed'],
      },
    },
    assumptions: {
      type: Type.ARRAY,
      description: 'Assumptions made, or concerns about claims in the raw input. Empty if none.',
      items: { type: Type.STRING },
    },
    questions: {
      type: Type.ARRAY,
      description: 'At most three questions, only if the raw input was too thin. Usually empty.',
      items: { type: Type.STRING },
    },
  },
  required: ['post', 'placeholders', 'assumptions', 'questions'],
  propertyOrdering: ['post', 'placeholders', 'assumptions', 'questions'],
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function withRetry(fn, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !RETRYABLE_STATUS.has(err?.status)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** (attempt - 1)));
    }
  }
}

export function createGeminiClient({ apiKey, model, systemInstruction }) {
  const ai = new GoogleGenAI({ apiKey });

  /** Sends a prompt and returns the response parsed against `schema`. */
  async function generateJson(prompt, schema, { temperature, system = systemInstruction } = {}) {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: system,
          temperature,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    );
    try {
      return JSON.parse(response.text ?? '');
    } catch {
      throw new Error('Gemini returned a response that was not valid JSON.');
    }
  }

  /** Sends a prompt and returns the parsed { post, placeholders, assumptions, questions }. */
  async function generatePost(prompt, { temperature = 0.7 } = {}) {
    const parsed = await generateJson(prompt, POST_SCHEMA, { temperature });
    if (!parsed.post?.trim()) throw new Error('Gemini returned an empty post.');

    return {
      post: parsed.post,
      placeholders: parsed.placeholders ?? [],
      assumptions: parsed.assumptions ?? [],
      questions: parsed.questions ?? [],
    };
  }

  /** Turns a voice note into text. */
  async function transcribe(audio, mimeType, instruction) {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: audio.toString('base64') } },
              { text: instruction },
            ],
          },
        ],
        config: { temperature: 0 },
      }),
    );
    const text = response.text?.trim();
    if (!text) throw new Error('Could not transcribe the voice note.');
    return text;
  }

  return { generateJson, generatePost, transcribe };
}
