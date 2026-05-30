// src/generate_vocab.js
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { VOCAB_SYSTEM_PROMPT } = require('./prompt_vocab');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateVocab(articleText, wordList, title) {
  title = title || '';
  const wl = Array.isArray(wordList) ? wordList : [];
  
  const wordSection = wl.length > 0
    ? 'Target vocabulary words:\n' + wl.map((w,i) => (i+1)+'. '+w).join('\n')
    : 'No word list provided. Extract 8-10 key academic vocabulary words from the article text.';

  const userMsg = [
    'Article title: "' + title + '"',
    '',
    wordSection,
    '',
    'Article text:',
    String(articleText||'').slice(0, 3000)
  ].join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: [{type:'text', text:VOCAB_SYSTEM_PROMPT, cache_control:{type:'ephemeral'}}],
    messages: [{role:'user', content:userMsg}]
  });

  const u = response.usage || {};
  console.log('    [vocab cache]', u.cache_read_input_tokens > 0 ? 'HIT' : 'MISS',
    'in:', u.input_tokens, 'out:', u.output_tokens);

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  const parsed = JSON.parse(raw);
  parsed.title = parsed.title || title;
  return parsed;
}

module.exports = { generateVocab };
