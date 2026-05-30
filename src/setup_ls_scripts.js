#!/usr/bin/env node
// setup_ls_scripts.js — Parse Listening & Speaking script PDF
// Usage:
//   node setup_ls_scripts.js "./PW3E L4 LS Script.pdf"
//   node setup_ls_scripts.js "./PW3E L4 LS Script.pdf" --debug

const pdfParse  = require('pdf-parse');
const PDFParser = require('pdf2json');
const fs        = require('fs');
const path      = require('path');

const DEBUG = process.argv.includes('--debug');

// ── Text extraction ──────────────────────────────────────────────
async function extractText(buffer) {
  try {
    const d = await pdfParse(buffer);
    if (d.text.trim().length > 500) return d.text;
  } catch(_) {}
  return new Promise((res, rej) => {
    const p = new PDFParser(null, 1);
    p.on('pdfParser_dataReady', () =>
      res((p.getRawTextContent() || '').replace(/---+Page[^-]+-+/g, '\n')));
    p.on('pdfParser_dataError', rej);
    p.parseBuffer(buffer);
  });
}

// ── Fix OCR spacing: "L E S S O N A" -> "LESSON A" ──────────────
function normalise(text) {
  return text
    .replace(/\b([A-Z])((?:\s+[A-Z]){2,})\b/g, (_, f, r) => f + r.replace(/\s+/g, ''))
    .replace(/([A-Z])\s*\.\s+([A-Z](?:\s+[A-Z])+)/g, (_, l, w) => l + '. ' + w.replace(/\s+/g, ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[\u200b\u200c\u200d\uFEFF]/g, '');
}

function findFirst(text, patterns) {
  let best = -1;
  for (const rx of patterns) {
    const m = text.search(rx);
    if (m !== -1 && (best === -1 || m < best)) best = m;
  }
  return best;
}

// ── Find where actual transcript content starts ──────────────────
// Strategy: find the EARLIEST of DETAILS, MAIN IDEAS, or dialogue lines.
// Some units use "MAIN IDEAS" section heading; others have transcript under "DETAILS".
// We take whichever appears first (and is followed by real content).
function findContentStart(text) {

  const candidates = [];

  // ── Candidate: DETAILS (any of these forms) ───────────────────
  // 1a. Adjacent "C. DETAILS" or "D. DETAILS"
  let m = text.search(/[A-Z]\.\s*(THE\s+)?DETAILS?\b/i);
  if (m !== -1) {
    const nl = text.indexOf('\n', m);
    candidates.push({ pos: nl !== -1 ? nl + 1 : m + 10, tag: 'DETAILS-adjacent' });
  }

  // 1b. Section letter on own line, DETAILS within 300 chars (page noise between)
  const cMatch = /\b[A-Z]\.\s*\n/.exec(text);
  if (cMatch) {
    const win = text.slice(cMatch.index, cMatch.index + 300);
    const dIdx = win.search(/\bDETAILS?\b/i);
    if (dIdx !== -1) {
      const abs = cMatch.index + dIdx;
      const nl  = text.indexOf('\n', abs);
      candidates.push({ pos: nl !== -1 ? nl + 1 : abs + 8, tag: 'DETAILS-separated' });
    }
  }

  // 1c. Standalone DETAILS line
  m = text.search(/^DETAILS?\s*$/im);
  if (m !== -1) {
    const nl = text.indexOf('\n', m);
    candidates.push({ pos: nl !== -1 ? nl + 1 : m + 8, tag: 'DETAILS-standalone' });
  }

  // ── Candidate: MAIN IDEAS ─────────────────────────────────────
  // Some lessons store the transcript under "MAIN IDEAS" (not C. DETAILS)
  m = text.search(/\bMAIN\s+IDEAS?\b/i);
  if (m !== -1) {
    const nl = text.indexOf('\n', m);
    candidates.push({ pos: nl !== -1 ? nl + 1 : m + 12, tag: 'MAIN-IDEAS' });
  }

  // ── Candidate: dialogue lines ─────────────────────────────────
  // Named speaker "Host: " / "Guest: " etc.
  m = text.search(/\b(?:Host|Guest|Interviewer|Narrator|Student|Teacher)\s*:/i);
  if (m !== -1) candidates.push({ pos: m, tag: 'speaker-label' });

  // Any "Word: text" dialogue line
  m = text.search(/^[A-Z][a-z]+\s*:\s+\S/m);
  if (m !== -1) candidates.push({ pos: m, tag: 'dialogue-line' });

  if (!candidates.length) return -1;

  // Take the earliest valid candidate (pos > 0)
  candidates.sort((a, b) => a.pos - b.pos);
  const best = candidates.find(c => c.pos > 0);
  if (DEBUG && best) console.log(`    [content-start] strategy="${best.tag}" pos=${best.pos}`);
  return best ? best.pos : -1;
}

// ── Extract listening content from one lesson slice ──────────────
function extractLesson(lessonText, unit, lesson) {
  const LISTENING_RX = [/\bLISTENING\b/i, /C\.\s*LISTENING\b/i];
  const END_RX       = [/\bD\.\s+[A-Z]/m, /\bD\.\s*\n/m, /\bACTIVITY\s+D\b/i];

  // Narrow to LISTENING section first
  const liIdx = findFirst(lessonText, LISTENING_RX);
  const workText = liIdx !== -1 ? lessonText.slice(liIdx) : lessonText;

  if (DEBUG && liIdx === -1)
    console.log(`  [WARN] Unit ${unit} Lesson ${lesson}: no LISTENING marker, searching full lesson`);

  // Find content start
  const cStart = findContentStart(workText);
  if (cStart === -1) {
    if (DEBUG) console.log(`  [WARN] Unit ${unit} Lesson ${lesson}: no content start found`);
    return '';
  }

  const content = workText.slice(cStart);

  // Find end boundary D.
  const endIdx = findFirst(content, END_RX);
  const result = (endIdx !== -1 ? content.slice(0, endIdx) : content).trim();

  if (DEBUG) console.log(`  [OK] Unit ${unit} Lesson ${lesson}: ${result.length} chars`);
  return result;
}

// ── Main parser ──────────────────────────────────────────────────
function parseLS(rawText) {
  const text = normalise(rawText);
  const result = {};

  // Collect all UNIT positions
  const unitHits = [];
  const ux = /\bUNIT\s*(\d+)\s*(?:[:]\s*|$)/gim;
  let m;
  while ((m = ux.exec(text)) !== null) {
    const n = parseInt(m[1]);
    if (!unitHits.find(h => h.unit === n))
      unitHits.push({ unit: n, index: m.index });
  }
  unitHits.sort((a, b) => a.index - b.index);

  if (DEBUG)
    console.log('\n[DEBUG] Units found:', unitHits.map(h => `Unit${h.unit}@${h.index}`).join(', '));

  unitHits.forEach((u, ui) => {
    const unitEnd   = unitHits[ui + 1]?.index ?? text.length;
    const unitSlice = text.slice(u.index, unitEnd);
    result[u.unit]  = { A: '', B: '' };

    const aIdx = unitSlice.search(/\bLESSON\s+A\b/i);
    const bIdx = unitSlice.search(/\bLESSON\s+B\b/i);

    if (DEBUG)
      console.log(`\n[DEBUG] Unit ${u.unit}: aIdx=${aIdx} bIdx=${bIdx} len=${unitSlice.length}`);

    if (aIdx !== -1) {
      const aEnd = bIdx !== -1 && bIdx > aIdx ? bIdx : unitSlice.length;
      if (DEBUG) console.log(`  [A boundary] ...${unitSlice.slice(aIdx, aIdx + 80).replace(/\n/g,' ')}`);
      result[u.unit].A = extractLesson(unitSlice.slice(aIdx, aEnd), u.unit, 'A');
    }

    if (bIdx !== -1) {
      if (DEBUG) console.log(`  [B boundary] ...${unitSlice.slice(bIdx, bIdx + 80).replace(/\n/g,' ')}`);
      result[u.unit].B = extractLesson(unitSlice.slice(bIdx), u.unit, 'B');
    }
  });

  return result;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const pdfPath = process.argv.find(a => a.endsWith('.pdf'));
  if (!pdfPath) {
    console.log('Usage: node setup_ls_scripts.js <ls_script.pdf> [--debug]');
    process.exit(1);
  }
  if (!fs.existsSync(pdfPath)) {
    console.error('File not found:', pdfPath); process.exit(1);
  }

  console.log('\nReading:', path.basename(pdfPath));
  const buffer = fs.readFileSync(pdfPath);
  process.stdout.write('Extracting text... ');
  const rawText = await extractText(buffer);
  console.log(`done (${rawText.length} chars)`);

  const scripts = parseLS(rawText);
  const units   = Object.keys(scripts).map(Number).sort((a, b) => a - b);

  if (!units.length) {
    console.error('No UNIT markers found. Try --debug to inspect the raw text.');
    process.exit(1);
  }

  console.log(`\nFound ${units.length} units:\n`);
  let missing = 0;
  units.forEach(u => {
    const a = scripts[u].A.length, b = scripts[u].B.length;
    if (!a || !b) missing++;
    const as = a ? `A (${a} chars)` : 'A [MISSING]';
    const bs = b ? `B (${b} chars)` : 'B [MISSING]';
    console.log(`  Unit ${String(u).padEnd(3)} ${as.padEnd(18)}  ${bs}`);
  });

  if (missing)
    console.log(`\n${missing} unit(s) still missing. Run with --debug to see raw text near boundaries.`);

  // Write output
  const lines = [
    '// src/ls_script_data.js',
    `// Auto-generated from: ${path.basename(pdfPath)}`,
    '',
    'const UNIT_LS_SCRIPTS = {'
  ];
  units.forEach(u => {
    const esc = s => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${');
    lines.push(`  ${u}: { A: \`${esc(scripts[u].A)}\`, B: \`${esc(scripts[u].B)}\` },`);
  });
  lines.push('};\n\nmodule.exports = { UNIT_LS_SCRIPTS };');

  const outPath = path.join(__dirname, 'src', 'ls_script_data.js');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log('\nGenerated: src/ls_script_data.js');
  console.log('Restart: pm2 restart server\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });
