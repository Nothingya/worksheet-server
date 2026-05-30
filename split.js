#!/usr/bin/env node
// split.js — 用关键字精确定位每篇 Reading 的边界
//
// 开始页：包含 "PREPARING TO READ"       的页（含）
// 结束页：包含 "UNDERSTANDING THE READING" 的页（含）
// 两者都支持 OCR 间隔格式：P R E P A R I N G  T O  R E A D
//
// Claude 只负责从这段文字里提取文章标题（便宜）
//
// 用法：node split.js "./PW3E L4 RW SBOCR.pdf" ./input

require('dotenv').config();

const { PDFDocument } = require('pdf-lib');
const PDFParser       = require('pdf2json');
const Anthropic       = require('@anthropic-ai/sdk');
const fs              = require('fs');
const path            = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── 逐页提取文字 ─────────────────────────────────────────────────
function extractPageTexts(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', (data) => {
      if (!data.Pages || data.Pages.length === 0)
        return reject(new Error('PDF 无可提取文字。'));
      const pages = data.Pages.map((page, i) => ({
        pageNum: i + 1,
        text: (page.Texts || [])
          .map(t => (t.R || []).map(r => {
            try { return decodeURIComponent(r.T); } catch { return r.T; }
          }).join(''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      }));
      resolve(pages);
    });
    parser.on('pdfParser_dataError', err =>
      reject(new Error('pdf2json 失败：' + (err.parserError || err))));
    parser.parseBuffer(buffer);
  });
}

// ── 关键字匹配（支持正常 + OCR 间隔两种格式）────────────────────
function pageContains(pageText, keyword) {
  const lower      = pageText.toLowerCase();
  const compressed = lower.replace(/\s+/g, '');
  const kNormal    = keyword.toLowerCase();
  const kCompressed = kNormal.replace(/\s+/g, '');
  return lower.includes(kNormal) || compressed.includes(kCompressed);
}

// ── 扫描所有开始页和结束页 ────────────────────────────────────────
function findBoundaries(pages) {
  const startPages = [];
  const endPages   = [];

  for (const p of pages) {
    if (pageContains(p.text, 'preparing to read'))      startPages.push(p.pageNum);
    if (pageContains(p.text, 'understanding the reading')) endPages.push(p.pageNum);
  }

  console.log(`\n🔍  开始页 (PREPARING TO READ):         ${startPages.join(', ')}`);
  console.log(`🔍  结束页 (UNDERSTANDING THE READING):  ${endPages.join(', ')}`);

  return { startPages, endPages };
}

// ── 配对：start[i] → end[i] ──────────────────────────────────────
function pairBoundaries(startPages, endPages) {
  if (startPages.length !== endPages.length) {
    console.warn(`\n⚠️  开始页数量(${startPages.length}) ≠ 结束页数量(${endPages.length})`);
    console.warn('   将按顺序尽量配对，多余的忽略。');
  }
  const count = Math.min(startPages.length, endPages.length);
  const pairs = [];
  for (let i = 0; i < count; i++) {
    if (startPages[i] < endPages[i]) {
      pairs.push({ index: i + 1, startPage: startPages[i], endPage: endPages[i] });
    } else {
      console.warn(`    ⚠️  第${i+1}组页码异常（start=${startPages[i]} end=${endPages[i]}），跳过`);
    }
  }
  return pairs;
}

// ── 用 Claude 从每段文字里提取标题（每篇只发几页，很便宜）────────
async function extractTitles(pairs, pages) {
  const pageMap = Object.fromEntries(pages.map(p => [p.pageNum, p.text]));

  const results = [];
  for (const pair of pairs) {
    // 取开始页后的 3 页文字（标题通常在这里）
    const snippet = [pair.startPage, pair.startPage + 1, pair.startPage + 2]
      .map(n => pageMap[n] || '').join('\n').slice(0, 1200);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `What is the title of the reading article in this text? Reply with ONLY the title, nothing else.\n\n${snippet}`
      }]
    });

    const title = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    console.log(`    Ch${String(pair.index).padStart(2,'0')}  p${pair.startPage}–p${pair.endPage}  →  "${title}"`);
    results.push({ ...pair, chapter: pair.index, title });
  }
  return results;
}

// ── 切割并保存 ───────────────────────────────────────────────────
async function splitPdf(buffer, articles, outputDir) {
  const srcDoc     = await PDFDocument.load(buffer);
  const totalPages = srcDoc.getPageCount();
  console.log(`\n✂️   切割 PDF（共 ${totalPages} 页）...\n`);

  const saved = [];
  for (const article of articles) {
    const start = Math.max(1, article.startPage);
    const end   = Math.min(totalPages, article.endPage);
    if (start > end) { console.warn(`    ⚠️  跳过"${article.title}"（页码无效）`); continue; }

    const newDoc  = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    const copied  = await newDoc.copyPages(srcDoc, indices);
    copied.forEach(p => newDoc.addPage(p));

    const chStr   = String(article.chapter).padStart(2, '0');
    const title   = (article.title || `Chapter${chStr}`)
      .replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').slice(0, 50);
    const outPath = path.join(outputDir, `Ch${chStr}_Reading_${title}.pdf`);

    fs.writeFileSync(outPath, await newDoc.save());
    console.log(`    ✅  Ch${chStr}  "${article.title}"  p${start}–p${end}  (${end-start+1} 页)`);
    saved.push(outPath);
  }
  return saved;
}

// ── 主流程 ───────────────────────────────────────────────────────
async function main() {
  const args      = process.argv.slice(2);
  const inputPdf  = args[0];
  const outputDir = args[1] || './input';

  if (!inputPdf) {
    console.log('用法：node split.js <教材.pdf> [输出文件夹]');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌  未设置 API Key'); process.exit(1); }
  if (!fs.existsSync(inputPdf))        { console.error(`❌  找不到：${inputPdf}`); process.exit(1); }

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`\n📖  ${path.basename(inputPdf)}`);

  const buffer = fs.readFileSync(inputPdf);
  process.stdout.write('📄  逐页提取文字... ');
  const pages    = await extractPageTexts(buffer);
  const nonEmpty = pages.filter(p => p.text.length > 20);
  console.log(`完成（${pages.length} 页，有效 ${nonEmpty.length} 页）`);

  if (nonEmpty.length < 3) {
    console.error('❌  文字太少，可能是扫描件，请先 OCR');
    process.exit(1);
  }

  // Step 1: 固定关键字扫描
  const { startPages, endPages } = findBoundaries(pages);

  if (startPages.length === 0) {
    console.error('\n❌  未找到 "PREPARING TO READ" 页。');
    console.error('    请在 PDF 中确认是否有该标题（或 OCR 质量问题）。');
    process.exit(1);
  }
  if (endPages.length === 0) {
    console.error('\n❌  未找到 "UNDERSTANDING THE READING" 页。');
    process.exit(1);
  }

  // Step 2: 配对
  const pairs = pairBoundaries(startPages, endPages);
  console.log(`\n📋  配对到 ${pairs.length} 篇文章，提取标题中...\n`);

  // Step 3: 提取标题（Claude，每篇仅发3页文字）
  const articles = await extractTitles(pairs, pages);

  // Step 4: 切割
  const saved = await splitPdf(buffer, articles, outputDir);

  console.log('\n' + '─'.repeat(50));
  console.log(`🎉  ${saved.length} 个 Reading PDF → ${path.resolve(outputDir)}`);
  console.log('\n如还有 Video Script：');
  console.log('    node split_script.js "./script.pdf" ./input\n');
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
