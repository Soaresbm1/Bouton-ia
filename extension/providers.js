globalThis.MoodleIAProviders = Object.freeze({
  openai: Object.freeze({ name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini' }),
  groq: Object.freeze({ name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' })
});
