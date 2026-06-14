/**
 * src/fix_pw4_template.js
 * PW4 模板修复工具 — 提取旧 docx 内容，按新模板规则外科式重排（内容不变）。
 *
 * 支持文档类型（自动识别）：
 *   reading   — PW4 RW Reading Homework（7 Part）
 *   video     — PW4 RW Video Practice（4 Part）
 *   vocab     — PW4 RW/LS 词汇笔记（4 Part）
 *   listening — PW4 LS Listening Practice（4 Part）
 *
 * 新模板规则：
 *   通用     : 文件名/标题 U0X → UX
 *   reading  : 删 Name/Date；P3 T/F/NG 空缩短(10下划线)；P2→P3、P5→P6 取消分页；
 *              P7 去 [ ]，按 1–3 词分组用 / 分隔；P2 Q5 改托福 Prose Summary 六选三
 *              （Introductory Sentence 由 Claude API 生成，6 选项内容不变）
 *   video    : 补题号(P1:1–5, P2:6–10，含答案键)；P2 句前加答题空；Dictation 1.5 行距
 *   vocab    : Part 1 后分页；中文 12pt；P2/P4 题序重排去字母序（答案键同步）；
 *              P3 匹配若答案呈 A,B,C… 顺序则重排定义（答案键同步）
 *   listening: Dictation 1.5 行距
 */
'use strict';
const zlib = require('zlib');
const archiver = require('archiver');

// ════════════════════════════════════════════════════════════════
// ZIP 读写（与 fix_ielts_tasks.js 相同实现）
// ════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════
// XML 段落工具
// ════════════════════════════════════════════════════════════════
const PARA_RE = /<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g;
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const encode = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** 列出所有段落 {s,e,xml,text}（含表格单元格内段落） */
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

const paraHasPageBreak = p =>
  /<w:br [^>]*w:type="page"/.test(p.xml) || /<w:pageBreakBefore\s*\/>/.test(p.xml);

/** 找到第一个 text 满足 pred 的段落索引（从 from 开始） */
const findPara = (paras, pred, from = 0) => {
  for (let i = from; i < paras.length; i++) if (pred(paras[i].text)) return i;
  return -1;
};

/** 用一组 {s,e,repl} 编辑（自动按位置倒序应用，互不干扰） */
function applyEdits(xml, edits) {
  edits.sort((a, b) => b.s - a.s);
  for (const ed of edits) xml = xml.slice(0, ed.s) + ed.repl + xml.slice(ed.e);
  return xml;
}

