/**
 * src/ielts_splitter_docx.js
 * ──────────────────────────────────────────────────────────────
 * Extracts READING PASSAGE 1/2/3 from Cambridge IELTS .docx files.
 * No extra npm packages needed — uses Node's built-in unzip via
 * the 'unzipper' package (already used by docx library internally)
 * or direct Buffer manipulation.
 *
 * Works with Cambridge IELTS C8–C18 .docx format where passages
 * are clearly marked as "READING PASSAGE 1" etc.
 */
'use strict';
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── XML paragraph extractor ──────────────────────────────────────────────────
function extractParagraphsFromDocx(docxBuffer) {
  // Write to temp file, unzip document.xml, parse paragraphs
  const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-docx-'));
  const docx = path.join(tmp, 'input.docx');
  try {
    fs.writeFileSync(docx, docxBuffer);
    // Extract document.xml from the zip
    const xmlBuf = execSync(
      `unzip -p "${docx}" word/document.xml`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    return parseDocumentXml(xmlBuf.toString('utf8'));
  } finally {
    try { fs.rmSync(tmp, { recursive: true }); } catch(_) {}
  }
}

function parseDocumentXml(xml) {
  // Simple regex-based paragraph extraction (no full XML parser needed)
  // Extract all <w:p>...</w:p> blocks and collect <w:t> text
  const paras = [];
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const textRe  = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;

  let pm;
  while ((pm = paraRe.exec(xml)) !== null) {
    const paraXml = pm[0];
    const texts = [];
    let tm;
    const tr = new RegExp(textRe.source, textRe.flags);
    while ((tm = tr.exec(paraXml)) !== null) {
      texts.push(tm[1]);
    }
    const text = texts.join('').trim();
    if (text) paras.push(text);
  }
  return paras;
}

// ── Passage-finding regexes ──────────────────────────────────────────────────
const PASSAGE_RE = /^READING PASSAGE ([123])$/i;
const TEST_RE    = /^Test (\d+)$/i;
const SECTION_END_RE = /^(LISTENING|WRITING|SPEAKING|Audioscript|Answer key|GENERAL TRAINING)/i;
const QUESTION_RE    = /^Questions?\s+\d+/i;
const SPEND_RE       = /^You should spend/i;
const PAGE_RE        = /^\d{1,3}$/;
const INSTRUCT_RE    = /^(Write|Choose|Complete|Label|Look at|Match|Do the|Which|Answer|Select)/i;
const ANSWER_BOX_RE  = /boxes?\s+\d+/i;
const TF_RE          = /^(TRUE|FALSE|NOT GIVEN|YES|NO)\s+if/i;

// ── Main splitter ─────────────────────────────────────────────────────────────
async function extractAllPassages(docxBuffer) {
  const paras = extractParagraphsFromDocx(docxBuffer);

  let currentTest = 'Test 1', currentPassage = '', currentTitle = '';
  let collecting = false, bodyLines = [];
  const dict = {};   // key: "Test N|READING PASSAGE M" → best version

  const flush = () => {
    if (!currentPassage || bodyLines.length < 8) { bodyLines = []; return; }
    const text = bodyLines.join('\n').trim();
    const wc   = text.split(/\s+/).length;
    if (wc > 80) {
      const key = `${currentTest}|${currentPassage}`;
      if (!dict[key] || wc > dict[key].wordCount) {
        dict[key] = {
          test:      currentTest,
          passage:   currentPassage,
          title:     currentTitle,
          text,
          wordCount: wc,
        };
      }
    }
    bodyLines = [];
  };

  for (let i = 0; i < paras.length; i++) {
    const line = paras[i];

    // Test header — only update label, NEVER stop collecting
    if (TEST_RE.test(line) && line.length < 15) {
      currentTest = 'Test ' + line.match(TEST_RE)[1];
      continue;
    }

    // Section end (Listening, Writing, Speaking …)
    if (SECTION_END_RE.test(line)) {
      flush(); collecting = false; continue;
    }

    // READING PASSAGE header
    const pm = line.match(PASSAGE_RE);
    if (pm) {
      flush();
      currentPassage = `READING PASSAGE ${pm[1]}`;
      // Find title: next non-trivial line that isn't an instruction
      currentTitle = '';
      for (let j = i + 1; j < Math.min(i + 8, paras.length); j++) {
        const l = paras[j];
        if (!l || l.length < 3) continue;
        if (SPEND_RE.test(l) || QUESTION_RE.test(l)) continue;
        if (PAGE_RE.test(l)) continue;
        if (/^(Reading Passage|READING PASSAGE)/i.test(l)) continue;
        if (l.length <= 150) { currentTitle = l; break; }
      }
      collecting = true;
      continue;
    }

    if (!collecting) continue;

    // Skip noise lines
    if (PAGE_RE.test(line))       continue;
    if (SPEND_RE.test(line))      continue;
    if (QUESTION_RE.test(line))   continue;
    if (INSTRUCT_RE.test(line))   continue;
    if (ANSWER_BOX_RE.test(line)) continue;
    if (TF_RE.test(line))         continue;
    if (line.length < 3)          continue;

    bodyLines.push(line);
  }
  flush();

  return Object.values(dict)
    .filter(p => p.wordCount > 100)
    .sort((a, b) => {
      if (a.test !== b.test) return a.test.localeCompare(b.test);
      return a.passage.localeCompare(b.passage);
    });
}

async function extractPassagesForTest(docxBuffer, testNumber) {
  const all = await extractAllPassages(docxBuffer);
  return all.filter(p => p.test === `Test ${testNumber}`);
}

async function extractSinglePassage(docxBuffer, testNumber, passageNumber) {
  const all = await extractAllPassages(docxBuffer);
  return all.find(p =>
    p.test    === `Test ${testNumber}` &&
    p.passage === `READING PASSAGE ${passageNumber}`
  ) || null;
}

module.exports = { extractAllPassages, extractPassagesForTest, extractSinglePassage };
