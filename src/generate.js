// src/generate.js
// Sends article text to Claude API → returns structured worksheet JSON.
// Prompt caching enabled: system prompt is cached for 5 min → 90% cheaper on repeat reads.

const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./prompt');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate worksheet content for a given article.
 * @param {string} articleText - plain text of the article
 * @param {string} articleTitle - title hint (optional, Claude will detect it too)
 * @returns {Promise<Object>} - parsed JSON with homework + blackboard data
 */
async function generateContent(articleText, articleTitle = '') {
  const userMessage = articleTitle
    ? `Article title: "${articleTitle}"\n\nArticle text:\n\n${articleText}`
    : `Article text:\n\n${articleText}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,

    // ── Prompt Caching ──────────────────────────────────────────
    // system 改成数组格式，加 cache_control。
    // 第1篇：写入缓存（1.25x 写入费）
    // 第2篇起：直接读缓存（0.1x 读取费，省 90%）
    // 缓存有效期：5 分钟（批量跑完全够用）
    // ────────────────────────────────────────────────────────────
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],

    messages: [{ role: 'user', content: userMessage }]
  });

  // ── Log cache usage (便于调试确认缓存是否命中) ──────────────
  const usage = response.usage;
  if (usage) {
    const cacheRead    = usage.cache_read_input_tokens    || 0;
    const cacheCreated = usage.cache_creation_input_tokens || 0;
    const regular      = usage.input_tokens               || 0;
    const output       = usage.output_tokens              || 0;

    const status = cacheRead > 0
      ? `✅ cache HIT  (saved ${cacheRead} tokens @ 10% price)`
      : `📝 cache MISS (wrote ${cacheCreated} tokens to cache)`;

    console.log(`    [cache] ${status}`);
    console.log(`    [tokens] input=${regular} | cache_read=${cacheRead} | output=${output}`);
  }

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Strip any accidental markdown fences
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch (err) {
    throw new Error(`Claude returned invalid JSON:\n${clean.slice(0, 500)}`);
  }
}

module.exports = { generateContent };
