/**
 * src/pw3_extract.js
 * 从 PW3 docx 提取结构化内容（供 pw3_regen.js 喂给 PW4 builder）。
 * 只提取「内容数据」，不关心 PW3 的样式。
 */
'use strict';
const zlib = require('zlib');

// ── ZIP 读取 document.xml ───────────────────────────────────────
function readDocumentXml(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Invalid ZIP');
  const cdOff = buffer.readUInt32LE(eocd + 16), cdSz = buffer.readUInt32LE(eocd + 12);
  let pos = cdOff;
  while (pos < cdOff + cdSz) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const comp = buffer.readUInt16LE(pos + 10), csz = buffer.readUInt32LE(pos + 20);
    const fnl = buffer.readUInt16LE(pos + 28), el = buffer.readUInt16LE(pos + 30), cl = buffer.readUInt16LE(pos + 32);
    const lho = buffer.readUInt32LE(pos + 42), name = buffer.slice(pos + 46, pos + 46 + fnl).toString('utf8');
    if (name === 'word/document.xml') {
      const lf = buffer.readUInt16LE(lho + 26), le2 = buffer.readUInt16LE(lho + 28);
      const ds = lho + 30 + lf + le2, raw = buffer.slice(ds, ds + csz);
      return (comp === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
    }
    pos += 46 + fnl + el + cl;
  }
  throw new Error('document.xml not found');
}

const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\u00a0/g, ' ');

/** 提取 body 顶层块序列（段落 / 表格），保持文档顺序 */
function parseBlocks(xml) {
  const bodyM = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
  const body = bodyM ? bodyM[1] : xml;
  const blocks = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl')) {
      blocks.push({ type: 'table', rows: parseTable(chunk) });
    } else {
      const text = decode((chunk.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, '')).join(''));
      const bold = /<w:b\/>/.test(chunk);
      blocks.push({ type: 'para', text, bold, xml: chunk });
    }
  }
  return blocks;
}

function parseTable(tblXml) {
  const rows = [];
  for (const tr of tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []) {
    const cells = [];
    for (const tc of tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []) {
      const txt = decode((tc.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, '')).join(''));
      cells.push(txt.trim());
    }
    rows.push(cells);
  }
  return rows;
}

/** 段落文本数组（便于行级扫描）；表格用占位 [[TABLE n]] 标记位置 */
function linesWithTables(blocks) {
  const lines = [];
  const tables = [];
  for (const b of blocks) {
    if (b.type === 'table') { tables.push(b.rows); lines.push({ text: `[[TABLE ${tables.length - 1}]]`, isTable: true, idx: tables.length - 1 }); }
    else lines.push({ text: b.text, bold: b.bold });
  }
  return { lines, tables };
}

/** 找第一个满足 pred 的行 index */
const findLine = (lines, pred, from = 0) => {
  for (let i = from; i < lines.length; i++) if (pred(lines[i].text, lines[i])) return i;
  return -1;
};

/** Part 区域 [start, end)；兼容 "Part 1:" / "Part 1." / "1. emoji标题"；Answer Key 也作边界 */
function partRegion(lines, partNum, from = 0) {
  const re = new RegExp(`^\\s*(?:Part\\s*${partNum}[.:]|${partNum}\\.\\s*[\\p{Emoji}])`, 'u');
  const si = findLine(lines, t => re.test(t), from);
  if (si === -1) return null;
  // 下一个 Part 或 Answer Key（取最近的）
  const nextRe = new RegExp(`^\\s*(?:Part\\s*${partNum + 1}[.:]|${partNum + 1}\\.\\s*[\\p{Emoji}])`, 'u');
  let ei = findLine(lines, t => nextRe.test(t), si + 1);
  const akI = findLine(lines, t => /Answer Key|答案/i.test(t), si + 1);
  if (akI !== -1 && (ei === -1 || akI < ei)) ei = akI;
  if (ei === -1) ei = lines.length;
  return [si, ei];
}

const cleanNum = s => String(s).replace(/^\s*\d+[.:]\s*/, '').trim();

module.exports = { readDocumentXml, parseBlocks, parseTable, linesWithTables, findLine, partRegion, cleanNum, decode };
