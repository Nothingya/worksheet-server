'use strict';
// ═══════════════════════════════════════════════════════════════════
//  generate_listening_ielts.js
//  调用 Claude API,把单个 Test 的原始脚本+答案 → task JSON
//  含多层 JSON 兜底(复用 generate_ielts.js 同款策略 + jsonrepair)
// ═══════════════════════════════════════════════════════════════════
const Anthropic = require('@anthropic-ai/sdk');
const { jsonrepair } = require('jsonrepair');
const SYSTEM_PROMPT = require('./prompt_listening_ielts');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseJSONWithFallback(raw) {
  const sanitize = (s) => s.replace(/```json|```/g, '').trim()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F]/gu, m => m); // keep emoji
  const attempts = [
    () => JSON.parse(raw),
    () => JSON.parse(sanitize(raw)),
    () => JSON.parse(sanitize(raw).replace(/,\s*([}\]])/g, '$1')),
    () => Function('"use strict";return (' + sanitize(raw) + ')')(),
    () => JSON.parse(jsonrepair(sanitize(raw))),
  ];
  for (let i = 0; i < attempts.length; i++) {
    try { return attempts[i](); }
    catch (e) { console.log(`[LS parse] Attempt ${i+1} FAIL: ${e.message.slice(0,80)}`); }
  }
  throw new Error('All JSON parse attempts failed for listening task');
}

// testData = { 1:{script,answers}, 2:{...}, 3:{...}, 4:{...} }
async function generateListeningTasks(testNum, testData) {
  const userMsg = `Test ${testNum} 的四个 Part 原始材料如下：\n\n` +
    [1,2,3,4].map(pn =>
      `=== PART ${pn} ===\n[Audioscript]\n${testData[pn]?.script || '(无)'}\n` +
      `[Answer Key]\n${(testData[pn]?.answers || []).join(', ') || '(无)'}\n`
    ).join('\n');

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',          // 与项目其它模块保持一致,可按需调整
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });
  const raw = resp.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  return parseJSONWithFallback(raw);
}

module.exports = { generateListeningTasks };
