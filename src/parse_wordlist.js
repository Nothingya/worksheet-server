// src/parse_wordlist.js — Parse Pathways vocabulary list PDF into unit→words map
const pdfParse  = require('pdf-parse');
const PDFParser = require('pdf2json');

/**
 * Parse word list PDF → { 1: ["accelerate","assembly",...], 2: [...], ... }
 */
async function parseWordList(buffer) {
  // Try pdf-parse first
  let text = '';
  try {
    const d = await pdfParse(buffer);
    if (d.text.length > 100) text = d.text;
  } catch(_) {}

  if (!text) {
    text = await new Promise((res, rej) => {
      const p = new PDFParser(null, 1);
      p.on('pdfParser_dataReady', () => res((p.getRawTextContent()||'')
        .replace(/---+Page[^-]+-+/g,'\n')));
      p.on('pdfParser_dataError', rej);
      p.parseBuffer(buffer);
    });
  }

  const unitMap = {};
  let currentUnit = null;

  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;

    // Detect unit header: "Unit 1" or "Unit 1 Page CEFR Level"
    const unitMatch = t.match(/^Unit\s+(\d+)/i);
    if (unitMatch) {
      currentUnit = parseInt(unitMatch[1]);
      if (!unitMap[currentUnit]) unitMap[currentUnit] = [];
      continue;
    }

    if (!currentUnit) continue;

    // Extract word from lines like "accelerate AW 4 C1" or "relate to 5 C1"
    // Skip header/footer lines
    if (/^(page|cefr|vocabulary|aw\s+these)/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue; // page numbers

    // Remove trailing: AW, page number, CEFR level
    const wordLine = t
      .replace(/\s+AW\s*$/, '')
      .replace(/\s+\d+\s+[-C][1-9]?\d?$/, '')
      .replace(/\s+\d+$/, '')
      .replace(/\s+[BC][12]$/, '')
      .trim();

    if (wordLine && wordLine.length > 1 && wordLine.length < 30 &&
        /^[a-zA-Z]/.test(wordLine)) {
      unitMap[currentUnit].push(wordLine);
    }
  }

  return unitMap;
}

module.exports = { parseWordList };
