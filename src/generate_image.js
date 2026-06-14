/**
 * src/generate_image.js
 * 调用 OpenAI 图片生成 API（用于 TOEFL 口语词汇场景图等）。
 *
 * 第一版：直接输入 prompt 文本生成。
 * 预留扩展：buildPrompt() 将来接收多选字段（场景/风格/元素…）拼成完整 prompt。
 *
 * 环境变量：OPENAI_API_KEY（与 ANTHROPIC_API_KEY 分开）
 */
'use strict';
require('dotenv').config();
const OpenAI = require('openai');

// 懒加载：仅在实际生成时创建 client，避免无 key 时模块加载即崩溃
let _client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 未设置');
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

// ── 中文 → 英文海报 prompt 转换（Claude API）──────────────────────
// 当输入含中文时，调 Claude 翻译并重构为 gpt-image-2 适合的「密集信息图海报」英文 prompt。
const POSTER_SYSTEM = `You convert a teacher's (often Chinese) description of a TOEFL speaking vocabulary scene sheet into ONE high-quality English prompt for the gpt-image-2 image model.

The output must describe a DENSE, PREMIUM, ILLUSTRATED INFOGRAPHIC POSTER (not a soft watercolor storybook page). Always enforce this style and structure:

CANVAS: A4 portrait, print-ready educational infographic; dense premium university poster layout; top ~18% is a wide illustrated campus header with a large title and a subtitle "TOEFL Speaking Scenes".

STYLE: hand-drawn realistic illustration with colored-pencil texture; refined academic poster style, vintage campus-guide feeling; muted navy / forest green / warm beige / soft brown; thin ink outlines; textured paper background; dense but clean; NOT watercolor, NOT cartoon, NOT empty. Use dark colored section bars, cream label boxes, fine borders, consistent spacing.

LAYOUT: divide the body into small bordered panels; each vocabulary phrase appears EXACTLY ONCE inside a small cream label near its matching scene; English only; no Chinese; no source labels; do not repeat a phrase; do not use all-caps except short signs.

From the teacher's input, extract: the topic title, the sub-scene name(s), and every English vocabulary phrase/expression to be illustrated. For each phrase, invent a concrete campus/daily-life mini-scene. Keep all labels readable.

Output ONLY the final English prompt text, no preamble, no markdown.`;

async function toPosterPrompt(rawText) {
  if (!process.env.ANTHROPIC_API_KEY) return null;   // 无 Claude key 则跳过，走原文
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: POSTER_SYSTEM,
    messages: [{ role: 'user', content: rawText }]
  });
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return text || null;
}

const hasChinese = s => /[\u4e00-\u9fff]/.test(String(s || ''));

// ── prompt 组装（预留多选扩展位）──────────────────────────────────
/**
 * 将用户输入与可选字段拼成最终 prompt。
 * 第一版只用 rawPrompt；后续多选项填入 options 即可自动拼接。
 * @param {string} rawPrompt 用户直接输入的描述
 * @param {object} [options] { scene, style, elements:[], mood, ... } 预留
 */
function buildPrompt(rawPrompt, options = {}) {
  const parts = [];
  if (rawPrompt && rawPrompt.trim()) parts.push(rawPrompt.trim());

  // ── 以下为预留多选拼接位（当前未启用，传入即生效）──
  if (options.scene)    parts.push(`Scene: ${options.scene}`);
  if (options.style)    parts.push(`Style: ${options.style}`);
  if (Array.isArray(options.elements) && options.elements.length)
    parts.push(`Key elements: ${options.elements.join(', ')}`);
  if (options.mood)     parts.push(`Mood: ${options.mood}`);

  // TOEFL 口语词汇场景图的默认风格约束（可被 options.noDefaultStyle 关闭）
  if (!options.noDefaultStyle) {
    parts.push('Clear, educational illustration suitable for vocabulary learning; ' +
      'realistic and uncluttered; no text or letters in the image.');
  }
  return parts.join('. ');
}

