// src/generate.js
// Sends article text to Claude API → returns structured worksheet JSON.
// Prompt caching enabled: system prompt is cached for 5 min → 90% cheaper on repeat reads.

const Anthropic = require('@anthropic-ai/sdk');
const { jsonrepair } = require('jsonrepair');   // npm install jsonrepair
const { SYSTEM_PROMPT } = require('./prompt');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────
// Helper 1: sanitize — remove ALL characters that break JSON.parse
// Covers every emoji including variation-selector combos like 🗺️
// ─────────────────────────────────────────────────────────────────
function sanitize(str) {
  return str
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '★') // ALL non-BMP (emoji etc.) → ★
    .replace(/[\uFE00-\uFE0F]/g, '')           // Variation Selectors VS1–VS16
    .replace(/[\u200D\u20E3]/g, '')            // ZWJ + combining enclosing keycap
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // C0/C1 control chars
}

// ─────────────────────────────────────────────────────────────────
// Helper 2: fixNewlinesInStrings
// Replaces bare \n/\r ONLY inside JSON string values (invalid JSON).
// Structural newlines between JSON tokens are left untouched.
// ─────────────────────────────────────────────────────────────────
function fixNewlinesInStrings(str) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && (ch === '\n' || ch === '\r')) { out += ' '; continue; }
    out += ch;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Helper 3: logParseError
// Prints the EXACT position + surrounding context of a JSON parse failure.
// ↵ / ↲ make invisible newlines visible in terminal output.
// ─────────────────────────────────────────────────────────────────
function logParseError(attemptNum, err, str) {
  const msg = err.message || String(err);
  const posMatch = msg.match(/position (\d+)/i);
  const pos = posMatch ? parseInt(posMatch[1]) : -1;
  if (pos >= 0) {
    const start = Math.max(0, pos - 40);
    const end   = Math.min(str.length, pos + 40);
    const ctx   = str.slice(start, end)
                     .replace(/\n/g, '↵')
                     .replace(/\r/g, '↲');
    console.log(`    [parse] Attempt ${attemptNum} FAIL pos=${pos}: ...${ctx}...`);
  } else {
    console.log(`    [parse] Attempt ${attemptNum} FAIL: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Main: generateContent
// ─────────────────────────────────────────────────────────────────
async function generateContent(articleText, articleTitle = '') {
  const userMessage = articleTitle
    ? `Article title: "${articleTitle}"\n\nArticle text:\n\n${articleText}`
    : `Article text:\n\n${articleText}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,

    // ── Prompt Caching ──────────────────────────────────────────
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],

    messages: [{ role: 'user', content: userMessage }]
  });

  // ── Log cache usage ──────────────────────────────────────────
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

  // Strip markdown fences
  let clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Extract just the JSON object (first { to last })
  const first = clean.indexOf('{');
  const last  = clean.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    clean = clean.slice(first, last + 1);
  }

  // ── Parse attempts (each failure logs exact position + context) ──

  // Attempt 1: direct parse — no modifications
  try { return JSON.parse(clean); } catch (e1) { logParseError(1, e1, clean); }

  // Attempt 2: sanitize emoji/control chars
  const s2 = sanitize(clean);
  try { return JSON.parse(s2); } catch (e2) { logParseError(2, e2, s2); }

  // Attempt 3: sanitize + fix bare newlines INSIDE strings only
  const s3 = fixNewlinesInStrings(s2);
  try { return JSON.parse(s3); } catch (e3) { logParseError(3, e3, s3); }

  // Attempt 4: nuclear — replace ALL newlines anywhere with space
  const s4 = s2.replace(/\r?\n/g, ' ');
  try { return JSON.parse(s4); } catch (e4) { logParseError(4, e4, s4); }

  // Attempt 5: Function() — tolerates trailing commas, single quotes
  try {
    return (new Function('return (' + s3 + ')'))();
  } catch (e5) { logParseError(5, e5, s3); }

  // Attempt 6: jsonrepair — handles unescaped " inside strings
  // Root cause of Bug #050: Claude uses ASCII " as Chinese quotation marks
  // inside JSON string values, e.g. "他的收藏包含"狂欢"和"渴望"等类别"
  // jsonrepair detects and escapes these automatically.
  try {
    const repaired = jsonrepair(s2);
    console.log('    [parse] Attempt 6 jsonrepair ✅ succeeded');
    return JSON.parse(repaired);
  } catch (e6) { logParseError(6, e6, s2); }

  // All failed — dump first 800 chars for inspection
  throw new Error(`Claude returned invalid JSON:\n${clean.slice(0, 800)}`);
}

module.exports = { generateContent };
