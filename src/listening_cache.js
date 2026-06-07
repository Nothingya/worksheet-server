'use strict';
// ═══════════════════════════════════════════════════════════════════
//  listening_cache.js
//  "读取一次→保存记忆→按需生成" 的核心编排
//  - 扫描 ielts_listening_input/ 目录的 .docx
//  - 首次：extract → generate(每个Test) → 写 ielts_listening_cache/<book>.json
//  - 之后：直接读缓存 → build docx (Test 1/2/3/4 或全部)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { extractListening } = require('./extract_listening_script');
const { generateListeningTasks } = require('./generate_listening_ielts');
const { buildListeningWorksheet } = require('./build_listening_ielts');

const INPUT_DIR = path.join(__dirname, '..', 'ielts_listening_input');
const CACHE_DIR = path.join(__dirname, '..', 'ielts_listening_cache');
[INPUT_DIR, CACHE_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const cacheKey = (fileName) => fileName.replace(/\.docx$/i, '');
const cachePath = (fileName) => path.join(CACHE_DIR, cacheKey(fileName) + '.json');

// 已缓存的书目列表（含每本可用的 Test 编号）
function listCachedBooks() {
  return fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json')).map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    return { key: f.replace(/\.json$/, ''), bookTitle: data.bookTitle, tests: Object.keys(data.tests).map(Number).sort() };
  });
}

// 解析并缓存一本书（读取一次 → 保存记忆）。force=true 强制重新生成
async function ingestBook(fileNameOrBuffer, fileName, { force = false } = {}) {
  const cp = cachePath(fileName);
  if (!force && fs.existsSync(cp)) {
    return { cached: true, ...JSON.parse(fs.readFileSync(cp, 'utf8')) };
  }
  const buffer = Buffer.isBuffer(fileNameOrBuffer)
    ? fileNameOrBuffer
    : fs.readFileSync(path.join(INPUT_DIR, fileName));

  // 1) 抽取原始脚本+答案
  const { bookTitle, tests } = await extractListening(buffer);

  // 2) 对每个 Test 调 Claude 生成 task JSON
  const generated = { bookTitle, tests: {} };
  for (const tn of Object.keys(tests).sort()) {
    const testData = tests[tn].parts;        // {1:{script,answers},...}
    try {
      const taskJSON = await generateListeningTasks(Number(tn), testData);
      taskJSON.bookTitle = bookTitle;
      taskJSON.testNum = Number(tn);
      generated.tests[tn] = taskJSON;
      console.log(`[LS cache] ${bookTitle} Test ${tn} generated`);
    } catch (e) {
      console.error(`[LS cache] Test ${tn} FAILED: ${e.message}`);
    }
  }
  // 3) 写缓存
  fs.writeFileSync(cp, JSON.stringify(generated, null, 2));
  return { cached: false, ...generated };
}

// 从缓存生成 docx。testSel = 1|2|3|4|'all'
async function generateDocx(bookKey, testSel) {
  const cp = path.join(CACHE_DIR, bookKey + '.json');
  if (!fs.existsSync(cp)) throw new Error(`未找到缓存: ${bookKey}，请先上传/解析该书`);
  const data = JSON.parse(fs.readFileSync(cp, 'utf8'));

  const wanted = testSel === 'all'
    ? Object.keys(data.tests).map(Number).sort()
    : [Number(testSel)];

  const results = [];
  for (const tn of wanted) {
    const td = data.tests[tn];
    if (!td) { console.warn(`[LS] Test ${tn} 无缓存数据`); continue; }
    const buf = await buildListeningWorksheet(td);
    results.push({ testNum: tn, fileName: `${bookKey}_Test${tn}_Listening.docx`, buffer: buf });
  }
  return results;   // 数组：可单个或多个(全部)
}

module.exports = { ingestBook, generateDocx, listCachedBooks, INPUT_DIR, CACHE_DIR };
