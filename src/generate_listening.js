// src/generate_listening.js
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { LISTENING_SYSTEM_PROMPT } = require('./prompt_listening');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateListening(scriptText, title = '', lesson = 'A') {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 12000,
    system: [{ type:'text', text:LISTENING_SYSTEM_PROMPT, cache_control:{type:'ephemeral'} }],
    messages: [{ role:'user', content:`Title: "${title}" Lesson: ${lesson}\n\nScript:\n\n${scriptText}` }]
  });
  const u = response.usage || {};
  console.log(`    [listening cache] ${u.cache_read_input_tokens>0?'✅ HIT':'📝 MISS'}  output=${u.output_tokens}`);
  const raw = response.content.filter(b=>b.type==='text').map(b=>b.text).join('')
    .replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/i,'').trim();
  try { return JSON.parse(raw); }
  catch(e) { throw new Error(`Listening JSON parse failed:\n${raw.slice(0,300)}`); }
}

module.exports = { generateListening };
