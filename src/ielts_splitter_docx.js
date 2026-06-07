/**
 * src/ielts_splitter_docx.js  (v6)
 * Broadened patterns to support C17–C20 and newer Cambridge IELTS formats.
 * Fallback: infer test number from passage ordering if no explicit test headers found.
 */
'use strict';
const zlib = require('zlib');

// ── ZIP extraction (Central Directory approach — handles Data Descriptor) ─────
function extractFromZip(buffer, targetFile) {
  let eocd = -1;
  const searchFrom = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchFrom; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Invalid ZIP file: EOCD not found');
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  const cdSize   = buffer.readUInt32LE(eocd + 12);
  let pos = cdOffset;
  while (pos < cdOffset + cdSize && pos + 46 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const compression    = buffer.readUInt16LE(pos + 10);
    const compressedSz   = buffer.readUInt32LE(pos + 20);
    const fileNameLen    = buffer.readUInt16LE(pos + 28);
    const extraLen       = buffer.readUInt16LE(pos + 30);
    const commentLen     = buffer.readUInt16LE(pos + 32);
    const localHdrOffset = buffer.readUInt32LE(pos + 42);
    const entryName      = buffer.slice(pos + 46, pos + 46 + fileNameLen).toString('utf8');
    if (entryName === targetFile) {
      const localFnLen  = buffer.readUInt16LE(localHdrOffset + 26);
      const localExtraL = buffer.readUInt16LE(localHdrOffset + 28);
      const dataStart   = localHdrOffset + 30 + localFnLen + localExtraL;
      const raw = buffer.slice(dataStart, dataStart + compressedSz);
      return compression === 0 ? raw : zlib.inflateRawSync(raw);
    }
    pos += 46 + fileNameLen + extraLen + commentLen;
  }
  throw new Error(`${targetFile} not found in docx`);
}

function extractAllText(xml) {
  const decode = s => s
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'");
  const paras = [];
  const tRe   = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  for (const block of xml.split('</w:p>')) {
    const texts = []; let m; tRe.lastIndex = 0;
    while ((m = tRe.exec(block)) !== null) texts.push(decode(m[1]));
    const text = texts.join('').trim();
    if (text && !text.startsWith('<w:')) paras.push(text);
  }
  return paras;
}

// ── Patterns ──────────────────────────────────────────────────────────────────
// TEST_RE: covers "Test 1", "Academic Test 1", "IELTS Test 1", etc.
const TEST_RE = /^(?:IELTS\s+)?(?:Academic\s+|General\s+(?:Training\s+)?)?Test\s+(\d+)\s*$/i;

// PASSAGE_RE: "READING PASSAGE 1" with optional trailing punctuation/spaces
const PASSAGE_RE = /^READING\s+PASSAGE\s+([1-9])\s*[:\-.]?\s*$/i;

const SECTION_END = /^(LISTENING|WRITING|SPEAKING|Audioscript|Answer key|GENERAL TRAINING|TEST\s+KEYS|TAPESCRIPTS?|ANSWER\s+SHEETS?)/i;
const QUESTION_RE = /^Questions?\s+\d+/i;
const SPEND_RE    = /^You should spend/i;
const PAGE_RE     = /^\d{1,3}$/;
const NOISE_RE    = /^(Write|Choose|Complete|Label|Look at|Match|Do the|Which|Answer|Select|In boxes|TRUE\s+if|FALSE\s+if|List of|Choose the correct heading)/i;
const SENTENCE_RE = /^[A-Z].{20,}$/;

// ── Chunk processor (separate passage body from question text) ────────────────
function processChunk(lines) {
  const bodyLines = [], qLines = [];
  let inQuestions = false;
  for (const line of lines) {
    if (PAGE_RE.test(line) || SPEND_RE.test(line)) continue;
    if (QUESTION_RE.test(line)) {
      if (bodyLines.length > 15) inQuestions = true;
      continue;
    }
    if (NOISE_RE.test(line) || line.length < 4) continue;
    if (!inQuestions) {
      bodyLines.push(line);
    } else {
      if (SENTENCE_RE.test(line)) qLines.push(line);
    }
  }
  if (bodyLines.length < 10) {
    const allSentences = lines.filter(l =>
      !PAGE_RE.test(l) && !SPEND_RE.test(l) && !QUESTION_RE.test(l) &&
      !NOISE_RE.test(l) && l.length > 20
    );
    return { bodyLines: allSentences, qLines };
  }
  return { bodyLines, qLines };
}

