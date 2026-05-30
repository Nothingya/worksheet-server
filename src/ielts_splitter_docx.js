/**
 * src/ielts_splitter_docx.js  (v2 — pure Node.js, no system unzip)
 * Uses zlib (built-in) to read docx ZIP without any external command.
 */
'use strict';
const zlib = require('zlib');

// ── Minimal ZIP reader ────────────────────────────────────────────────────────
function extractFromZip(buffer, targetFile) {
  let offset = 0;
  while (offset < buffer.length - 30) {
    // Local file header signature: PK\x03\x04
    if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }
    const compression   = buffer.readUInt16LE(offset + 8);
    const compressedSz  = buffer.readUInt32LE(offset + 18);
    const fileNameLen   = buffer.readUInt16LE(offset + 26);
    const extraLen      = buffer.readUInt16LE(offset + 28);
    const entryName     = buffer.slice(offset + 30, offset + 30 + fileNameLen).toString('utf8');
    const dataStart     = offset + 30 + fileNameLen + extraLen;

    if (entryName === targetFile) {
      const raw = buffer.slice(dataStart, dataStart + compressedSz);
      if (compression === 0) return raw;                    // stored
      if (compression === 8) return zlib.inflateRawSync(raw); // deflated
      throw new Error(`Unsupported ZIP compression method: ${compression}`);
    }
    offset = dataStart + compressedSz;
  }
  throw new Error(`${targetFile} not found in docx ZIP`);
}

// ── XML paragraph extractor ───────────────────────────────────────────────────
function extractParagraphsFromDocx(docxBuffer) {
  const xmlBuf = extractFromZip(docxBuffer, 'word/document.xml');
  return parseDocumentXml(xmlBuf.toString('utf8'));
}

function parseDocumentXml(xml) {
  const paras = [];
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const textRe  = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let pm;
  while ((pm = paraRe.exec(xml)) !== null) {
    const paraXml = pm[0];
    const texts = [];
    let tm;
    const tr = new RegExp(textRe.source, textRe.flags);
    while ((tm = tr.exec(paraXml)) !== null) texts.push(tm[1]);
    const text = texts.join('').trim();
    if (text) paras.push(text);
  }
  return paras;
}

// ── Passage-finding regexes ───────────────────────────────────────────────────
const PASSAGE_RE = /^READING PASSAGE ([123])$/i;
const TEST_RE    = /^Test (\d+)$/i;
const SECTION_END_RE = /^(LISTENING|WRITING|SPEAKING|Audioscript|Answer key|GENERAL TRAINING)/i;
const QUESTION_RE    = /^Questions?\s+\d+/i;
const SPEND_RE       = /^You should spend/i;
const PAGE_RE        = /^\d{1,3}$/;
const INSTRUCT_RE    = /^(Write|Choose|Complete|Label|Look at|Match|Do the|Which|Answer|Select)/i;
const ANSWER_BOX_RE  = /boxes?\s+\d+/i;
const TF_RE          = /^(TRUE|FALSE|NOT GIVEN|YES|NO)\s+if/i;

async function extractAllPassages(docxBuffer) {
  const paras = extractParagraphsFromDocx(docxBuffer);
  let currentTest = 'Test 1', currentPassage = '', currentTitle = '';
  let collecting = false, bodyLines = [];
  const dict = {};

  const flush = () => {
    if (!currentPassage || bodyLines.length < 8) { bodyLines = []; return; }
    const text = bodyLines.join('\n').trim();
    const wc   = text.split(/\s+/).length;
    if (wc > 80) {
      const key = `${currentTest}|${currentPassage}`;
      if (!dict[key] || wc > dict[key].wordCount)
        dict[key] = { test: currentTest, passage: currentPassage, title: currentTitle, text, wordCount: wc };
    }
    bodyLines = [];
  };

  for (let i = 0; i < paras.length; i++) {
    const line = paras[i];
    if (TEST_RE.test(line) && line.length < 15) {
      currentTest = 'Test ' + line.match(TEST_RE)[1]; continue;
    }
    if (SECTION_END_RE.test(line)) { flush(); collecting = false; continue; }
    const pm = line.match(PASSAGE_RE);
    if (pm) {
      flush();
      currentPassage = 'READING PASSAGE ' + pm[1];
      currentTitle   = '';
      for (let j = i + 1; j < Math.min(i + 8, paras.length); j++) {
        const l = paras[j];
        if (!l || l.length < 3) continue;
        if (SPEND_RE.test(l) || QUESTION_RE.test(l)) continue;
        if (PAGE_RE.test(l) || INSTRUCT_RE.test(l)) continue;
        if (/^(Reading Passage|READING PASSAGE)/i.test(l)) continue;
        if (l.length <= 150) { currentTitle = l; break; }
      }
      collecting = true; continue;
    }
    if (!collecting) continue;
    if (PAGE_RE.test(line) || SPEND_RE.test(line) || QUESTION_RE.test(line)) continue;
    if (INSTRUCT_RE.test(line) || ANSWER_BOX_RE.test(line) || TF_RE.test(line)) continue;
    if (line.length < 3) continue;
    bodyLines.push(line);
  }
  flush();

  return Object.values(dict)
    .filter(p => p.wordCount > 100)
    .sort((a, b) => a.test !== b.test ? a.test.localeCompare(b.test) : a.passage.localeCompare(b.passage));
}

async function extractPassagesForTest(docxBuffer, testNumber) {
  return (await extractAllPassages(docxBuffer)).filter(p => p.test === 'Test ' + testNumber);
}
async function extractSinglePassage(docxBuffer, testNumber, passageNumber) {
  return (await extractAllPassages(docxBuffer)).find(p =>
    p.test === 'Test ' + testNumber && p.passage === 'READING PASSAGE ' + passageNumber
  ) || null;
}

module.exports = { extractAllPassages, extractPassagesForTest, extractSinglePassage };
