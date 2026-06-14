/**
 * src/fix_pw3_template.js
 * PW3 → PW4 样式工具：把 PW3 文档的样式/排版改成 PW4 外观，内容位置不动。
 *
 * PW3 是 Word 手工编辑的文档（带自动编号、楷体东亚字体、autospacing），
 * 视觉上与 PW4（程序化生成）差异大。本工具做「样式注入」，不重排内容：
 *
 *   全局：页边距 1440→1080；行距 240→276(1.15)；东亚字体(楷体等)→Times New Roman；
 *         关闭 before/afterAutospacing
 *   配色：大标题→红 C00000 加粗；Part 标题(含数字+emoji / Part X)→蓝 1F4E79 加粗；
 *         Instructions 说明行→灰 595959 斜体
 *   通用：清 \xa0 不间断空格；标题文本规范化（保留 U3A/B）；文件名双下划线→单
 *
 * 内容文字、题目顺序、表格结构、Part 标题文字一律不动（符合"内容位置不动"）。
 */
'use strict';
const zlib = require('zlib');
const archiver = require('archiver');

const PW4_RED = 'C00000', PW4_BLUE = '1F4E79', PW4_GREY = '595959';

// ── ZIP 读写 ────────────────────────────────────────────────────
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
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const encode = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const paraText = p => decode((p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
  .map(t => t.replace(/<[^>]+>/g, '')).join(''));

// ── 类型识别（用文件名优先区分 Video/Listening）──────────────────
function detectType(allText, filename = '') {
  const fn = String(filename);
  if (/词汇笔记|Core Vocabulary/.test(allText) || /词汇笔记/.test(fn)) return 'vocab';
  if (/Reading[_ ]?Practice/i.test(fn) || /Mind Map/.test(allText)) return 'reading';
  if (/Video[_ ]?Practice/i.test(fn)) return 'video';
  if (/Listening[_ ]?Practice/i.test(fn)) return 'listening';
  if (allText.includes('Video Practice')) return 'video';
  if (allText.includes('Listening Practice')) return 'listening';
  return null;
}

// ── 给一个 run 设置/替换颜色（PW3 run 多已有 color，需替换）─────────
function setRunColor(runXml, color, { bold = false, italic = false } = {}) {
  if (/<w:color\b/.test(runXml)) {
    runXml = runXml.replace(/<w:color w:val="[0-9A-Fa-f]{6}"\s*\/>/, `<w:color w:val="${color}"/>`);
  } else if (/<w:rPr>/.test(runXml)) {
    runXml = runXml.replace(/<w:rPr>/, `<w:rPr><w:color w:val="${color}"/>`);
  } else {
    // run 无 rPr：插入一个
    runXml = runXml.replace(/^<w:r(\s[^>]*)?>/, m => m + `<w:rPr><w:color w:val="${color}"/></w:rPr>`);
  }
  if (bold && !/<w:b\/>/.test(runXml) && /<w:rPr>/.test(runXml))
    runXml = runXml.replace(/<w:rPr>/, '<w:rPr><w:b/><w:bCs/>');
  if (italic && !/<w:i\/>/.test(runXml) && /<w:rPr>/.test(runXml))
    runXml = runXml.replace(/<w:rPr>/, '<w:rPr><w:i/><w:iCs/>');
  return runXml;
}

/** 对段落内所有 run 应用颜色 */
function colorParaRuns(pXml, color, opts) {
  return pXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, r => setRunColor(r, color, opts));
}

