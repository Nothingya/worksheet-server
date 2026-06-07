'use strict';
// ═══════════════════════════════════════════════════════════════════
//  extract_listening_script.js
//  从任意剑桥雅思 .docx 自动定位 Audioscripts + Listening Answer Key
//  返回结构：{ bookTitle, tests: { 1:{parts:{1:{script,answers},...}}, ... } }
//  兼容 C8–C20+ （复用 mammoth 提取纯文本，再用 regex 切分）
// ═══════════════════════════════════════════════════════════════════
const mammoth = require('mammoth');

// 把 docx buffer 转成带换行的纯文本
async function docxToText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

// 定位 Audioscripts 区块（文末），返回该区块文本
function sliceAudioscripts(fullText) {
  const m = fullText.match(/Audioscripts?/i);
  if (!m) return null;
  // 从 Audioscripts 标题开始，到 Listening/Reading answer keys 之前（若有）
  let start = m.index;
  const akMatch = fullText.slice(start).match(/(Listening and Reading answer keys|answer keys)/i);
  const end = akMatch ? start + akMatch.index : fullText.length;
  return fullText.slice(start, end);
}

// 在 Audioscripts 区块中切分各 Test 各 Part
// 剑桥脚本顺序通常为 TEST n → PART 1..4（C20 内部可能乱序，用 PART 标记兜底）
function splitAudioscripts(audioText) {
  // 找所有 TEST 标记
  const testRe = /\bTEST\s*\*{0,2}\s*(\d)\b/gi;
  const tests = {};
  let matches = [];
  let mm;
  while ((mm = testRe.exec(audioText)) !== null) {
    matches.push({ testNum: parseInt(mm[1],10), idx: mm.index });
  }
  if (matches.length === 0) {
    // 无 TEST 标记：整段当作 Test 1
    matches = [{ testNum: 1, idx: 0 }];
  }
  for (let i = 0; i < matches.length; i++) {
    const { testNum, idx } = matches[i];
    const end = (i+1 < matches.length) ? matches[i+1].idx : audioText.length;
    const block = audioText.slice(idx, end);
    tests[testNum] = splitParts(block);
  }
  return tests;
}

// 在一个 Test 区块里按 PART 1..4 切分
function splitParts(block) {
  const partRe = /\bPART\s*\*{0,2}\s*([1-4])\b/gi;
  const parts = {};
  let arr = [], mm;
  while ((mm = partRe.exec(block)) !== null) {
    arr.push({ partNum: parseInt(mm[1],10), idx: mm.index });
  }
  for (let i = 0; i < arr.length; i++) {
    const { partNum, idx } = arr[i];
    const end = (i+1 < arr.length) ? arr[i+1].idx : block.length;
    // 去掉行内 *Q11* 等标记，保留纯脚本
    let scriptText = block.slice(idx, end)
      .replace(/\*?Q?0?\d{1,2}\*?/g, ' ')   // 题号标记
      .replace(/[ \t]+/g, ' ')
      .trim();
    parts[partNum] = { script: scriptText };
  }
  return parts;
}

// 定位 Listening Answer Key 区块并按 Test/Part 抽取答案
function extractAnswerKeys(fullText) {
  const m = fullText.match(/Listening and Reading answer keys/i);
  if (!m) return {};
  const akText = fullText.slice(m.index);
  // 每个 Test 的 listening answer block 以 "Listening" + "Test n" 或 "Part 1, Questions 1-10" 开头
  // 简化：按 "Part N, Questions" 抓取答案序列；Test 边界用 "Reading Passage" 分隔
  const tests = {};
  // 按 Test 切（answer key 中通常 Listening 在每个 Test 段首）
  const testBlocks = akText.split(/(?=Test\s*\d|TEST\s*\d)/i);
  let testNum = 0;
  for (const tb of testBlocks) {
    const tm = tb.match(/Test\s*(\d)/i);
    if (tm) testNum = parseInt(tm[1],10);
    if (!testNum) continue;
    // 抓 Part 1-4 答案
    const partAns = {};
    const partRe = /Part\s*(\d)[,\s]*Questions?\s*(\d+)\s*[-–]\s*(\d+)([\s\S]*?)(?=Part\s*\d[,\s]*Questions|Reading|$)/gi;
    let pm;
    while ((pm = partRe.exec(tb)) !== null) {
      const pn = parseInt(pm[1],10);
      if (pn < 1 || pn > 4) continue;
      const body = pm[4];
      // 抽取答案 token：单字母 / 数字 / 单词
      const tokens = body.split(/\n|·|•|-\s/).map(s=>s.trim())
        .filter(s => s && !/Questions|Part|answer|key|Resource/i.test(s) && s.length < 40);
      partAns[pn] = tokens;
    }
    if (Object.keys(partAns).length) tests[testNum] = partAns;
  }
  return tests;
}

function detectBookTitle(fullText) {
  const m = fullText.match(/Cambridge\s+IELTS\s+\d+|IELTS\s+\d+\s+Academic/i);
  return m ? m[0] : 'Cambridge IELTS';
}

// 主函数：返回每个 Test 的原始脚本 + 答案（供 generate 阶段使用）
async function extractListening(buffer) {
  const fullText = await docxToText(buffer);
  const bookTitle = detectBookTitle(fullText);
  const audioText = sliceAudioscripts(fullText);
  const scriptTests = audioText ? splitAudioscripts(audioText) : {};
  const answerTests = extractAnswerKeys(fullText);

  // 合并
  const tests = {};
  for (const tn of new Set([...Object.keys(scriptTests), ...Object.keys(answerTests)])) {
    tests[tn] = { parts: {} };
    for (let pn = 1; pn <= 4; pn++) {
      tests[tn].parts[pn] = {
        script: scriptTests[tn]?.[pn]?.script || '',
        answers: answerTests[tn]?.[pn] || [],
      };
    }
  }
  return { bookTitle, tests };
}

module.exports = { extractListening, docxToText };
