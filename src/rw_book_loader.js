// src/rw_book_loader.js
// Loads the RW textbook PDF at startup, splits by PREPARING/UNDERSTANDING boundaries,
// caches articles by unit number for on-demand generation.

const fs        = require('fs');
const path      = require('path');
const pdfParse  = require('pdf-parse');
const PDFParser = require('pdf2json');
const { PDFDocument } = require('pdf-lib');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT      = path.join(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'input');

// Cache: { 1: { title, pdfBuffer }, 2: { title, pdfBuffer }, ... }
const cache = { articles: {}, bookFile: null, ready: false };

// ── Helpers (duplicated from server.js to be self-contained) ─────
async function extractPageTexts(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', (data) => {
      if (!data.Pages?.length) return reject(new Error('PDF 无文字'));
      resolve(data.Pages.map((page, i) => ({
        pageNum: i+1,
        text: (page.Texts||[]).map(t=>(t.R||[]).map(r=>{
          try{return decodeURIComponent(r.T);}catch{return r.T;}
        }).join('')).join(' ').replace(/\s+/g,' ').trim()
      })));
    });
    parser.on('pdfParser_dataError', e => reject(new Error(String(e.parserError||e))));
    parser.parseBuffer(buffer);
  });
}

function pageContains(text, kw) {
  const lo = text.toLowerCase();
  return lo.includes(kw) || lo.replace(/\s+/g,'').includes(kw.replace(/\s+/g,''));
}

function findBoundaries(pages) {
  const s=[], e=[];
  for (const p of pages) {
    if (pageContains(p.text,'preparing to read'))       s.push(p.pageNum);
    if (pageContains(p.text,'understanding the reading')) e.push(p.pageNum);
  }
  return { startPages:s, endPages:e };
}

function pairBoundaries(sp, ep) {
  return Array.from({length:Math.min(sp.length,ep.length)},(_,i)=>
    ({index:i+1, startPage:sp[i], endPage:ep[i]})).filter(p=>p.startPage<p.endPage);
}

async function slicePdf(buf, start, end) {
  const src = await PDFDocument.load(buf), tot = src.getPageCount();
  const s = Math.max(1,start), e = Math.min(tot,end);
  const doc = await PDFDocument.create();
  const cps = await doc.copyPages(src, Array.from({length:e-s+1},(_,i)=>s-1+i));
  cps.forEach(p => doc.addPage(p));
  return Buffer.from(await doc.save());
}

async function getTitles(pages, pairs, client) {
  const pm = Object.fromEntries(pages.map(p=>[p.pageNum,p.text]));
  const snippets = pairs.map((p,i)=>
    `--- Article ${i+1} (pages ${p.startPage}-${p.endPage}) ---\n`+
    [p.startPage,p.startPage+1,p.startPage+2].map(n=>pm[n]||'').join(' ').slice(0,800)
  ).join('\n\n');
  const r = await client.messages.create({
    model:'claude-haiku-4-5', max_tokens:400,
    messages:[{role:'user',content:`Extract each article title, one per line, numbered:\n\n${snippets}`}]
  });
  const raw = r.content.filter(b=>b.type==='text').map(b=>b.text).join('').trim();
  const lines = raw.split('\n').map(l=>l.replace(/^\d+[.)]\s*/,'').trim()).filter(Boolean);
  return pairs.map((_,i) => lines[i] || `Unit ${pairs[i].index}`);
}

// ── Find RW book PDF ─────────────────────────────────────────────
function findBookPDF() {
  const dirs = [ROOT, INPUT_DIR].filter(d => fs.existsSync(d));
  // Look for patterns: contains 'rw' and ('sb' or 'ocr' or 'book' or 'pathways')
  const patterns = [
    f => /rw/i.test(f) && /sb|ocr|book|pathways/i.test(f),
    f => /pathway/i.test(f) && /rw|reading/i.test(f) && /l4|level.?4/i.test(f),
    f => /rw/i.test(f) && f.endsWith('.pdf') && !/script|video/i.test(f),
  ];
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.pdf'));
      for (const pattern of patterns) {
        const found = files.find(f => pattern(f.toLowerCase()));
        if (found) return { filepath: path.join(dir, found), filename: found };
      }
    } catch(_) {}
  }
  return null;
}

// ── Main loader ──────────────────────────────────────────────────
async function load() {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const bookFile = findBookPDF();
  if (!bookFile) {
    console.log('  ℹ️   RW book PDF not found in root or input/');
    return;
  }

  process.stdout.write(`  📚  ${bookFile.filename} (RW book) ... `);
  try {
    const buf = fs.readFileSync(bookFile.filepath);
    const pages = await extractPageTexts(buf);
    const {startPages, endPages} = findBoundaries(pages);
    const pairs = pairBoundaries(startPages, endPages);

    if (!pairs.length) {
      console.log(`⚠️  No article boundaries found`);
      return;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const titles = await getTitles(pages, pairs, client);

    for (let i=0; i<pairs.length; i++) {
      const p = pairs[i];
      const pdfBuf = await slicePdf(buf, p.startPage, p.endPage);
      cache.articles[p.index] = { title: titles[i], pdfBuffer: pdfBuf };
    }

    cache.bookFile = bookFile.filename;
    cache.ready = true;
    console.log(`✅  ${pairs.length} units split and cached`);
  } catch(e) {
    console.log(`⚠️  ${e.message}`);
  }
}

function getArticle(unit) {
  return cache.articles[unit] || null;
}

function getAvailableUnits() {
  return Object.keys(cache.articles).map(Number).sort((a,b)=>a-b);
}

module.exports = { load, getArticle, getAvailableUnits, cache };
