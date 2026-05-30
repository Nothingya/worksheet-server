#!/usr/bin/env node
// split_script.js — 将 Video Script PDF 按 "Unit X Video X" 拆成独立 .txt 文件
//
// Script PDF 格式示例：
//   Unit 1 Video 1 Page 3
//   [script text...]
//   Unit 1 Video 2 Page 5
//   [script text...]
//
// 用法：node split_script.js "./script.pdf" ./input

require('dotenv').config();

const PDFParser = require('pdf2json');
const pdfParse  = require('pdf-parse');
const fs        = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const path      = require('path');

// ── 提取 script PDF 全部文字 ─────────────────────────────────────
async function extractAllText(buffer) {
  // 先试 pdf-parse（快）
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 200) return data.text;
  } catch (_) {}

  // 再试 pdf2json
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', () => {
      const raw = parser.getRawTextContent() || '';
      const text = raw
        .replace(/----------------Page \(\d+\) Break----------------/g, '\n')
        .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
      resolve(text);
    });
    parser.on('pdfParser_dataError', err =>
      reject(new Error('pdf2json 失败：' + (err.parserError || err))));
    parser.parseBuffer(buffer);
  });
}

// ── 按 "UNIT X:" 标记拆分（一个 Unit = 一个 Video Script）─────
function splitByMarkers(text) {
  // 匹配：UNIT 1: xxx / Unit 1: xxx / UNIT1: xxx
  const markerRegex = /(?:^|\n)(UNIT\s*(\d+)\s*:[^\n]*)/gi;

  const sections = [];
  let match;
  let lastIndex = 0;
  let lastMarker = null;

  while ((match = markerRegex.exec(text)) !== null) {
    if (lastMarker !== null) {
      const content = text.slice(lastIndex, match.index).trim();
      if (content.length > 50) sections.push({ ...lastMarker, content });
    }
    lastMarker = {
      unit:   parseInt(match[2]),
      video:  1,
      marker: match[1].trim()
    };
    lastIndex = match.index + match[0].length;
  }

  // 最后一段
  if (lastMarker) {
    const content = text.slice(lastIndex).trim();
    if (content.length > 50) sections.push({ ...lastMarker, content });
  }

  return sections;
}

// ── 主流程 ───────────────────────────────────────────────────────
async function main() {
  const args      = process.argv.slice(2);
  const inputPdf  = args[0];
  const outputDir = args[1] || './input';

  if (!inputPdf) {
    console.log('用法：node split_script.js <script.pdf> [输出文件夹]');
    console.log('示例：node split_script.js "./PW3E_Script.pdf" ./input');
    process.exit(1);
  }
  if (!fs.existsSync(inputPdf)) { console.error(`❌  找不到：${inputPdf}`); process.exit(1); }

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`\n📜  Script PDF：${path.basename(inputPdf)}`);

  const buffer = fs.readFileSync(inputPdf);
  process.stdout.write('📄  提取文字... ');
  const text = await extractAllText(buffer);
  console.log(`完成（${text.length} 字符）`);

  if (text.length < 100) {
    console.error('❌  提取文字太少，请确认 script PDF 是否为 OCR 版本。');
    process.exit(1);
  }

  console.log('\n✂️   按 Unit/Video 标记拆分...\n');
  const sections = splitByMarkers(text);

  if (sections.length === 0) {
    console.error('❌  未找到 "Unit X Video X" 格式的标记。');
    console.error('    请确认 script PDF 中有类似 "Unit 1 Video 1" 的标记。');
    console.log('\n--- 文字预览（前500字）---');
    console.log(text.slice(0, 500));
    process.exit(1);
  }

  const saved = [];
  for (const sec of sections) {
    const unitStr  = String(sec.unit).padStart(2, '0');
    const videoStr = String(sec.video).padStart(2, '0');
    const filename = `Ch${unitStr}_VideoReading_Unit${sec.unit}_Video${sec.video}.pdf`;
    const outPath  = path.join(outputDir, filename);

    // Create simple text PDF
    const pdfDoc  = await PDFDocument.create();
    const font    = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fullText = `${sec.marker}\n\n${sec.content}`;
    const lines = [];
    fullText.split('\n').forEach(line => {
      // Word-wrap at ~90 chars
      while (line.length > 90) {
        lines.push(line.slice(0, 90)); line = line.slice(90);
      }
      lines.push(line);
    });
    const linesPerPage = 48;
    for (let i = 0; i < lines.length; i += linesPerPage) {
      const page = pdfDoc.addPage([595, 842]);
      lines.slice(i, i + linesPerPage).forEach((l, j) => {
        page.drawText(l, { x:50, y:800 - j*16, size:11, font, color:rgb(0,0,0) });
      });
    }
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outPath, pdfBytes);

    console.log(`    ✅  Unit ${sec.unit} Video ${sec.video}  →  ${filename}  (${sec.content.length} chars)`);
    saved.push(outPath);
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`🎉  ${saved.length} 个 VideoReading PDF → ${path.resolve(outputDir)}`);
  console.log('\n下一步生成全部作业：');
  console.log(`    node cli.js ${outputDir} ./output\n`);
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
