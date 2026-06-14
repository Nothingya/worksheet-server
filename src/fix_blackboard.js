/**
 * src/fix_blackboard.js
 * PW4 Reading Blackboard（板书版）改造工具：
 *   1. 完整版大纲：把 Part 1 大纲里的挖空 (N) ____ 直接替换为答案（从答案键取），删除末尾答案键区
 *   2. 文档末尾追加 200 字中文文章内容总结（调 Claude API，依据大纲全部要点+答案生成）
 *
 * 单文件上传：旧板书 docx → 完整版板书 docx
 */
'use strict';
const zlib = require('zlib');
const archiver = require('archiver');

// ── ZIP 读写（与 fix_pw4_template.js 一致）──────────────────────
function getAllZipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Invalid ZIP: EOCD not found');
  const cdOff = buffer.readUInt32LE(eocd + 16), cdSz = buffer.readUInt32LE(eocd + 12);
  const entries = [];
  let pos = cdOff;
  while (pos < cdOff + cdSz) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const comp = buffer.readUInt16LE(pos + 10), csz = buffer.readUInt32LE(pos + 20);
    const fnl = buffer.readUInt16LE(pos + 28), el = buffer.readUInt16LE(pos + 30), cl = buffer.readUInt16LE(pos + 32);
    const lho = buffer.readUInt32LE(pos + 42), name = buffer.slice(pos + 46, pos + 46 + fnl).toString('utf8');
    if (!name.endsWith('/')) {
      const lf = buffer.readUInt16LE(lho + 26), le2 = buffer.readUInt16LE(lho + 28);
      const ds = lho + 30 + lf + le2, raw = buffer.slice(ds, ds + csz);
      try { entries.push({ name, data: comp === 0 ? raw : zlib.inflateRawSync(raw) }); }
      catch (e) { entries.push({ name, data: raw }); }
    }
    pos += 46 + fnl + el + cl;
  }
  return entries;
}
function packDocx(entries, newXml) {
  return new Promise((resolve, reject) => {
    const arc = archiver('zip', { zlib: { level: 6 } });
    const chunks = [];
    arc.on('data', d => chunks.push(d));
    arc.on('end', () => resolve(Buffer.concat(chunks)));
    arc.on('error', reject);
    for (const e of entries)
      arc.append(e.name === 'word/document.xml' ? Buffer.from(newXml, 'utf8') : e.data, { name: e.name });
    arc.finalize();
  });
}