/** 构造一个 TNR 文本 run */
function runXml(text, { bold = false, italics = false, color = null, sz = 24 } = {}) {
  let rPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman"/>';
  if (bold) rPr += '<w:b/><w:bCs/>';
  if (italics) rPr += '<w:i/><w:iCs/>';
  if (color) rPr += `<w:color w:val="${color}"/>`;
  rPr += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${encode(text)}</w:t></w:r>`;
}

/** 用段落自身 pPr + 新 runs 重建段落 */
function rebuildPara(origParaXml, runsXml) {
  const pPrM = origParaXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const openM = origParaXml.match(/^<w:p(?: [^>]*)?>/);
  return openM[0] + (pPrM ? pPrM[0] : '') + runsXml + '</w:p>';
}

const PAGE_BREAK_PARA = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** 段落首个 "N.  " 编号 run 重写为 newNum */
function renumberParaXml(pXml, newNum) {
  let done = false;
  return pXml.replace(/(<w:t[^>]*>)(\s*\d+\.\s*)(<\/w:t>)/, (m, a, b, c) => {
    if (done) return m;
    done = true;
    const trail = b.replace(/^\s*\d+\./, '');
    return a + newNum + '.' + trail + c;
  });
}

/** 在段落 pPr 之后插入 runs（无 pPr 则紧跟 <w:p> 开标签） */
function prependRuns(pXml, runsXml) {
  const pPrM = pXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  if (pPrM) {
    const at = pXml.indexOf(pPrM[0]) + pPrM[0].length;
    return pXml.slice(0, at) + runsXml + pXml.slice(at);
  }
  const openM = pXml.match(/^<w:p(?: [^>]*)?>/);
  return openM[0] + runsXml + pXml.slice(openM[0].length);
}

/** 区域内（start..end 字符偏移）所有行距 → 360（1.5 行距），兼容旧版 240/276 */
function setLineSpacing15(xml, s, e) {
  const region = xml.slice(s, e).replace(/w:line="\d+"/g, 'w:line="360"');
  return xml.slice(0, s) + region + xml.slice(e);
}

/** Fisher-Yates */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 生成 0..n-1 的乱序排列：无不动点（尽量），且非恒等/非逆序 */
function scrambledPermutation(n) {
  for (let t = 0; t < 60; t++) {
    const p = shuffle([...Array(n).keys()]);
    const identity = p.every((v, i) => v === i);
    const reversed = p.every((v, i) => v === n - 1 - i);
    const fixedPts = p.filter((v, i) => v === i).length;
    if (!identity && !reversed && fixedPts <= Math.floor(n / 5)) return p;
  }
  return shuffle([...Array(n).keys()]);
}

const isSorted = arr => arr.every((v, i) => i === 0 || String(arr[i - 1]).toLowerCase() <= String(v).toLowerCase());

// ════════════════════════════════════════════════════════════════
// 类型识别
// ════════════════════════════════════════════════════════════════
function detectType(allText) {
  if (allText.includes('Core Vocabulary')) return 'vocab';
  if (allText.includes('Video Practice')) return 'video';
  if (allText.includes('Listening Practice')) return 'listening';
  if (allText.includes('Mind Map') || allText.includes('Reading Practice')) return 'reading';
  return null;
}

// ════════════════════════════════════════════════════════════════
// 通用操作
// ════════════════════════════════════════════════════════════════

/** 删除包含 needle 的段落（最多 count 个） */
function removeParasContaining(xml, needle, count = 1) {
  let removed = 0;
  while (removed < count) {
    const paras = listParas(xml);
    const i = findPara(paras, t => t.includes(needle));
    if (i === -1) break;
    xml = xml.slice(0, paras[i].s) + xml.slice(paras[i].e);
    removed++;
  }
  return { xml, removed };
}

/** 删除紧邻 head 段落（含 headNeedle）之前的纯分页段落 */
function removePageBreakBeforeHead(xml, headNeedle) {
  const paras = listParas(xml);
  const hi = findPara(paras, t => t.includes(headNeedle));
  if (hi <= 0) return { xml, removed: false };
  const prev = paras[hi - 1];
  if (paraHasPageBreak(prev) && !prev.text.trim()) {
    return { xml: xml.slice(0, prev.s) + xml.slice(prev.e), removed: true };
  }
  // 也处理 head 自身的 pageBreakBefore 属性
  if (/<w:pageBreakBefore\s*\/>/.test(paras[hi].xml)) {
    const fixed = paras[hi].xml.replace(/<w:pageBreakBefore\s*\/>/, '');
    return { xml: xml.slice(0, paras[hi].s) + fixed + xml.slice(paras[hi].e), removed: true };
  }
  return { xml, removed: false };
}

/** 在 head 段落（含 headNeedle）之前插入分页（若其前面尚无分页） */
function insertPageBreakBeforeHead(xml, headNeedle) {
  const paras = listParas(xml);
  const hi = findPara(paras, t => t.includes(headNeedle));
  if (hi === -1) return { xml, inserted: false };
  if (hi > 0 && paraHasPageBreak(paras[hi - 1])) return { xml, inserted: false };
  if (/<w:pageBreakBefore\s*\/>/.test(paras[hi].xml)) return { xml, inserted: false };
  return { xml: xml.slice(0, paras[hi].s) + PAGE_BREAK_PARA + xml.slice(paras[hi].s), inserted: true };
}

/** 区域内 <w:t> 文本中的长下划线串缩短 */
function shortenBlanksInRegion(xml, startNeedle, endNeedle, minLen, newLen) {
  const paras = listParas(xml);
  const si = findPara(paras, t => t.includes(startNeedle));
  if (si === -1) return xml;
  const ei = findPara(paras, t => t.includes(endNeedle), si + 1);
  const s = paras[si].e, e = ei === -1 ? xml.length : paras[ei].s;
  const re = new RegExp('_{' + minLen + ',}', 'g');
  const region = xml.slice(s, e).replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g,
    (m, a, b, c) => a + b.replace(re, '_'.repeat(newLen)) + c);
  return xml.slice(0, s) + region + xml.slice(e);
}

/** 标题区 U0X → UX（仅作用于 w:t 文本） */
function fixUnitZero(xml) {
  return xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g,
    (m, a, b, c) => a + b.replace(/\bU0(\d)\b/g, 'U$1') + c);
}

/** 区域定位：返回 [开始段索引, 结束段索引)，end 为下一个 needle 段或文末 */
function regionIdx(paras, startNeedle, endNeedles, from = 0) {
  const si = findPara(paras, t => t.includes(startNeedle), from);
  if (si === -1) return null;
  let ei = paras.length;
  for (const n of endNeedles) {
    const k = findPara(paras, t => t.includes(n), si + 1);
    if (k !== -1 && k < ei) ei = k;
  }
  return [si, ei];
}

// ════════════════════════════════════════════════════════════════
// 中文 run 字号：sz 20 → 24（仅含 CJK 字符的 run）
// ════════════════════════════════════════════════════════════════
const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef（）]/;
function upsizeChineseRuns(xml) {
  let count = 0;
  xml = xml.replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, run => {
    if (!/<w:sz w:val="20"\/>/.test(run)) return run;
    const text = decode((run.match(/<w:t[^>]*>([^<]*)<\/w:t>/) || [, ''])[1]);
    if (!CJK_RE.test(text)) return run;
    count++;
    return run.replace(/<w:sz w:val="20"\/>/g, '<w:sz w:val="24"/>')
              .replace(/<w:szCs w:val="20"\/>/g, '<w:szCs w:val="24"/>');
  });
  return { xml, count };
}

// ════════════════════════════════════════════════════════════════
// 题序重排（vocab Part 2 / Part 4）：题目段落 + 答案键行同步置换
// ════════════════════════════════════════════════════════════════
function reorderNumberedBlock(xml, headNeedle, endNeedles, { occurrence = 1 } = {}) {
  const paras = listParas(xml);
  // 第 occurrence 次出现的 head（1=正文，2=答案键）
  let from = 0, si = -1;
  for (let k = 0; k < occurrence; k++) {
    si = findPara(paras, t => t.includes(headNeedle), from);
    if (si === -1) return { xml, perm: null };
    from = si + 1;
  }
  let ei = paras.length;
  for (const n of endNeedles) {
    const k = findPara(paras, t => t.includes(n), si + 1);
    if (k !== -1 && k < ei) ei = k;
  }
  const items = [];
  for (let i = si + 1; i < ei; i++) {
    if (/^\s*\d+\.\s/.test(paras[i].text)) items.push(i);
  }
  if (items.length < 3) return { xml, perm: null };
  const perm = scrambledPermutation(items.length);
  // 新顺序：位置 k 放原第 perm[k] 题，并重编号 k+1
  const edits = items.map((pi, k) => ({
    s: paras[pi].s, e: paras[pi].e,
    repl: renumberParaXml(paras[items[perm[k]]].xml, k + 1)
  }));
  return { xml: applyEdits(xml, edits), perm };
}

/** 用已有 perm 同步重排（用于答案键与正文一致） */
function reorderNumberedBlockWithPerm(xml, headNeedle, endNeedles, perm, { occurrence = 1 } = {}) {
  const paras = listParas(xml);
  let from = 0, si = -1;
  for (let k = 0; k < occurrence; k++) {
    si = findPara(paras, t => t.includes(headNeedle), from);
    if (si === -1) return xml;
    from = si + 1;
  }
  let ei = paras.length;
  for (const n of endNeedles) {
    const k = findPara(paras, t => t.includes(n), si + 1);
    if (k !== -1 && k < ei) ei = k;
  }
  const items = [];
  for (let i = si + 1; i < ei; i++) {
    if (/^\s*\d+\.\s/.test(paras[i].text)) items.push(i);
  }
  if (items.length !== perm.length) return xml;
  const edits = items.map((pi, k) => ({
    s: paras[pi].s, e: paras[pi].e,
    repl: renumberParaXml(paras[items[perm[k]]].xml, k + 1)
  }));
  return applyEdits(xml, edits);
}

// ════════════════════════════════════════════════════════════════
// 各类型修复
// ════════════════════════════════════════════════════════════════

// ── READING ──────────────────────────────────────────────────────
async function fixReading(xml, notes, proseGen) {
  // 1) 删 Name/Date
  let r = removeParasContaining(xml, 'Name: ___', 2);
  xml = r.xml;
  if (r.removed) notes.push(`删除 Name/Date ×${r.removed}`);

  // 2) Part 3 空缩短（18+ → 5，约原长 1/4）
  xml = shortenBlanksInRegion(xml, 'Part 3.', 'Part 4.', 8, 5);
  notes.push('P3 答题空缩短');

  // 3) 取消 P2→P3、P4→P5、P5→P6、P6→P7 分页
  let pb = removePageBreakBeforeHead(xml, 'Part 3.');
  xml = pb.xml; if (pb.removed) notes.push('删 P3 前分页');
  pb = removePageBreakBeforeHead(xml, 'Part 5.');
  xml = pb.xml; if (pb.removed) notes.push('删 P5 前分页');
  pb = removePageBreakBeforeHead(xml, 'Part 6.');
  xml = pb.xml; if (pb.removed) notes.push('删 P6 前分页');
  pb = removePageBreakBeforeHead(xml, 'Part 7.');
  xml = pb.xml; if (pb.removed) notes.push('删 P7 前分页');

  // 4) Part 7 重排：去 [ ]，按 1–3 词分组 / 分隔（从答案键取原句）
  xml = fixPart7(xml, notes);

  // 5) Q5 → Prose Summary（API 生成 Introductory Sentence）
  xml = await fixProseSummary(xml, notes, proseGen);

  return xml;
}

function fixPart7(xml, notes) {
  let paras = listParas(xml);
  // 答案键里的 Part 7 原句（第 2 次出现的 Part 7 标题之后）
  const keyReg = regionIdx(paras, 'Part 7', [], findPara(paras, t => t.includes('Part 7')) + 1);
  if (!keyReg) return xml;
  const answers = [];
  for (let i = keyReg[0] + 1; i < keyReg[1]; i++) {
    const m = paras[i].text.match(/^\s*(\d+)\.\s+(.+)$/);
    if (m) answers[+m[1]] = m[2].trim();
  }
  // 正文 Part 7 区域内的 chunk 段落（含 "[" 的编号行）
  const bodyReg = regionIdx(paras, 'Part 7.', ['Answer Key']);
  if (!bodyReg) return xml;
  const edits = [];
  let fixed = 0;
  for (let i = bodyReg[0] + 1; i < bodyReg[1]; i++) {
    const m = paras[i].text.match(/^\s*(\d+)\.\s/);
    if (!m || !paras[i].text.includes('[')) continue;
    const n = +m[1];
    const sentence = answers[n];
    if (!sentence) continue;
    // 按原句词序分组（1–3 词/组），随后打乱组顺序
    const words = sentence.split(/\s+/).filter(Boolean);
    const groups = [];
    let k = 0;
    while (k < words.length) {
      const take = Math.min(words.length - k, 1 + Math.floor(Math.random() * 3));
      groups.push(words.slice(k, k + take).join(' '));
      k += take;
    }
    let shuffled = shuffle(groups);
    if (groups.length > 2 && shuffled.join('|') === groups.join('|')) shuffled = shuffle(groups);
    const display = shuffled.join('  /  ');
    edits.push({
      s: paras[i].s, e: paras[i].e,
      repl: rebuildPara(paras[i].xml, runXml(n + '.  ', { bold: true }) + runXml(display))
    });
    fixed++;
  }
  if (fixed) {
    xml = applyEdits(xml, edits);
    notes.push(`P7 重排 ${fixed} 句（去[ ]，1–3词/组）`);
  }
  return xml;
}

async function fixProseSummary(xml, notes, proseGen) {
  const paras = listParas(xml);
  if (findPara(paras, t => t.includes('[Prose Summary]')) !== -1) return xml; // 已是新格式
  // 定位 Q5（Part 2 区域内以 "5." 开头且含 THREE / main idea 的段落）
  const p2 = regionIdx(paras, 'Part 2.', ['Part 3.']);
  if (!p2) return xml;
  let qi = -1;
  for (let i = p2[0] + 1; i < p2[1]; i++) {
    if (/^\s*5\.\s/.test(paras[i].text) && /THREE|main idea/i.test(paras[i].text)) { qi = i; break; }
  }
  if (qi === -1) return xml;
  // 后续连续选项段（A) … F)）
  const opts = [];
  let last = qi;
  for (let i = qi + 1; i < p2[1] && opts.length < 6; i++) {
    const m = paras[i].text.match(/^\s*([A-F])[).]\s*(.+)$/);
    if (!m) break;
    opts.push(m[2].trim());
    last = i;
  }
  if (opts.length < 4) return xml;

  // 抽取答案键 Q5 行的字母（保持不变）与文章上下文
  const allText = paras.map(p => p.text).join('\n');
  const titleM = allText.match(/^(.*?Reading Practice)/);
  const keyParas = listParas(xml);
  let ansLetters = '';
  const keyP2 = regionIdx(keyParas, 'Part 2', [],
    findPara(keyParas, t => t.includes('Answer Key')));
  if (keyP2) {
    for (let i = keyP2[0] + 1; i < keyP2[1]; i++) {
      const m = keyParas[i].text.match(/^\s*5\.\s*([A-F](?:\s*,\s*[A-F]){1,2})/);
      if (m) { ansLetters = m[1].replace(/\s+/g, ' '); break; }
    }
  }

  // Introductory Sentence（API；失败则回退）
  let intro = '';
  try {
    intro = await proseGen({
      title: titleM ? titleM[1] : '',
      options: opts,
      answer: ansLetters,
      context: allText.slice(0, 2500)
    });
  } catch (e) {
    console.warn('[pw4fix] prose intro API failed:', e.message);
  }
  if (!intro) {
    intro = 'This passage examines the topic in depth, tracing its background, key developments, and implications.';
    notes.push('⚠️ Prose intro 使用回退句（API 不可用）');
  }

  // 构建新块
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  let block = rebuildPara(paras[qi].xml,
    runXml('5.  ', { bold: true }) +
    runXml('[Prose Summary]  ', { bold: true, color: '1F4E79' }) +
    runXml('Directions: Complete the summary by selecting THREE answer choices that express the most important ideas in the passage.', { italics: true }));
  const optTemplate = paras[qi + 1].xml; // 借用选项段的 pPr 样式
  block += rebuildPara(optTemplate,
    runXml('Introductory Sentence: ', { bold: true }) + runXml(intro, { italics: true }));
  opts.forEach((o, i) => {
    block += rebuildPara(optTemplate, runXml('     ' + letters[i] + '.  ' + o));
  });
  block += rebuildPara(optTemplate,
    runXml('Your Choice:  ', { bold: true }) + runXml('[      ]    [      ]    [      ]'));

  xml = xml.slice(0, paras[qi].s) + block + xml.slice(paras[last].e);
  notes.push('Q5 → Prose Summary 六选三' + (ansLetters ? `（答案 ${ansLetters} 不变）` : ''));
  return xml;
}

// ── VIDEO ────────────────────────────────────────────────────────
function fixVideo(xml, notes) {
  let paras = listParas(xml);

  // P1 题号 1–5（题干为粗体且非选项/说明）
  const p1 = regionIdx(paras, 'Part 1.', ['Part 2.']);
  if (p1) {
    const edits = [];
    let n = 0;
    for (let i = p1[0] + 1; i < p1[1]; i++) {
      const t = paras[i].text;
      if (!t.trim() || /^Instructions/i.test(t.trim())) continue;
      if (/^\s*[A-D][.)]\s/.test(t)) continue;            // 选项行
      if (/^\s*\d+\.\s/.test(t)) { n++; continue; }       // 已有题号
      if (!/<w:b\/>/.test(paras[i].xml)) continue;        // 题干必为粗体
      n++;
      edits.push({ s: paras[i].s, e: paras[i].e,
        repl: prependRuns(paras[i].xml, runXml(n + '.  ', { bold: true })) });
    }
    if (edits.length) { xml = applyEdits(xml, edits); notes.push(`P1 补题号 ×${edits.length}`); }
  }

  // P2 题号 6–10 + 答题空
  paras = listParas(xml);
  const p2 = regionIdx(paras, 'Part 2.', ['Part 3.']);
  if (p2) {
    const edits = [];
    let n = 5;
    for (let i = p2[0] + 1; i < p2[1]; i++) {
      const t = paras[i].text;
      if (!t.trim() || /^Instructions/i.test(t.trim())) continue;
      if (/^\s*\d+\.\s/.test(t) && t.includes('___')) { n++; continue; } // 已修复
      n++;
      edits.push({ s: paras[i].s, e: paras[i].e,
        repl: prependRuns(paras[i].xml,
          runXml(n + '.  ', { bold: true }) + runXml('__________  ')) });
    }
    if (edits.length) { xml = applyEdits(xml, edits); notes.push(`P2 补题号+答题空 ×${edits.length}`); }
  }

  // 答案键 P1–P4 行补题号（旧文件 P3/P4 答案为无题号纯列表）
  paras = listParas(xml);
  const akStart = findPara(paras, t => t.includes('Answer Key'));
  if (akStart !== -1) {
    const k1 = regionIdx(paras, 'Part 1', ['Part 2'], akStart);
    const k2 = regionIdx(paras, 'Part 2', ['Part 3'], akStart);
    const k3 = regionIdx(paras, 'Part 3', ['Part 4'], akStart);
    const k4 = regionIdx(paras, 'Part 4', [], akStart);
    const edits = [];
    // 统计区域内有效答案行数（用于推算下一部分起始号）
    const countLines = (reg) => {
      if (!reg) return 0;
      let c = 0;
      for (let i = reg[0] + 1; i < reg[1]; i++) if (paras[i].text.trim()) c++;
      return c;
    };
    const numberKeyLines = (reg, startNum) => {
      if (!reg) return 0;
      let n = startNum, c = 0;
      for (let i = reg[0] + 1; i < reg[1]; i++) {
        const t = paras[i].text;
        if (!t.trim()) continue;
        if (/^\s*\d+\.\s/.test(t)) { n++; continue; }
        edits.push({ s: paras[i].s, e: paras[i].e,
          repl: prependRuns(paras[i].xml, runXml(n + '.  ', { bold: true })) });
        n++; c++;
      }
      return c;
    };
    // 各部分起始号：P1=1，其余接续前一部分（按实际行数累加）
    const start1 = 1;
    const start2 = start1 + (countLines(k1) || 5);
    const start3 = start2 + (countLines(k2) || 5);
    const start4 = start3 + (countLines(k3) || 8);
    const c1 = numberKeyLines(k1, start1);
    const c2 = numberKeyLines(k2, start2);
    const c3 = numberKeyLines(k3, start3);
    const c4 = numberKeyLines(k4, start4);
    if (edits.length) { xml = applyEdits(xml, edits); notes.push(`答案键补题号 ×${c1 + c2 + c3 + c4}`); }
  }

  // Dictation 1.5 行距（P4 说明行之后到答案键）
  xml = dictation15(xml, 'Part 4.', notes);
  return xml;
}

// ── 听写区域 1.5 行距（video / listening 共用） ───────────────────
function dictation15(xml, headNeedle, notes) {
  const paras = listParas(xml);
  const reg = regionIdx(paras, headNeedle, ['Answer Key']);
  if (!reg) return xml;
  // 跳过标题与 Instructions 行
  let startIdx = reg[0] + 1;
  if (startIdx < reg[1] && /^Instructions/i.test(paras[startIdx].text.trim())) startIdx++;
  if (startIdx >= reg[1]) return xml;
  const s = paras[startIdx].s, e = paras[reg[1] - 1].e;
  xml = setLineSpacing15(xml, s, e);
  notes.push('Dictation 1.5 行距');
  return xml;
}

// ── VOCAB ────────────────────────────────────────────────────────
function fixVocab(xml, notes) {
  // 1) Part 1 后分页
  const ins = insertPageBreakBeforeHead(xml, 'Part 2.  Word Formation');
  xml = ins.xml;
  if (ins.inserted) notes.push('P1 后插入分页');

  // 2) 中文 12pt
  const up = upsizeChineseRuns(xml);
  xml = up.xml;
  if (up.count) notes.push(`中文字号 10→12pt ×${up.count}`);

  // 3) P2 题序重排（正文 + 答案键同 perm）
  let r2 = reorderNumberedBlock(xml, 'Part 2.  Word Formation', ['Part 3.'], { occurrence: 1 });
  if (r2.perm) {
    xml = reorderNumberedBlockWithPerm(r2.xml, 'Part 2.  Word Formation', ['Part 3.'], r2.perm, { occurrence: 2 });
    notes.push('P2 题序重排');
  }

  // 4) P4 题序重排（正文 + 答案键同 perm）
  let r4 = reorderNumberedBlock(xml, 'Part 4.  Vocabulary Quiz', ['Answer Key'], { occurrence: 1 });
  if (r4.perm) {
    xml = reorderNumberedBlockWithPerm(r4.xml, 'Part 4.  Vocabulary Quiz', [], r4.perm, { occurrence: 2 });
    notes.push('P4 题序重排');
  }

  // 5) P3 匹配：答案若呈 A,B,C… 顺序 → 重排定义文本
  xml = fixVocabMatching(xml, notes);
  return xml;
}

function fixVocabMatching(xml, notes) {
  const paras = listParas(xml);
  const akStart = findPara(paras, t => t.includes('Answer Key'));
  if (akStart === -1) return xml;
  const keyReg = regionIdx(paras, 'Part 3.', ['Part 4.'], akStart);
  if (!keyReg) return xml;
  const keyLines = []; // {idx, num, letter}
  for (let i = keyReg[0] + 1; i < keyReg[1]; i++) {
    const m = paras[i].text.match(/^\s*(\d+)\.\s*([A-J])\s*$/);
    if (m) keyLines.push({ idx: i, num: +m[1], letter: m[2] });
  }
  if (keyLines.length < 5) return xml;
  // 顺序检测：≥80% 行 letter 与序号位置一致（1→A, 2→B…）
  const seqCount = keyLines.filter(k => k.letter.charCodeAt(0) - 65 === k.num - 1).length;
  if (seqCount / keyLines.length < 0.8) return xml;

  const n = keyLines.length;
  // 定义列段落：表格内 "L.  definition"（A–J）
  const defParas = [];
  for (let i = 0; i < paras.length && defParas.length < n; i++) {
    if (i >= (akStart)) break;
    const m = paras[i].text.match(/^\s*([A-J])\.\s\s(.+)$/);
    if (m && paras[i].xml.includes('<w:t')) defParas.push({ idx: i, letter: m[1], def: m[2] });
  }
  if (defParas.length !== n) return xml;

  const perm = scrambledPermutation(n); // 位置 k 显示原定义 perm[k]
  const edits = defParas.map((dp, k) => {
    const src = defParas[perm[k]];
    // 字母保持原位，仅替换定义文本（重建段落：字母 run + 定义 run）
    return { s: paras[dp.idx].s, e: paras[dp.idx].e,
      repl: rebuildPara(paras[dp.idx].xml,
        runXml(dp.letter + '.  ') + runXml(src.def)) };
  });
  // 新答案：词 i 原定义在位置 perm.indexOf(i)，其显示字母 = defParas[该位置].letter
  keyLines.forEach(k => {
    const oldDefPos = k.letter.charCodeAt(0) - 65; // 原定义位置 = 原字母
    const newPos = perm.indexOf(oldDefPos);
    const newLetter = defParas[newPos].letter;
    edits.push({ s: paras[k.idx].s, e: paras[k.idx].e,
      repl: renumberParaXml(paras[k.idx].xml, k.num)
        .replace(/(<w:t[^>]*>)\s*[A-J]\s*(<\/w:t>)/, `$1${newLetter}$2`) });
  });
  xml = applyEdits(xml, edits);
  notes.push('P3 匹配答案去顺序化');
  return xml;
}

// ── LISTENING ────────────────────────────────────────────────────
function fixListening(xml, notes) {
  return dictation15(xml, 'Part 4', notes);
}

// ════════════════════════════════════════════════════════════════
// Prose Summary Intro 生成（Claude API）
// ════════════════════════════════════════════════════════════════
async function defaultProseGen({ title, options, answer, context }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('no API key');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = [
    'You are writing the Introductory Sentence for a TOEFL-style Prose Summary question.',
    'The introductory sentence states the overarching main idea of the passage in ONE sentence (15-25 words).',
    'It must NOT duplicate any answer option; it frames them.',
    '',
    `Worksheet title: ${title}`,
    `The six answer options (students pick three): ${options.map((o, i) => String.fromCharCode(65 + i) + '. ' + o).join(' | ')}`,
    answer ? `Correct options: ${answer}` : '',
    '',
    'Context (worksheet excerpt):',
    context,
    '',
    'Return ONLY the introductory sentence, no quotes, no preamble.'
  ].join('\n');
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    messages: [{ role: 'user', content: msg }]
  });
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text || text.length < 15) throw new Error('empty intro');
  return text.replace(/^["“]|["”]$/g, '');
}

// ════════════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════════════
/**
 * 修正 multer 按 latin1 解析的 multipart 文件名。
 * multer 默认把 UTF-8 文件名字节当 latin1 读，导致中文乱码（词汇笔记 → è¯æ±ç¬è®°）。
 * 把字符串按 latin1 还原成字节再以 UTF-8 解码即可恢复；对纯 ASCII 名幂等无害。
 */
function fixMojibakeName(name) {
  if (!name) return name;
  try {
    const bytes = Buffer.from(name, 'latin1');
    const utf8 = bytes.toString('utf8');
    // 仅当还原后不含 U+FFFD（解码失败标记），且原名含高位字节时才采用
    if (!utf8.includes('\uFFFD') && /[\u0080-\u00ff]/.test(name)) return utf8;
  } catch (e) { /* ignore */ }
  return name;
}

/**
 * 用标准标题替换文档第一个非空标题段落的文本（保留原样式 run）。
 * 标题取自文件名主体（去 .docx / _新模板 后缀，U0X→UX）。
 */
function setDocTitle(xml, title) {
  const paras = listParas(xml);
  const ti = findPara(paras, t => t.trim().length > 0);
  if (ti === -1) return { xml, changed: false, old: '' };
  const oldText = paras[ti].text.trim();
  if (oldText === title) return { xml, changed: false, old: oldText };
  // 保留段落首个 run 的样式，替换其文本；删除该段其余 run（标题应为单行）
  const pXml = paras[ti].xml;
  const firstRun = pXml.match(/<w:r\b[\s\S]*?<\/w:r>/);
  if (!firstRun) return { xml, changed: false, old: oldText };
  const rPr = (firstRun[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${encode(title)}</w:t></w:r>`;
  const rebuilt = rebuildPara(pXml, newRun);
  return { xml: xml.slice(0, paras[ti].s) + rebuilt + xml.slice(paras[ti].e), changed: true, old: oldText };
}

