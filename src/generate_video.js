// src/generate_video.js — Generate video practice JSON via Claude API
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { VIDEO_SYSTEM_PROMPT } = require('./prompt_video');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate video practice exercises from a video script.
 * @param {string} scriptText - the video script text
 * @param {string} title      - video/unit title
 */
async function generateVideo(scriptText, title = '') {
  const userMsg = `Video title: "${title}"\n\nVideo script:\n\n${scriptText}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: [{ type: 'text', text: VIDEO_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }]
  });

  const u = response.usage || {};
  const hit = (u.cache_read_input_tokens || 0) > 0;
  console.log(`    [video cache] ${hit ? '✅ HIT' : '📝 MISS'}  output=${u.output_tokens}`);

  const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Video JSON parse failed:\n${raw.slice(0, 300)}`);
  }
}

module.exports = { generateVideo };
