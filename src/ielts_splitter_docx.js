/**
 * src/ielts_splitter_docx.js  (v5)
 * Strategy: collect ALL lines between READING PASSAGE N headers,
 * then post-process to separate passage body from question statements.
 */
'use strict';
const zlib = require('zlib');

function extractFromZip(buffer, targetFile) {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }
    const compression  = buffer.readUInt16LE(offset + 8);
    const compressedSz = buffer.readUInt32LE(offset + 18);
    const fileNameLen  = buffer.readUInt16LE(offset + 26);
    const extraLen     = buffer.readUInt16LE(offset + 28);
    const entryName    = buffer.slice(offset + 30, offset + 30 + fileNameLen).toString('utf8');
    const dataStart    = offset + 30 + fileNameLen + extraLen;
    if (entryName === targetFile) {
      const raw = buffer.slice(dataStart, dataStart + compressedSz);
      return compression === 0 ? raw : zlib.inflateRawSync(raw);
    }
    offset = dataStart + compressedSz;
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

const PASSAGE_RE  = /^READING PASSAGE ([123])$/i;
const TEST_RE     = /^Test (\d+)$/i;
const SECTION_END = /^(LISTENING|WRITING|SPEAKING|Audioscript|Answer key|GENERAL TRAINING)/i;
const QUESTION_RE = /^Questions?\s+\d+/i;
const SPEND_RE    = /^You should spend/i;
const PAGE_RE     = /^\d{1,3}$/;
const NOISE_RE    = /^(Write|Choose|Complete|Label|Look at|Match|Do the|Which|Answer|Select|In boxes|TRUE\s+if|FALSE\s+if|List of|Choose the correct heading)/i;
const SENTENCE_RE = /^[A-Z].{20,}$/;  // real English sentence

// Separate passage body from question statements within a raw chunk
function processChunk(lines) {
  const bodyLines = [];
  const qLines    = [];
  let inQuestions = false;

  for (const line of lines) {
    if (PAGE_RE.test(line)) continue;
    if (SPEND_RE.test(line)) continue;

    if (QUESTION_RE.test(line)) {
      // Once we've collected enough body text, switch to questions mode
      // If body is still empty (questions come first), keep collecting body
      if (bodyLines.length > 15) inQuestions = true;
      continue;
    }

    if (NOISE_RE.test(line)) continue;
    if (line.length < 4) continue;

    if (!inQuestions) {
      bodyLines.push(line);
    } else {
      // In questions zone: only keep real English sentences
      if (SENTENCE_RE.test(line)) qLines.push(line);
    }
  }

  // If body is still very short, the passage text might be after the questions
  // In that case, everything long is passage text
  if (bodyLines.length < 10) {
    const allSentences = lines.filter(l =>
      !PAGE_RE.test(l) && !SPEND_RE.test(l) && !QUESTION_RE.test(l) &&
      !NOISE_RE.test(l) && l.length > 20
    );
    // Passage text tends to be in longer continuous blocks
    return { bodyLines: allSentences, qLines };
  }

  return { bodyLines, qLines };
}

async function extractAllPassages(docxBuffer) {
  const xmlBuf = extractFromZip(docxBuffer, 'word/document.xml');
  const paras  = extractAllText(xmlBuf.toString('utf8'));

  let currentTest = 'Test 1', currentPassage = '', currentTitle = '';
  let collecting  = false;
  let rawLines    = [];
  const dict      = {};

  const flush = () => {
    if (!currentPassage || rawLines.length < 5) { rawLines = []; return; }
    const { bodyLines, qLines } = processChunk(rawLines);
    const text = bodyLines.join('\n').trim();
    const wc   = text.split(/\s+/).length;
    if (wc > 100) {
      const key = `${currentTest}|${currentPassage}`;
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

    // Test running header — update only
    if (TEST_RE.test(line) && line.length < 15) {
      currentTest = 'Test ' + line.match(TEST_RE)[1]; continue;
    }
    // Section end
    if (SECTION_END.test(line)) { flush(); collecting = false; continue; }

    // READING PASSAGE header
    const pm = line.match(PASSAGE_RE);
    if (pm) {
      flush();
      currentPassage = 'READING PASSAGE ' + pm[1];
      // Find title
      currentTitle = '';
      for (let j = i + 1; j < Math.min(i + 10, paras.length); j++) {
        const l = paras[j];
        if (!l || l.length < 3) continue;
        if (SPEND_RE.test(l) || QUESTION_RE.test(l) || PAGE_RE.test(l)) continue;
        if (NOISE_RE.test(l)) continue;
        if (/^(Reading Passage|READING PASSAGE)/i.test(l)) continue;
        if (l.length > 5 && l.length <= 150) { currentTitle = l; break; }
      }
      collecting = true;
      continue;
    }

    if (collecting) rawLines.push(line);
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
    p.test    === 'Test ' + testNumber &&
    p.passage === 'READING PASSAGE ' + passageNumber
  ) || null;
}

module.exports = { extractAllPassages, extractPassagesForTest, extractSinglePassage };