// ── Main extractor ─────────────────────────────────────────────────────────────
async function extractAllPassages(docxBuffer) {
  const xmlBuf = extractFromZip(docxBuffer, 'word/document.xml');
  const paras  = extractAllText(xmlBuf.toString('utf8'));

  let currentTest = 'Test 1', currentPassage = '', currentTitle = '';
  let collecting  = false;
  let rawLines    = [];
  const dict      = {};
  let testHeadersSeen = 0;   // track how many explicit test headers we found

  const flush = () => {
    if (!currentPassage || rawLines.length < 5) { rawLines = []; return; }
    const { bodyLines, qLines } = processChunk(rawLines);
    const text = bodyLines.join('\n').trim();
    const wc   = text.split(/\s+/).length;
    if (wc > 100) {
      const key = currentTest + '|' + currentPassage;
      if (!dict[key] || wc > dict[key].wordCount) {
        dict[key] = {
          test: currentTest, passage: currentPassage,
          title: currentTitle, text, wordCount: wc,
          questionsText: qLines.join('\n').trim(),
        };
      }
    }
    rawLines = [];
  };

  for (let i = 0; i < paras.length; i++) {
    const line = paras[i];

    // Test header — broaden: allow up to 40 chars to cover "Academic Test 1"
    const tm = line.match(TEST_RE);
    if (tm && line.length < 40) {
      flush();
      currentTest = 'Test ' + tm[1];
      testHeadersSeen++;
      collecting = false;
      continue;
    }

    // Section end
    if (SECTION_END.test(line)) { flush(); collecting = false; continue; }

    // READING PASSAGE header
    const pm = line.match(PASSAGE_RE);
    if (pm) {
      flush();
      currentPassage = 'READING PASSAGE ' + pm[1];
      currentTitle   = '';
      for (let j = i + 1; j < Math.min(i + 10, paras.length); j++) {
        const l = paras[j];
        if (!l || l.length < 3) continue;
        if (SPEND_RE.test(l) || QUESTION_RE.test(l) || PAGE_RE.test(l)) continue;
        if (NOISE_RE.test(l)) continue;
        if (/^READING\s+PASSAGE/i.test(l)) continue;
        if (l.length > 5 && l.length <= 150) { currentTitle = l; break; }
      }
      collecting = true;
      continue;
    }

    if (collecting) rawLines.push(line);
  }
  flush();

  const passages = Object.values(dict)
    .filter(p => p.wordCount > 100)
    .sort((a, b) => a.test !== b.test
      ? a.test.localeCompare(b.test, undefined, { numeric: true })
      : a.passage.localeCompare(b.passage));

  // ── Fallback: if no explicit test headers found, infer test number ────────
  // Every 3 READING PASSAGEs = 1 test (standard Cambridge Academic format)
  if (testHeadersSeen === 0 && passages.length > 0) {
    console.log('[ielts_splitter] No explicit test headers found — inferring test numbers');
    // Sort by passage number and reassign tests (passages 1-3 = Test 1, 4-6 = Test 2…)
    // But first check: do all passages have the same passage number (1, 2, 3)?
    // If yes, they were already reset per-test; need a different approach.

    // Collect all unique passage numbers
    const passageNums = [...new Set(passages.map(p => p.passage.match(/\d+/)?.[0]))].sort();
    if (passageNums.length <= 3 && passages.length > 3) {
      // Passages 1/2/3 appeared multiple times — assign test numbers by occurrence order
      const passageGroups = {};
      let occurrence = {};
      for (const p of passages) {
        const num = p.passage.match(/\d+/)?.[0];
        occurrence[num] = (occurrence[num] || 0) + 1;
        const testNum = occurrence[num];
        p.test = 'Test ' + testNum;
      }
    } else {
      // Flat passage numbering (1-12 total): passages 1-3 = Test 1, 4-6 = Test 2, etc.
      let passageOrder = 0;
      for (const p of passages) {
        passageOrder++;
        const testNum  = Math.ceil(passageOrder / 3);
        const passNum  = ((passageOrder - 1) % 3) + 1;
        p.test    = 'Test ' + testNum;
        p.passage = 'READING PASSAGE ' + passNum;
      }
    }
  }

  console.log('[ielts_splitter] Found ' + passages.length + ' passages: ' +
    passages.map(p => p.test + ' ' + p.passage).join(', '));

  return passages.filter(p => p.wordCount > 100)
    .sort((a, b) => a.test !== b.test
      ? a.test.localeCompare(b.test, undefined, { numeric: true })
      : a.passage.localeCompare(b.passage));
}

async function extractPassagesForTest(docxBuffer, testNumber) {
  return (await extractAllPassages(docxBuffer)).filter(p => p.test === 'Test ' + testNumber);
}
async function extractSinglePassage(docxBuffer, testNumber, passageNumber) {
  return (await extractAllPassages(docxBuffer)).find(p =>
    p.test    === 'Test ' + testNumber &&
    p.passage === 'READING PASSAGE ' + passageNumber
  ) || null;
}

module.exports = { extractAllPassages, extractPassagesForTest, extractSinglePassage };