// ── 标题规范化 ──────────────────────────────────────────────────
function titleFromName(name) {
  return name.replace(/\.docx$/i, '').replace(/__+/g, '_').replace(/_/g, ' ')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// ════════════════════════════════════════════════════════════════
// 样式注入主流程
// ════════════════════════════════════════════════════════════════
function restyleToPW4(xml, notes) {
  // ── A. 全局样式 ──
  // 页边距 1440 → 1080
  let pg = 0;
  xml = xml.replace(/<w:pgMar\b[^>]*>/g, m => {
    const n = m.replace(/(w:(?:top|right|bottom|left)=")1440"/g, (mm, p) => { pg++; return p + '1080"'; });
    return n;
  });
  if (pg) notes.push(`页边距→1080 ×${pg}`);

  // 行距 240 → 276（1.15）
  const lc = (xml.match(/w:line="240"/g) || []).length;
  xml = xml.replace(/w:line="240"/g, 'w:line="276"');
  if (lc) notes.push(`行距240→276 ×${lc}`);

  // 东亚字体 楷体/宋体/仿宋/黑体 → Times New Roman
  const fc = (xml.match(/w:eastAsia="(?:楷体|宋体|仿宋|黑体|微软雅黑|等线)"/g) || []).length;
  xml = xml.replace(/w:eastAsia="(?:楷体|宋体|仿宋|黑体|微软雅黑|等线)"/g, 'w:eastAsia="Times New Roman"');
  if (fc) notes.push(`东亚字体→TNR ×${fc}`);

  // 关闭 autospacing
  const ac = (xml.match(/Autospacing="1"/g) || []).length;
  xml = xml.replace(/Autospacing="1"/g, 'Autospacing="0"');
  if (ac) notes.push(`关autospacing ×${ac}`);

  // ── \xa0 清理 ──
  let nb = 0;
  xml = xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (m, a, b, c) => {
    if (b.includes('\u00a0')) { nb++; return a + b.replace(/\u00a0/g, ' ') + c; }
    return m;
  });
  if (nb) notes.push(`清理不间断空格 ×${nb}`);

  // ── B. 标题配色（遍历段落）──
  let firstTitle = false;
  let cTitle = 0, cPart = 0, cInstr = 0;
  const PART_RE = /^(Part\s*\d|\d+\.\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}])/u;
  xml = xml.replace(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g, p => {
    const t = paraText(p).replace(/\u00a0/g, ' ').trim();
    if (!t) return p;
    if (!firstTitle) {                       // 文档大标题 → 红加粗
      firstTitle = true; cTitle++;
      return colorParaRuns(p, PW4_RED, { bold: true });
    }
    if (PART_RE.test(t)) {                    // Part 标题 → 蓝加粗
      cPart++;
      return colorParaRuns(p, PW4_BLUE, { bold: true });
    }
    if (/^Instructions/i.test(t)) {           // 说明 → 灰斜体
      cInstr++;
      return colorParaRuns(p, PW4_GREY, { italic: true });
    }
    return p;
  });
  if (cTitle) notes.push('大标题→红');
  if (cPart) notes.push(`Part标题→蓝 ×${cPart}`);
  if (cInstr) notes.push(`说明→灰斜体 ×${cInstr}`);

  return xml;
}

// ════════════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════════════
function fixMojibakeName(name) {
  if (!name) return name;
  try {
    const u = Buffer.from(name, 'latin1').toString('utf8');
    if (!u.includes('\uFFFD') && /[\u0080-\u00ff]/.test(name)) return u;
  } catch (e) {}
  return name;
}

/**
 * @param {Buffer} buffer
 * @param {string} originalname
 * @returns {Promise<{buffer, type, newName, notes}>}
 */
async function fixPW3Doc(buffer, originalname) {
  originalname = fixMojibakeName(originalname);
  const entries = getAllZipEntries(buffer);
  const docEntry = entries.find(e => e.name === 'word/document.xml');
  if (!docEntry) throw new Error('word/document.xml not found');
  let xml = docEntry.data.toString('utf8');

  const allText = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map(t => t.replace(/<[^>]+>/g, '')).join('\n');
  const type = detectType(allText, originalname) || 'unknown';

  const notes = [];
  xml = restyleToPW4(xml, notes);

  const newName = originalname
    .replace(/__+/g, '_')
    .replace(/\.docx$/i, '_PW4样式.docx');

  const out = await packDocx(entries, xml);
  return { buffer: out, type, newName, notes };
}

module.exports = { fixPW3Doc, detectType };
