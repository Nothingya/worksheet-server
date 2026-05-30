// src/auto_loader.js — Auto-load specific PDFs at server startup
// Place these files in the worksheet-server/ root folder:
//   PW3E L4 RW videoscript.pdf         → RW video scripts (by unit)
//   PW3E L4 LS videoscript.pdf         → LS video scripts (by unit)
//   Pathways_LS3e_L4_LessonResources_VocabularyList_AllUnits.pdf  → LS word list

const fs       = require('fs');
const path     = require('path');
const pdfParse = require('pdf-parse');

const ROOT = path.join(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'input');


const FILES = {
  rwVideo:   'PW3E L4 RW videoscript.pdf',
  lsVideo:   'PW3E L4 LS videoscript.pdf',
  lsWords:   'Pathways_LS3e_L4_LessonResources_VocabularyList_AllUnits.pdf',
};

// ── Results cache (populated by init()) ─────────────────────────
const cache = {
  rwVideoScripts: {},   // { 1: "text...", 2: "text..." }
  lsVideoScripts: {},   // { 1: "text...", 2: "text..." }
  lsWordList:     {},   // { "1A": ["word1",...], "1B": [...], 1: [...], ... }
  loaded: [],           // list of successfully loaded file names
};

// ── PDF text extraction ──────────────────────────────────────────
async function getText(filepath) {
  const buf = fs.readFileSync(filepath);
  try {
    const d = await pdfParse(buf);
    if (d.text.trim().length > 200) return d.text;
  } catch(_) {}
  // Fallback: pdf2json
  const PDFParser = require('pdf2json');
  return new Promise((res, rej) => {
    const p = new PDFParser(null, 1);
    p.on('pdfParser_dataReady', () =>
      res((p.getRawTextContent() || '').replace(/---+Page[^-]+-+/g, '\n')));
    p.on('pdfParser_dataError', rej);
    p.parseBuffer(buf);
  });
}

// ── Video script parser (split by UNIT X:) ──────────────────────
function parseVideoScript(text) {
  const out = {};
  const rx = /\bUNIT\s*(\d+)\s*:/gi;
  const parts = []; let m;
  while ((m = rx.exec(text)) !== null) parts.push({ unit: parseInt(m[1]), idx: m.index });
  parts.forEach((p, i) => {
    const end = parts[i + 1]?.idx ?? text.length;
    const content = text.slice(p.idx, end).trim();
    if (content.length > 100) out[p.unit] = content;
  });
  return out;
}

// ── LS Word list parser ──────────────────────────────────────────
// Format: alphabetical list with columns  word  pos  definition  pageNumber
// Example: "automated*   adj   run by a machine rather than a human   12"
// Algorithm:
//   1. Parse each line: extract word + page number
//   2. Group words by page number
//   3. Sort unique pages; pair them: (p1,p2)=Unit1, (p3,p4)=Unit2, ...
//   4. Lower page of each pair = Lesson A, higher = Lesson B
function parseLSWordList(text) {
  const result = {};

  // Simple robust match: "word/phrase  ...anything...  pageNumber"
  // Works whether PDF uses 2 spaces, 3 spaces, or tabs between columns
  const wordLineRx = /^(.+?)\s{2,}.+\s(\d{1,3})\s*$/gm;

  const byPage = {};

  const addWord = (word, page) => {
    word = word.replace(/\*/g,'').trim().toLowerCase();
    if (word.length < 2 || word.split(' ').length > 5) return;
    if (/^\d/.test(word)) return;  // skip lines starting with numbers
    if (!byPage[page]) byPage[page] = [];
    if (!byPage[page].includes(word)) byPage[page].push(word);
  };

  let m;
  while ((m = wordLineRx.exec(text)) !== null) {
    const pg = parseInt(m[2]);
    if (pg > 0 && pg < 500) addWord(m[1], pg);
  }

  // Sort unique pages and pair them into units
  const pages = Object.keys(byPage).map(Number).sort((a,b)=>a-b);
  console.log(`    [LS wordlist] found words on pages: ${pages.join(', ')}`);

  // Pair consecutive pages: pair 0 = Unit 1, pair 1 = Unit 2, ...
  for (let i=0; i<pages.length; i+=2) {
    const unit = Math.floor(i/2) + 1;
    const pA = pages[i];       // lower page = A
    const pB = pages[i+1];     // higher page = B

    const wordsA = byPage[pA] || [];
    const wordsB = pB !== undefined ? (byPage[pB] || []) : [];

    result[`${unit}A`] = wordsA;
    result[`${unit}B`] = wordsB;
    result[unit]       = [...wordsA, ...wordsB];
    console.log(`    Unit ${unit}: A=${wordsA.length} words (p${pA}), B=${wordsB.length} words (p${pB||'?'})`);
  }

  return result;
}

// ── Main init ────────────────────────────────────────────────────
async function init() {
  for (const [key, filename] of Object.entries(FILES)) {
    // Check root dir first, then input/ folder
    let filepath = path.join(ROOT, filename);
    if (!fs.existsSync(filepath)) {
      filepath = path.join(INPUT_DIR, filename);
      if (!fs.existsSync(filepath)) continue;
    }

    process.stdout.write(`  📄  ${filename} ... `);
    try {
      const text = await getText(filepath);
      if (key === 'rwVideo') {
        cache.rwVideoScripts = parseVideoScript(text);
        console.log(`✅  ${Object.keys(cache.rwVideoScripts).length} RW video units`);
      } else if (key === 'lsVideo') {
        cache.lsVideoScripts = parseVideoScript(text);
        console.log(`✅  ${Object.keys(cache.lsVideoScripts).length} LS video units`);
      } else if (key === 'lsWords') {
        cache.lsWordList = parseLSWordList(text);
        const unitCount = Object.keys(cache.lsWordList).filter(k => !isNaN(k)).length;
        console.log(`✅  LS word list: ${unitCount} units`);
      }
      cache.loaded.push(filename);
    } catch(e) {
      console.log(`⚠️   ${e.message}`);
    }
  }
}

module.exports = { init, cache, FILES };