/** 从文件名推导标准标题：PW4 RW U1 词汇笔记 */
function titleFromName(name) {
  return name
    .replace(/\.docx$/i, '')
    .replace(/_新模板$/, '')
    .replace(/_FIXED_[^.]*$/i, '')
    .replace(/U0(\d)/g, 'U$1')
    .replace(/_/g, ' ')
    .trim();
}

/**
 * @param {Buffer} buffer       原 docx
 * @param {string} originalname 原文件名
 * @param {object} [opts]       { proseGen } 可注入测试桩
 * @returns {Promise<{buffer, type, newName, notes}>}
 */
async function fixPW4Doc(buffer, originalname, opts = {}) {
  originalname = fixMojibakeName(originalname);
  const entries = getAllZipEntries(buffer);
  const docEntry = entries.find(e => e.name === 'word/document.xml');
  if (!docEntry) throw new Error('word/document.xml not found');
  let xml = docEntry.data.toString('utf8');

  const allText = listParas(xml).map(p => p.text).join('\n');
  const type = detectType(allText);
  if (!type) throw new Error('无法识别文档类型（reading/video/vocab/listening）');

  const notes = [];
  const proseGen = opts.proseGen || defaultProseGen;

  if (type === 'reading')        xml = await fixReading(xml, notes, proseGen);
  else if (type === 'video')     xml = fixVideo(xml, notes);
  else if (type === 'vocab')     xml = fixVocab(xml, notes);
  else if (type === 'listening') xml = fixListening(xml, notes);

  // 通用：标题 U0X → UX
  xml = fixUnitZero(xml);

  // 通用：文档内标题统一为文件名主体（如 PW4 RW U1 词汇笔记）
  const stdTitle = titleFromName(originalname);
  const tr = setDocTitle(xml, stdTitle);
  xml = tr.xml;
  if (tr.changed) notes.push(`文档标题 → ${stdTitle}`);

  const newName = originalname
    .replace(/U0(\d)/g, 'U$1')
    .replace(/\.docx$/i, '_新模板.docx');

  const out = await packDocx(entries, xml);
  return { buffer: out, type, newName, notes };
}

module.exports = { fixPW4Doc, detectType };
