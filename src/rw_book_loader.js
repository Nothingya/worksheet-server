/**
 * src/rw_book_loader.js  (v3 — lazy loading)
 * Only stores file paths at startup. Reads PDF buffer on demand.
 * Prevents OOM crash when many large PDFs are in input/.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const INPUT_DIR  = path.join(process.cwd(), 'input');
const UNIT_RE    = /^Ch(\d{1,2})_/i;

const cache = {
  ready:    false,
  bookFile: null,
  units:    {},   // { 1: { title, filePath }, ... }  — NO buffer stored
};

function titleFromFilename(filename) {
  let name = path.basename(filename, '.pdf')
    .replace(/^Ch\d{1,2}_Reading_?/i, '')
    .replace(/_/g, ' ').trim();
  return name.length > 0
    ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
    : filename;
}

async function load() {
  cache.ready = false;
  cache.units  = {};

  if (!fs.existsSync(INPUT_DIR)) {
    console.warn('[rw_book_loader] input/ not found'); return;
  }

  const pdfs = fs.readdirSync(INPUT_DIR).filter(f =>
    f.toLowerCase().endsWith('.pdf') && UNIT_RE.test(f)
  );

  pdfs.forEach(file => {
    const m = file.match(UNIT_RE);
    if (!m) return;
    const num = parseInt(m[1], 10);
    const fp  = path.join(INPUT_DIR, file);
    const sz  = fs.statSync(fp).size;
    if (!cache.units[num] || sz > (cache.units[num]._sz||0)) {
      cache.units[num] = { title: titleFromFilename(file), filePath: fp, _sz: sz };
    }
  });

  const count = Object.keys(cache.units).length;
  if (count > 0) {
    cache.ready    = true;
    cache.bookFile = `${count} unit PDF${count>1?'s':''} (input/)`;
    console.log(`📚  RW loader: ${count} unit PDFs indexed (lazy-load mode)`);
  } else {
    console.warn('[rw_book_loader] No Ch##_Reading_*.pdf files found in input/');
  }
}

function getAvailableUnits() {
  return Object.keys(cache.units).map(Number).sort((a,b)=>a-b);
}

/** Reads PDF from disk on demand — not cached in RAM */
function getArticle(unitNum) {
  const u = cache.units[unitNum];
  if (!u) return null;
  try {
    const pdfBuffer = fs.readFileSync(u.filePath);
    return { title: u.title, pdfBuffer };
  } catch(e) {
    console.error(`[rw_book_loader] Cannot read unit ${unitNum}:`, e.message);
    return null;
  }
}

module.exports = { load, cache, getAvailableUnits, getArticle };
