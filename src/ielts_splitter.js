/**
 * src/ielts_splitter.js  (v3)
 * ─────────────────────────────────────────────────────────────
 * Extracts READING PASSAGE 1/2/3 from Cambridge IELTS PDFs (C8–C18).
 *
 * Fixes vs v1/v2:
 *  1. Handles spaced OCR: "R E A D I N G  P A S S A G E  1"
 *  2. NEVER stops collecting on "Test N" running headers (key fix)
 *  3. Stops only on WRITING/LISTENING section ends or next PASSAGE header
 *  4. Deduplicates: same (test, passage) → keep highest word count version
 *  5. Excludes General Training section (appears at back of book)
 *  6. Cleans instruction/question noise lines from passage body
 */
'use strict';
const pdfParse = require('pdf-parse');

const PASSAGE_RE   = /R\s*E\s*A\s*D\s*I\s*N\s*G\s+P\s*A\s*S\s*S\s*A\s*G\s*E\s+([123])/i;
const TEST_RE      = /^Test\s+(\d+)\s*$/i;
const SECTION_END  = /^(WRITING|LISTENING|SPEAKING|GENERAL\s+TRAINING)/i;
const GT_RE        = /General Training|GENERAL TRAINING/i;
const PAGE_NUM     = /^\d{1,3}$/;
const NOISE        = /^(Reading|Listening|Writing|Speaking)\s*$/i;
const SPEND        = /^You should spend about/i;
const PASS_BELOW   = /^Passage \d+ (below|on the following)/i;
const Q_HDR        = /^Questions?\s+\d+/i;
const INSTRUCT     = /^(Write|Choose|Complete|Label|Look at|Match|Do the|Which|Answer|Select|Give)/i;
const ANS_BOX      = /boxes?\s+\d+/i;
const TF_LINE      = /^(TRUE|FALSE|NOT GIVEN|YES|NO)\s+if/i;
const ROMAN_LIST   = /^[ivxlcIVXLC]+\s+[A-Z]/;

async function extractAllPassages(pdfBuffer) {
  const { text } = await pdfParse(pdfBuffer, { max: 0 });
  const pages = text.split('\f');

  let currentTest = 'Test 1', currentPassage = '', currentTitle = '';
  let collecting = false, bodyLines = [], inGT = false;
  const dict = {};  // (test, passage) → best version

  const flush = () => {
    if (!currentPassage || bodyLines.length < 10 || inGT) { bodyLines = []; return; }
    const txt = bodyLines.join('\n').trim();
    const wc  = txt.split(/\s+/).length;
    if (wc > 100) {
      const key = currentTest + '|' + currentPassage;
      if (!dict[key] || wc > dict[key].wordCount) {
        dict[key] = { test: currentTest, passage: currentPassage,
                      title: currentTitle, text: txt, wordCount: wc };
      }
    }
    bodyLines = [];
  };

  for (const page of pages) {
    const lines = page.split('\n').map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect General Training section → exclude everything after
      if (GT_RE.test(line)) { inGT = true; }

      // "Test N" running header: update label only, NEVER stop collecting
      if (TEST_RE.test(line) && line.length < 15) {
        currentTest = 'Test ' + line.match(TEST_RE)[1];
        continue;
      }

      // Section end (Writing, Listening, General Training)
      if (SECTION_END.test(line)) {
        if (GT_RE.test(line)) inGT = true;
        flush(); collecting = false; continue;
      }

      // READING PASSAGE header
      const pm = line.match(PASSAGE_RE);
      if (pm) {
        flush();
        currentPassage = 'READING PASSAGE ' + pm[1];
        currentTitle   = _findTitle(lines, i + 1);
        collecting     = true;
        continue;
      }

      if (!collecting) continue;

      // Skip noise lines (but keep collecting — don't break on questions)
      if (PAGE_NUM.test(line))    continue;
      if (NOISE.test(line))       continue;
      if (SPEND.test(line))       continue;
      if (PASS_BELOW.test(line))  continue;
      if (PASSAGE_RE.test(line))  continue;
      if (line.length < 3)        continue;
      if (Q_HDR.test(line))       continue;
      if (INSTRUCT.test(line))    continue;
      if (ANS_BOX.test(line))     continue;
      if (TF_LINE.test(line))     continue;
      if (ROMAN_LIST.test(line) && line.length < 60) continue;

      bodyLines.push(line);
    }
  }
  flush();

  return Object.values(dict)
    .filter(p => p.wordCount > 100)
    .sort((a, b) => {
      if (a.test !== b.test) return a.test.localeCompare(b.test);
      return a.passage.localeCompare(b.passage);
    });
}

async function extractPassagesForTest(pdfBuffer, testNumber) {
  const all = await extractAllPassages(pdfBuffer);
  return all.filter(p => p.test === 'Test ' + testNumber);
}

async function extractSinglePassage(pdfBuffer, testNumber, passageNumber) {
  const all = await extractAllPassages(pdfBuffer);
  return all.find(p =>
    p.test    === 'Test '             + testNumber &&
    p.passage === 'READING PASSAGE ' + passageNumber
  ) || null;
}

function _findTitle(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 12, lines.length); i++) {
    const l = lines[i];
    if (!l || l.length < 3) continue;
    if (SPEND.test(l) || Q_HDR.test(l) || PASSAGE_RE.test(l)) continue;
    if (PAGE_NUM.test(l) || NOISE.test(l) || INSTRUCT.test(l)) continue;
    if (PASS_BELOW.test(l)) continue;
    if (/^List of Headings/i.test(l)) continue;
    if (ROMAN_LIST.test(l) && l.length < 60) continue;
    if (l.length <= 120 && !/^[A-H]\s{2,}/.test(l)) return l;
  }
  return '';
}

module.exports = { extractAllPassages, extractPassagesForTest, extractSinglePassage };
