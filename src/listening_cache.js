'use strict';
// listening_cache.js — 精简版
// 只从 ielts_listening_cache/ 读取 JSON → build docx
// 不再有 input 文件夹 / ingestBook / scanAndIngestAll
const fs   = require('fs');
const path = require('path');
const { buildListeningWorksheet } = require('./build_listening_ielts');
const archiver = require('archiver');

const CACHE_DIR = path.join(__dirname, '..', 'ielts_listening_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function listCachedBooks() {
  return fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
      return {
        key:       f.replace(/\.json$/, ''),
        bookTitle: data.bookTitle,
        tests:     Object.keys(data.tests).map(Number).sort(),
      };
    });
}

async function generateDocx(bookKey, testSel) {
  const cp = path.join(CACHE_DIR, bookKey + '.json');
  if (!fs.existsSync(cp)) throw new Error(`未找到缓存: ${bookKey}，请把对应 JSON 放入 ielts_listening_cache/`);
  const data   = JSON.parse(fs.readFileSync(cp, 'utf8'));
  const wanted = testSel === 'all'
    ? Object.keys(data.tests).map(Number).sort()
    : [Number(testSel)];

  const results = [];
  for (const tn of wanted) {
    const td = data.tests[String(tn)];
    if (!td) { console.warn(`[LS] Test ${tn} 不在缓存中`); continue; }
    const buf = await buildListeningWorksheet(td);
    results.push({ testNum: tn, fileName: `${bookKey}_Test${tn}_Listening.docx`, buffer: buf });
  }
  return results;
}

module.exports = { listCachedBooks, generateDocx, CACHE_DIR };