/** 质量参数映射：前端可能传 standard/hd 或 low/medium/high */
function mapQuality(q, family) {
  if (family === 'gpt') {
    // gpt-image-2 接受 low|medium|high
    if (q === 'hd' || q === 'high') return 'high';
    if (q === 'low') return 'low';
    return 'medium';
  }
  // dall-e-3 接受 standard|hd
  if (q === 'hd' || q === 'high') return 'hd';
  return 'standard';
}

/**
 * 生成图片，返回 PNG Buffer。
 * @param {string} rawPrompt
 * @param {object} [opts] { model, size, quality, output_format, options }
 * @returns {Promise<{buffer:Buffer, prompt:string, revisedPrompt:string}>}
 */
async function generateImage(rawPrompt, opts = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 未设置');

  // 含中文 → 调 Claude 转成英文海报 prompt（失败则回退原文 + buildPrompt 约束）
  let prompt;
  let converted = false;
  if (hasChinese(rawPrompt) && opts.autoConvert !== false) {
    try {
      const poster = await toPosterPrompt(rawPrompt);
      if (poster) { prompt = poster; converted = true; }
    } catch (e) {
      console.warn('[generate_image] 中文转换失败，回退原文:', e.message);
    }
  }
  if (!prompt) prompt = buildPrompt(rawPrompt, opts.options || {});
  if (!prompt) throw new Error('prompt 为空');

  const model = opts.model || 'gpt-image-2';
  const size  = opts.size  || '1024x1024';

  // 参数按模型区分：
  // - gpt-image-2 / gpt-image-1：quality = low|medium|high，默认返回 b64_json，可选 output_format
  // - dall-e-3：quality = standard|hd，默认返回 url
  const params = { model, prompt, size, n: 1 };
  const isGptImage = /^gpt-image/.test(model);
  if (isGptImage) {
    params.quality = mapQuality(opts.quality, 'gpt');     // medium 默认
    params.output_format = opts.output_format || 'png';
  } else {
    params.quality = mapQuality(opts.quality, 'dalle');   // standard 默认
  }

  let resp;
  try {
    resp = await getClient().images.generate(params);
  } catch (e) {
    const msg = e.message || '';
    // 参数不支持 → 最简参数重试
    if (/Unknown parameter|Unsupported parameter|invalid.*parameter/i.test(msg)) {
      console.warn('[generate_image] 参数降级重试:', msg);
      resp = await getClient().images.generate({ model, prompt, n: 1 });
    }
    // 模型不可用 → 逐级降级 gpt-image-2 → gpt-image-1 → dall-e-3
    else if (/model.*(not found|does not exist|not available)|invalid.*model|does not have access/i.test(msg)) {
      const chain = ['gpt-image-1', 'dall-e-3'].filter(m => m !== model);
      let ok = false;
      for (const fb of chain) {
        try {
          console.warn(`[generate_image] 模型 ${model} 不可用，降级到 ${fb}`);
          const fbParams = /^gpt-image/.test(fb)
            ? { model: fb, prompt, size, n: 1, quality: mapQuality(opts.quality, 'gpt') }
            : { model: fb, prompt, size, n: 1, quality: mapQuality(opts.quality, 'dalle') };
          resp = await getClient().images.generate(fbParams);
          ok = true;
          break;
        } catch (e2) { console.warn(`[generate_image] ${fb} 也失败:`, e2.message); }
      }
      if (!ok) throw e;
    } else {
      throw e;
    }
  }
  const item = resp.data && resp.data[0];
  if (!item) throw new Error('OpenAI 未返回图片数据');

  let buffer;
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');     // gpt-image-1 默认
  } else if (item.url) {
    const imgResp = await fetch(item.url);             // dall-e-3 默认返回 url
    buffer = Buffer.from(await imgResp.arrayBuffer());
  } else {
    throw new Error('OpenAI 返回中无 b64_json 也无 url');
  }

  return {
    buffer,
    prompt,
    converted,                                   // 是否经 Claude 转换
    revisedPrompt: item.revised_prompt || ''
  };
}

module.exports = { generateImage, buildPrompt };
