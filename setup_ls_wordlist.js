#!/usr/bin/env node
// setup_ls_wordlist.js — Parse LS word list PDF → src/ls_wordlist_data.js
// Expects a word list structured as:  UNIT X  / LESSON A / LESSON B
// Usage: node setup_ls_wordlist.js "./PW3E L4 LS Wordlist.pdf"
require('dotenv').config();
const pdfParse  = require('pdf-parse');
const PDFParser = require('pdf2json');
const fs = require('fs');
const path = require('path');

async function extractText(buffer) {
  try { const d=await pdfParse(buffer); if(d.text.length>100) return d.text; } catch(_){}
  return new Promise((res,rej)=>{
    const p=new PDFParser(null,1);
    p.on('pdfParser_dataReady',()=>res((p.getRawTextContent()||'').replace(/---+Page[^-]+-+/g,'\n')));
    p.on('pdfParser_dataError',rej);
    p.parseBuffer(buffer);
  });
}

function parseWordlist(text) {
  const result = {}; // { '1A': ['word1','word2',...], '1B': [...] }
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  let currentKey = null;

  for (const line of lines) {
    // New unit+lesson
    const unitA = line.match(/^UNIT\s*(\d+)\s*[:-]?\s*LESSON\s*A/i);
    const unitB = line.match(/^UNIT\s*(\d+)\s*[:-]?\s*LESSON\s*B/i);
    const justUnit = line.match(/^UNIT\s*(\d+)\b/i);
    const lessonA  = line.match(/^LESSON\s+A\b/i);
    const lessonB  = line.match(/^LESSON\s+B\b/i);

    if (unitA) { currentKey = `${unitA[1]}A`; result[currentKey]=result[currentKey]||[]; continue; }
    if (unitB) { currentKey = `${unitB[1]}B`; result[currentKey]=result[currentKey]||[]; continue; }
    if (justUnit) { currentKey = `${justUnit[1]}A`; result[currentKey]=result[currentKey]||[]; continue; }
    if (lessonA && currentKey) { const u=currentKey.replace(/[AB]$/,''); currentKey=u+'A'; result[currentKey]=result[currentKey]||[]; continue; }
    if (lessonB && currentKey) { const u=currentKey.replace(/[AB]$/,''); currentKey=u+'B'; result[currentKey]=result[currentKey]||[]; continue; }

    // Word lines: match lines starting with a word (possibly numbered)
    if (!currentKey) continue;
    const wordMatch = line.match(/^(?:\d+\.\s*)?([a-zA-Z][a-zA-Z\s'\-]*)/);
    if (wordMatch) {
      const word = wordMatch[1].trim().toLowerCase();
      if (word.length > 1 && !result[currentKey].includes(word)) {
        result[currentKey].push(word);
      }
    }
  }
  return result;
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) { console.log('用法：node setup_ls_wordlist.js <wordlist.pdf>'); process.exit(1); }
  if (!fs.existsSync(pdfPath)) { console.error(`❌  ${pdfPath} 不存在`); process.exit(1); }

  const buf = fs.readFileSync(pdfPath);
  process.stdout.write('📄  提取文字... ');
  const text = await extractText(buf);
  console.log(`完成（${text.length} 字符）`);

  const wl = parseWordlist(text);
  const keys = Object.keys(wl).sort();
  if (!keys.length) {
    console.error('❌  未找到词汇列表结构');
    console.log('预览：\n' + text.slice(0,400));
    process.exit(1);
  }
  console.log(`\n✅  识别到：`);
  keys.forEach(k => console.log(`   ${k}: ${wl[k].length} 个词`));

  const lines = [
    '// src/ls_wordlist_data.js',
    `// Auto-generated from: ${path.basename(pdfPath)}\n`,
    'const LS_WORDLIST = {'
  ];
  keys.forEach(k => {
    lines.push(`  '${k}': ${JSON.stringify(wl[k])},`);
  });
  lines.push('};\n');
  lines.push('module.exports = { LS_WORDLIST };');

  const outPath = path.join(__dirname, 'src', 'ls_wordlist_data.js');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\n🎉  已生成：src/ls_wordlist_data.js\npm2 restart server 后生效\n`);
}

main().catch(e=>{ console.error('❌', e.message); process.exit(1); });