// ── XML 工具 ────────────────────────────────────────────────────
const PARA_RE = /<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g;
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const encode = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function listParas(xml) {
  const out = [];
  let m;
  PARA_RE.lastIndex = 0;
  while ((m = PARA_RE.exec(xml)) !== null) {
    const pXml = m[0];
    const text = decode((pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, '')).join(''));
    out.push({ s: m.index, e: m.index + pXml.length, xml: pXml, text });
  }
  return out;
}
const findPara = (paras, pred, from = 0) => {
  for (let i = from; i < paras.length; i++) if (pred(paras[i].text)) return i;
  return -1;
};
function applyEdits(xml, edits) {
  edits.sort((a, b) => b.s - a.s);
  for (const ed of edits) xml = xml.slice(0, ed.s) + ed.repl + xml.slice(ed.e);
  return xml;
}
function runXml(text, { bold = false, italics = false, color = null, sz = 24, font = 'Times New Roman' } = {}) {
  let rPr = `<w:rPr><w:rFonts w:ascii="${font}" w:cs="${font}" w:eastAsia="${font}" w:hAnsi="${font}"/>`;
  if (bold) rPr += '<w:b/><w:bCs/>';
  if (italics) rPr += '<w:i/><w:iCs/>';
  if (color) rPr += `<w:color w:val="${color}"/>`;
  rPr += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${encode(text)}</w:t></w:r>`;
}
function para(runsXml, { before = 60, after = 60, line = 276, jc = null, ind = null } = {}) {
  let pPr = `<w:pPr><w:spacing w:after="${after}" w:before="${before}" w:line="${line}"/>`;
  if (jc) pPr += `<w:jc w:val="${jc}"/>`;
  if (ind) pPr += `<w:ind w:left="${ind}"/>`;
  pPr += '</w:pPr>';
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

const BLUE = '1F4E79', RED = 'C00000', GREY = '595959';

// ── 解析答案键 {N: answer} ──────────────────────────────────────
function parseAnswerKey(paras, akIdx) {
  const map = {};
  for (let i = akIdx + 1; i < paras.length; i++) {
    // 答案键行形如 "(1) Karel Capek          (2) 1920 ..."（多个配对一行）
    const re = /\((\d+)\)\s*([^()]+?)(?=\s*\(\d+\)|\s*$)/g;
    let m;
    while ((m = re.exec(paras[i].text)) !== null) {
      const n = +m[1], a = m[2].trim();
      if (a) map[n] = a;
    }
  }
  return map;
}

// ── 把挖空段 (N) ____ 替换为答案 ────────────────────────────────
function fillBlanksInPara(pXml, ansMap) {
  // 段内文本含 (N)，把后续的下划线 run 替换为答案 run
  const numMatch = decode((pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map(t => t.replace(/<[^>]+>/g, '')).join('')).match(/\((\d+)\)/);
  if (!numMatch) return { xml: pXml, filled: false };
  const n = +numMatch[1];
  const ans = ansMap[n];
  if (!ans) return { xml: pXml, filled: false };

  // 将各 <w:t> 文本拼接处理：去掉 "(N)" 与紧随的下划线串，替换为答案
  // 策略：把 "(N)" 之后到段末的下划线全部清空，并在 (N) 所在 run 后插入答案文本 run
  let replaced = false;
  let xml = pXml;
  // 1) 删除下划线串（可能独立成 run）
  xml = xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (m, a, b, c) => {
    const cleaned = b.replace(/_{3,}/g, '');
    return a + cleaned + c;
  });
  // 2) 把 "(N)  " 文本替换为答案（红色），去掉编号括号
  xml = xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (m, a, b, c) => {
    if (replaced) return m;
    if (b.includes(`(${n})`)) {
      replaced = true;
      // 保留 (N) 前的文本（如 before），去掉 "(N)"，留待答案 run 紧跟
      const kept = b.replace(new RegExp(`\\(${n}\\)\\s*`), '');
      return a + kept + c;
    }
    return m;
  });
  // 3) 在该 run 之后插入答案 run（红色加粗）
  if (replaced) {
    xml = xml.replace(/(<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>[^<]*<\/w:t><\/w:r>)/, (m) => {
      // 找到刚处理过、含 kept 文本的那个 run 不易精确；改用更稳健方式见下
      return m;
    });
  }
  return { xml, filled: replaced, answer: ans, num: n };
}

// 更稳健：重建挖空段为「• label before answer」单段
function rebuildBlankPara(pXml, ansMap) {
  const fullText = decode((pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map(t => t.replace(/<[^>]+>/g, '')).join(''));
  const numMatch = fullText.match(/\((\d+)\)/);
  if (!numMatch) return { xml: pXml, filled: false };
  const n = +numMatch[1];
  const ans = ansMap[n];
  if (!ans) return { xml: pXml, filled: false };

  // 拆出：bullet "•"、label（粗体，以 ":" 结尾）、before 文本（(N) 之前、label 之后）
  // fullText 形如 "•  Birth of the Word:  coined by Czech writer (1)  ____"
  let body = fullText.replace(/_{2,}/g, '').trim();        // 去下划线
  body = body.replace(/^•\s*/, '');                        // 去 bullet
  const labelM = body.match(/^(.*?:)\s*(.*)$/);
  let label = '', before = '';
  if (labelM) { label = labelM[1]; before = labelM[2]; }
  else { before = body; }
  before = before.replace(new RegExp(`\\(${n}\\)\\s*`), '').trim();  // 去 (N)

  // pPr 沿用原段（缩进/间距）
  const pPrM = pXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const open = '<w:p>' + (pPrM ? pPrM[0] : '');
  let runs = runXml('•  ');
  if (label) runs += runXml(label + '  ', { bold: true });
  if (before) runs += runXml(before + ' ');
  runs += runXml(ans, { bold: true, color: BLUE });  // 答案蓝色加粗，醒目但非"错误红"
  return { xml: open + runs + '</w:p>', filled: true, num: n, answer: ans };
}

// ── 主入口 ──────────────────────────────────────────────────────
function fixMojibakeName(name) {
  if (!name) return name;
  try {
    const u = Buffer.from(name, 'latin1').toString('utf8');
    if (!u.includes('\uFFFD') && /[\u0080-\u00ff]/.test(name)) return u;
  } catch (e) {}
  return name;
}

async function defaultSummaryGen({ articleText, outlineText, title }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('no API key');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let msg;
  if (articleText && articleText.trim().length > 200) {
    // 优先：基于原文全文生成总结（更准确）
    msg = [
      '下面是一篇英语阅读文章的原文。请写一段约 200 字的中文文章内容总结，',
      '概括文章主旨、结构与关键信息。',
      '要求：连贯的中文段落（非要点罗列），客观准确，约 200 字（180–220 字），',
      '只输出总结正文，无标题无前后缀。',
      '',
      `文章标题：${title}`,
      '',
      '文章原文：',
      String(articleText).slice(0, 8000)
    ].join('\n');
  } else {
    // 回退：基于板书大纲要点
    msg = [
      '下面是一份英语阅读课板书大纲的全部要点（已含答案）。',
      '请据此写一段约 200 字的中文文章内容总结，概括文章主旨、结构与关键信息。',
      '要求：连贯的中文段落（非要点罗列），客观准确，约 200 字（180–220 字），',
      '只输出总结正文，无标题无前后缀。',
      '',
      `板书标题：${title}`,
      '',
      '板书要点：',
      outlineText
    ].join('\n');
  }

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: msg }]
  });
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text || text.length < 50) throw new Error('summary too short');
  return text;
}

/**
 * @param {Buffer} buffer       板书 docx
 * @param {string} originalname 文件名
 * @param {object} [opts]       { articleText, summaryGen } — articleText 为按 Unit 匹配的原文
 */
async function fixBlackboardDoc(buffer, originalname, opts = {}) {
  originalname = fixMojibakeName(originalname);
  const entries = getAllZipEntries(buffer);
  const docEntry = entries.find(e => e.name === 'word/document.xml');
  if (!docEntry) throw new Error('word/document.xml not found');
  let xml = docEntry.data.toString('utf8');

  const notes = [];
  let paras = listParas(xml);

  // 识别：必须是板书（含 "Mind Map" 思维导图 + Answer Key）
  const allText = paras.map(p => p.text).join('\n');
  if (!/Mind Map|思维导图/.test(allText)) throw new Error('不是 PW4 板书文档（未找到 Mind Map）');

  // 1) 解析答案键
  const akIdx = findPara(paras, t => /Answer Key/i.test(t) || /答案/.test(t));
  let ansMap = {};
  if (akIdx !== -1) ansMap = parseAnswerKey(paras, akIdx);
  const ansCount = Object.keys(ansMap).length;

  // 2) 填充挖空段（Mind Map 区域到答案键之前）
  const titleText = paras.find(p => p.text.trim())?.text.trim() || originalname;
  const outlineLines = [];
  const edits = [];
  let filledN = 0;
  const endIdx = akIdx === -1 ? paras.length : akIdx;
  for (let i = 0; i < endIdx; i++) {
    const t = paras[i].text;
    if (/\(\d+\)/.test(t) && /_{2,}/.test(t)) {
      const r = rebuildBlankPara(paras[i].xml, ansMap);
      if (r.filled) {
        edits.push({ s: paras[i].s, e: paras[i].e, repl: r.xml });
        filledN++;
      }
    }
  }
  if (filledN) { xml = applyEdits(xml, edits); notes.push(`填充挖空 ×${filledN}（完整版）`); }

  // 3) 删除答案键区块（从 Answer Key 段到文档结尾的答案行）
  paras = listParas(xml);
  const akIdx2 = findPara(paras, t => /Answer Key/i.test(t) || /^答案/.test(t.trim()));
  if (akIdx2 !== -1) {
    // 删除 akIdx2 段及其后所有答案配对段
    let delEnd = paras.length;
    const s = paras[akIdx2].s;
    const e = paras[delEnd - 1].e;
    xml = xml.slice(0, s) + xml.slice(e);
    notes.push('删除答案键');
  }

  // 4) 收集大纲全部要点文本（用于 API 总结）；同时改写指令行为完整版提示
  paras = listParas(xml);
  const instrIdx = findPara(paras, t => /Complete the mind map|NO MORE THAN/i.test(t));
  if (instrIdx !== -1) {
    const newInstr = '<w:p>' +
      (paras[instrIdx].xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0] +
      runXml('完整版大纲（参考答案）', { italics: true, sz: 22, color: GREY }) +
      '</w:p>';
    xml = xml.slice(0, paras[instrIdx].s) + newInstr + xml.slice(paras[instrIdx].e);
    paras = listParas(xml);
  }
  for (const p of paras) {
    const t = p.text.trim();
    if (!t) continue;
    if (/Mind Map|思维导图|Complete the mind map|NO MORE THAN|完整版大纲/i.test(t)) continue;
    if (t === titleText) continue;
    outlineLines.push(t);
  }
  const outlineText = outlineLines.join('\n');

  // 5) 生成 200 字中文总结并追加到文档末尾
  const summaryGen = opts.summaryGen || defaultSummaryGen;
  const articleText = opts.articleText || '';
  let summary = '';
  try {
    summary = await summaryGen({ articleText, outlineText, title: titleText });
  } catch (e) {
    console.warn('[blackboard] summary API failed:', e.message);
    notes.push('⚠️ 总结生成失败（API 不可用），未追加');
  }
  if (summary) {
    const src = articleText && articleText.trim().length > 200 ? '基于原文' : '基于大纲';
    // 在最后一个表格/段落后插入：标题 + 总结段
    const sumXml =
      para(runXml('📖  文章内容总结', { bold: true, sz: 26, color: BLUE }), { before: 240, after: 100 }) +
      para(runXml(summary, { sz: 24 }), { before: 0, after: 80, line: 360 });
    // 插入到 </w:body> 之前最后一个 sectPr 之前
    const sectIdx = xml.lastIndexOf('<w:sectPr');
    if (sectIdx !== -1) {
      xml = xml.slice(0, sectIdx) + sumXml + xml.slice(sectIdx);
    } else {
      xml = xml.replace('</w:body>', sumXml + '</w:body>');
    }
    notes.push(`追加 200 字中文总结（${summary.length} 字，${src}）`);
  }

  const newName = originalname
    .replace(/U0(\d)/g, 'U$1')
    .replace(/\.docx$/i, '_完整版.docx');

  const out = await packDocx(entries, xml);
  return { buffer: out, newName, notes, ansCount };
}

module.exports = { fixBlackboardDoc };
