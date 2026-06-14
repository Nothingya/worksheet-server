/**
 * src/pw3_regen.js
 * PW3 docx → 提取内容 → 用 PW4 builder 重新生成（输出纯正 PW4 样式）。
 * 内容来自 PW3 文档本身（不重新出题）；标题统一为 "PW3 RW U1A 类型" 格式（保留 U#A/B）。
 *
 * 支持四类：video / listening / vocab / reading
 */
'use strict';
const { readDocumentXml, parseBlocks, linesWithTables, findLine, partRegion, cleanNum } = require('./pw3_extract');
const { buildVideoDoc }     = require('./build_video');
const { buildListeningDoc } = require('./build_listening');
const { buildVocabDoc }     = require('./build_vocab');
const { buildBothDocs }     = require('./build');

// ── 类型识别（文件名优先）──────────────────────────────────────
function detectType(allText, filename = '') {
  const fn = String(filename);
  if (/词汇笔记|Core Vocabulary/.test(allText) || /词汇笔记/.test(fn)) return 'vocab';
  if (/Reading[_ ]?Practice/i.test(fn) || /Mind Map/.test(allText)) return 'reading';
  if (/Video[_ ]?Practice/i.test(fn)) return 'video';
  if (/Listening[_ ]?Practice/i.test(fn)) return 'listening';
  if (/Video Practice/.test(allText)) return 'video';
  if (/Listening Practice/.test(allText)) return 'listening';
  return null;
}

// ── 标题：PW3 RW U1A 类型 ───────────────────────────────────────
function makeTitle(filename, typeLabel) {
  const fn = filename.replace(/\.docx$/i, '').replace(/__+/g, '_');
  // 提取 PW3 / RW|LS / U#A/B
  const pw = (fn.match(/PW\d/i) || ['PW3'])[0].toUpperCase();
  const segM = fn.match(/[_ ](RW|LS)[_ ]/i);
  const seg = segM ? segM[1].toUpperCase() : '';
  const unit = (fn.match(/U\d+[AB]?/i) || ['U1'])[0].toUpperCase();
  return [pw, seg, unit, typeLabel].filter(Boolean).join(' ');
}

// 答案键解析：返回 {part1:[{number,answer,...}], ...}
// PW3 答案键各 Part 行格式不一，分类型处理。

// ════════════════════════════════════════════════════════════════
// VIDEO 提取
// ════════════════════════════════════════════════════════════════
function extractVideo(lines, tables) {
  const data = { part1: [], part2: [], part3: {}, part4: [], answers: {} };

  // P1: 题干 + A/B/C 选项
  const p1 = partRegion(lines, 1);
  if (p1) {
    let cur = null, num = 0;
    for (let i = p1[0] + 1; i < p1[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      if (/^[A-D][.)]/.test(t)) { if (cur) cur.options.push(t); }
      else { if (cur) data.part1.push(cur); num++; cur = { number: num, question: cleanNum(t), options: [] }; }
    }
    if (cur) data.part1.push(cur);
  }

  // P2: T/F/NG 陈述（行首可能有 _____）
  const p2 = partRegion(lines, 2);
  if (p2) {
    let num = data.part1.length;
    for (let i = p2[0] + 1; i < p2[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      const stmt = t.replace(/^[\d.:]*\s*_+\s*/, '').replace(/^_+\s*/, '').replace(/^\d+[.:]\s*/, '').trim();
      if (stmt) { num++; data.part2.push({ number: num, statement: stmt }); }
    }
  }

  // P3: 3列表格，第3列含 (N) 空
  const p3 = partRegion(lines, 3);
  if (p3) {
    const tIdx = findLineTable(lines, p3[0], p3[1]);
    if (tIdx !== -1) {
      const tbl = tables[tIdx];
      data.part3.col_headers = tbl[0] || ['Location / Subject', 'Observed Behavior', 'Details / Outcome'];
      data.part3.rows = tbl.slice(1).map(r => ({ col1: r[0] || '', col2: r[1] || '', col3: r[2] || '' }));
    }
  }

  // P4: 听写（speaker: text）—— 必须在 Answer Key 处停止
  const p4 = partRegion(lines, 4);
  if (p4) {
    const akIdx = findLine(lines, t => /Answer Key|答案/i.test(t));
    const end = (akIdx !== -1 && akIdx > p4[0] && akIdx < p4[1]) ? akIdx : p4[1];
    for (let i = p4[0] + 1; i < end; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      // 跳过 PW3 的说明句（不以 Instructions 开头，但含指令特征）
      if (/NO MORE THAN|Complete the (?:sentences|text|table)|Listen and (?:complete|fill)|Listen to the (?:passage|recording|text)/i.test(t)) continue;
      if (/Answer Key/i.test(t)) break;
      const m = t.match(/^([A-Z][a-zA-Z ]{0,20}):\s*(.+)$/);
      if (m) data.part4.push({ speaker: m[1], text: m[2] });
      else if (data.part4.length) data.part4[data.part4.length - 1].text += ' ' + t;
      else data.part4.push({ speaker: '', text: t });
    }
  }

  // 答案键
  data.answers = extractVideoAnswers(lines, data);
  return data;
}

function findLineTable(lines, from, to) {
  for (let i = from; i < to; i++) if (lines[i].isTable) return lines[i].idx;
  return -1;
}

function extractVideoAnswers(lines, data) {
  const ans = { part1: [], part2: [], part3: [], part4: [] };
  const akIdx = findLine(lines, t => /Answer Key|答案/i.test(t));
  if (akIdx === -1) return ans;
  // 答案键各 Part
  const region = (pn) => {
    const re = new RegExp(`Part\\s*${pn}[.:]`);
    const si = findLine(lines, t => re.test(t), akIdx);
    if (si === -1) return null;
    const nre = new RegExp(`Part\\s*${pn + 1}[.:]`);
    let ei = findLine(lines, t => nre.test(t), si + 1);
    if (ei === -1) ei = lines.length;
    return [si, ei];
  };
  // P1: 选项字母（A/B/C），可能带引文
  const r1 = region(1);
  if (r1) {
    let n = 0;
    for (let i = r1[0] + 1; i < r1[1]; i++) {
      const t = lines[i].text.trim();
      if (!t) continue;
      const m = t.match(/^(?:\d+[.:]\s*)?([A-D])\b/);
      if (m) { n++; ans.part1.push({ number: n, answer: m[1], quote: t.replace(/^(?:\d+[.:]\s*)?[A-D]\b[.)\s]*/, '').trim() }); }
    }
  }
  // P2: True/False/Not Given
  const r2 = region(2);
  if (r2) {
    let n = data.part1.length;
    for (let i = r2[0] + 1; i < r2[1]; i++) {
      const t = lines[i].text.trim();
      if (!t) continue;
      const m = t.match(/\b(True|False|Not Given|T|F|NG)\b/i);
      if (m) { n++; ans.part2.push({ number: n, answer: m[1], explanation: t.replace(/^(?:\d+[.:]\s*)?(?:True|False|Not Given|T|F|NG)[.)\s-]*/i, '').trim() }); }
    }
  }
  // P3: 表格答案（编号从 11 或接续）
  const r3 = region(3);
  if (r3) {
    for (let i = r3[0] + 1; i < r3[1]; i++) {
      const t = lines[i].text.trim();
      const m = t.match(/^(\d+)[.:]\s*(.+)$/);
      if (m) ans.part3.push({ number: +m[1], answer: m[2].trim() });
      else if (t && ans.part3.length === 0) { /* 无编号纯列表，后补 */ }
    }
    // 若无编号，按顺序补 11+
    if (ans.part3.length === 0) {
      let n = 11;
      for (let i = r3[0] + 1; i < r3[1]; i++) {
        const t = lines[i].text.trim();
        if (t) ans.part3.push({ number: n++, answer: t });
      }
    }
  }
  // P4: 听写答案
  const r4 = region(4);
  if (r4) {
    let n = 11 + ans.part3.length + (ans.part3.length ? 0 : 0);
    // P4 起号 = P3 末号 + 1
    const p3last = ans.part3.length ? ans.part3[ans.part3.length - 1].number : 18;
    n = p3last + 1;
    for (let i = r4[0] + 1; i < r4[1]; i++) {
      const t = lines[i].text.trim();
      if (!t) continue;
      const m = t.match(/^(\d+)[.:]\s*(.+)$/);
      if (m) ans.part4.push({ number: +m[1], answer: m[2].trim() });
      else ans.part4.push({ number: n++, answer: t });
    }
  }
  return ans;
}

// ════════════════════════════════════════════════════════════════
// LISTENING 提取（结构同 Video）
// ════════════════════════════════════════════════════════════════
function extractListening(lines, tables) {
  return extractVideo(lines, tables); // 结构一致
}

// ════════════════════════════════════════════════════════════════
// VOCAB 提取
// ════════════════════════════════════════════════════════════════
function extractVocab(lines, tables) {
  const data = { part1: [], part2: [], part3: [], part3_key: {}, part4: [] };

  // P1: 词条（word pos 中文 / 搭配 / 例句 / 派生词）
  const p1 = partRegion(lines, 1);
  if (p1) {
    let cur = null;
    for (let i = p1[0] + 1; i < p1[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions|Study the vocab/i.test(t)) continue;
      // 词条头：可选编号 + 词(可含空格短语) + 词性 + 中文
      const head = t.match(/^(?:\d+\.\s+)?(.+?)\s+(n\.|v\.|adj\.|adv\.|phrase|prep\.|conj\.|pron\.)\s+(.*)$/);
      if (head && /[\u4e00-\u9fff]/.test(head[3])) {
        if (cur) data.part1.push(cur);
        cur = { word: head[1].trim(), pos: head[2], chinese: head[3].trim(), collocations: [], example: null, derivatives: [] };
      } else if (cur) {
        if (/^派生词[:：]/.test(t)) {
          const ds = t.replace(/^派生词[:：]\s*/, '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
          cur.derivatives = ds.map(d => {
            const dm = d.match(/^(\S+)\s*\(([^)]*)\)/);
            return dm ? { word: dm[1], pos: '', zh: dm[2] } : { word: d, pos: '', zh: '' };
          });
        } else if (/[\u4e00-\u9fff]/.test(t) && /[a-zA-Z]/.test(t) && /\(/.test(t)) {
          // 搭配 "strong bond (牢固的纽带)"
          const cm = t.match(/^(.+?)\s*[（(]([^）)]*)[）)]\s*$/);
          if (cm && cur.collocations.length < 3) cur.collocations.push({ en: cm[1].trim(), zh: cm[2].trim() });
        } else if (!cur.example && /[a-zA-Z]/.test(t)) {
          cur.example = { en: t, zh: '' };
        } else if (cur.example && !cur.example.zh && /[\u4e00-\u9fff]/.test(t)) {
          cur.example.zh = t;
        }
      }
    }
    if (cur) data.part1.push(cur);
  }

  // P2: Word Formation 句子（PW3 多无编号、base_word 在答案键；以含 ___ 的句子为准）
  const p2 = partRegion(lines, 2);
  if (p2) {
    for (let i = p2[0] + 1; i < p2[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions|Complete the sent/i.test(t) || lines[i].isTable) continue;
      const withParen = t.match(/^(?:\d+\.\s*)?(.+?)\s*[（(]([^）)]*)[）)]\s*$/);
      if (withParen && /_{2,}/.test(withParen[1])) {
        data.part2.push({ sentence: withParen[1].trim(), base_word: withParen[2].trim() });
      } else if (/_{2,}/.test(t)) {
        data.part2.push({ sentence: t.replace(/^\d+\.\s*/, '').trim(), base_word: '' });
      }
    }
  }

  // P3: 匹配表（Word | Definition）
  const p3 = partRegion(lines, 3);
  if (p3) {
    const tIdx = findLineTable(lines, p3[0], p3[1]);
    if (tIdx !== -1) {
      const tbl = tables[tIdx];
      let n = 0;
      for (const r of tbl.slice(1)) {
        const wordCell = r[0] || '', defCell = r[1] || '';
        const wm = wordCell.match(/(?:\(\s*\)\s*)?(\d+)\.\s*(.+)/);
        const dm = defCell.match(/^([A-J])\.\s*(.+)/);
        if (wm) {
          n++;
          data.part3.push({ number: +wm[1], word: wm[2].trim(), letter: dm ? dm[1] : String.fromCharCode(64 + n), definition: dm ? dm[2].trim() : defCell });
        }
      }
    }
  }

  // P4: Quiz 句子（含 ___ 的句子；跳过词库单词行）+ 词库
  const p4 = partRegion(lines, 4);
  if (p4) {
    for (let i = p4[0] + 1; i < p4[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions|Fill in/i.test(t) || lines[i].isTable) continue;
      if (/_{2,}/.test(t)) data.part4.push({ sentence: t.replace(/^\d+\.\s*/, '').trim() });
    }
  }

  // 答案键
  extractVocabAnswers(lines, data);
  return data;
}

function extractVocabAnswers(lines, data) {
  const akIdx = findLine(lines, t => /Answer Key|答案/i.test(t));
  if (akIdx === -1) return;
  const region = (label) => {
    const si = findLine(lines, t => t.includes(label), akIdx);
    if (si === -1) return null;
    let ei = lines.length;
    for (const nx of ['Part 2', 'Part 3', 'Part 4']) {
      if (nx === label.slice(0, 6)) continue;
      const k = findLine(lines, t => t.includes(nx), si + 1);
      if (k !== -1 && k < ei) ei = k;
    }
    return [si, ei];
  };
  // P2 答案
  const r2 = region('Part 2');
  if (r2) {
    let i2 = 0;
    for (let i = r2[0] + 1; i < r2[1]; i++) {
      const t = lines[i].text.trim();
      if (!t) continue;
      const m = t.match(/^(?:\d+[.:]\s*)?(\S+)/);
      if (m && data.part2[i2]) { data.part2[i2].answer = m[1]; i2++; }
    }
  }
  // P3 key（编号→字母）；PW3 多为纯字母列表(D G J...)按顺序对应题号 1,2,3...
  const r3 = region('Part 3');
  if (r3) {
    let seq = 0;
    for (let i = r3[0] + 1; i < r3[1]; i++) {
      const t = lines[i].text.trim();
      if (!t) continue;
      const numbered = t.match(/^(\d+)[.:]\s*([A-J])\b/);
      if (numbered) { data.part3_key[+numbered[1]] = numbered[2]; }
      else {
        const letterOnly = t.match(/^([A-J])\s*$/);
        if (letterOnly) { seq++; data.part3_key[seq] = letterOnly[1]; }
      }
    }
  }
  // P4 答案
  const r4 = region('Part 4');
  if (r4) {
    let i4 = 0;
    for (let i = r4[0] + 1; i < r4[1]; i++) {
      const t = lines[i].text.trim();
      if (!t) continue;
      const m = t.match(/^(?:\d+[.:]\s*)?(\S+)/);
      if (m && data.part4[i4]) { data.part4[i4].answer = m[1]; i4++; }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// READING 提取（7 part，PW4 homework 格式）
// ════════════════════════════════════════════════════════════════
function extractReading(lines, tables) {
  // Reading 结构最复杂，PW3 用「数字+emoji」分节。这里提取为 PW4 homework JSON。
  // 由于 PW3 Reading 已接近 PW4（Q5 已 Prose Summary 等），做尽力提取。
  const hw = {
    part1: { sections: [] }, part2: { questions: [] }, part3: { statements: [] },
    part4: { word_bank: [], passage: '' }, part5: { title: '', lines: [], answers: [] },
    part6: { items: [] }, part7: { items: [] }
  };
  const answers = { part1: [], part2: [], part3: [], part4: [], part5: [], part6: [], part7: [] };

  // 用「数字. emoji」定位各节；所有节都在 Answer Key 处截断
  const akLine = findLine(lines, t => /^Answer Key|答案/i.test(t.trim()));
  const sec = (n) => {
    const re = new RegExp(`^\\s*${n}\\.\\s*[\\p{Emoji}]`, 'u');
    const si = findLine(lines, t => re.test(t));
    if (si === -1 || (akLine !== -1 && si >= akLine)) return null;
    const nre = new RegExp(`^\\s*${n + 1}\\.\\s*[\\p{Emoji}]`, 'u');
    let ei = findLine(lines, t => nre.test(t), si + 1);
    if (ei === -1 || (akLine !== -1 && ei > akLine)) ei = akLine !== -1 ? akLine : lines.length;
    return [si, ei];
  };

  // Part1 Mind Map：分小节(I. II.) + 带空的项
  const s1 = sec(1);
  if (s1) {
    let curSec = null;
    for (let i = s1[0] + 1; i < s1[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      if (/^[IVX]+\.\s/.test(t)) {
        if (curSec) hw.part1.sections.push(curSec);
        curSec = { emoji: '📌', title: t.replace(/^[IVX]+\.\s*/, ''), items: [] };
      } else if (curSec) {
        const bm = t.match(/^(.+?):\s*(.*)\((\d+)\)\s*_*(.*)$/);
        if (bm) curSec.items.push({ label: bm[1] + ':', before: bm[2].trim() + ' ', number: +bm[3], answer: '', after: bm[4].trim() });
        else curSec.items.push({ label: '', before: t, number: 0, answer: '', after: '' });
      }
    }
    if (curSec) hw.part1.sections.push(curSec);
  }

  // Part2 Reading Comprehension：MCQ + Q5 Prose Summary
  const s2 = sec(2);
  if (s2) {
    let cur = null;
    let pendingIntro = false;  // 上一行是 "Introductory Sentence:"，本行是引导句内容
    for (let i = s2[0] + 1; i < s2[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      if (pendingIntro) {
        // 引导句内容行（非选项、非新题号）
        if (cur && !/^[A-F][.)]/.test(t) && !/^\d+\./.test(t)) {
          cur.intro = (cur.intro ? cur.intro + ' ' : '') + t;
          pendingIntro = false;
          continue;
        }
        pendingIntro = false;
      }
      if (/^\d+\./.test(t)) {
        if (cur) hw.part2.questions.push(cur);
        const num = +t.match(/^(\d+)/)[1];
        cur = { number: num, type: /Prose Summary/i.test(t) ? 'Prose Summary' : 'Detail', question: cleanNum(t).replace(/\[Prose Summary\]\s*/i, '').trim(), options: [] };
      } else if (/^Introductory Sentence/i.test(t)) {
        const inline = t.replace(/^Introductory Sentence\s*[:：]\s*/i, '').trim();
        if (inline && cur) cur.intro = inline;       // 同行有内容
        else pendingIntro = true;                     // 内容在下一行
      } else if (/^[A-F][.)]/.test(t) && cur) {
        cur.options.push(t);
      }
    }
    if (cur) hw.part2.questions.push(cur);
  }

  // Part3 T/F/NG：跳过 ·TRUE/·FALSE/·NOT GIVEN 定义说明行，只取 _______ 开头的真题
  const s3 = sec(3);
  if (s3) {
    let n = 0;
    for (let i = s3[0] + 1; i < s3[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      if (/^[·•]\s*(TRUE|FALSE|NOT GIVEN)/i.test(t)) continue;  // 定义说明行，跳过
      const stmt = t.replace(/^_+\s*/, '').replace(/^\d+[.:]\s*/, '').trim();
      if (stmt && !/^(TRUE|FALSE|NOT GIVEN)\b/i.test(stmt)) { n++; hw.part3.statements.push({ number: n, text: stmt }); }
    }
  }

  // Part4 Summary Completion：Word Bank（表格或字母列表）+ passage
  const s4 = sec(4);
  if (s4) {
    const parts = [];
    let inBank = false;
    for (let i = s4[0] + 1; i < s4[1]; i++) {
      if (lines[i].isTable) {
        // Word Bank 表格：每单元格 "A. Dome" → 取词
        for (const cell of (tables[lines[i].idx] || []).flat()) {
          const m = cell.match(/^[A-Z]\.\s*(.+)$/);
          if (m) hw.part4.word_bank.push(m[1].trim());
          else if (cell.trim()) hw.part4.word_bank.push(cell.trim());
        }
        inBank = false;
        continue;
      }
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      if (/Word Bank|词库/i.test(t)) { inBank = true; continue; }
      const bankItem = t.match(/^[A-Z]\.\s*(.+)$/);
      if (inBank && bankItem) { hw.part4.word_bank.push(bankItem[1].trim()); continue; }
      inBank = false;
      parts.push(t);  // passage
    }
    hw.part4.passage = parts.join(' ');
  }

  // Part5 Cloze
  const s5 = sec(5);
  if (s5) {
    for (let i = s5[0] + 1; i < s5[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      hw.part5.lines.push(t);
    }
  }

  // Part6 Sentence Imitation：Original:"..." / (中文) / Your Task:中文 / Translation:___
  const s6 = sec(6);
  if (s6) {
    let cur = null;
    for (let i = s6[0] + 1; i < s6[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t) || /^Translation\s*[:：]/i.test(t)) continue;
      const orig = t.match(/^Original\s*[:：]\s*[""]?(.+?)[""]?\s*$/i);
      const task = t.match(/^Your Task\s*[:：]\s*(.+)$/i);
      if (orig) {
        if (cur && cur.original_en) hw.part6.items.push(cur);
        cur = { original_en: orig[1].trim(), original_zh: '', practice: '' };
      } else if (task && cur) {
        cur.practice = task[1].trim();
      } else if (cur && /[\u4e00-\u9fff]/.test(t) && !cur.original_zh) {
        cur.original_zh = t.replace(/^[（(]|[）)]$/g, '').trim();
      }
    }
    if (cur && cur.original_en) hw.part6.items.push(cur);
  }

  // Part7 Unscramble
  const s7 = sec(7);
  if (s7) {
    for (let i = s7[0] + 1; i < s7[1]; i++) {
      const t = lines[i].text.trim();
      if (!t || /^Instructions/i.test(t)) continue;
      if (/^\d+\./.test(t) || /\//.test(t)) {
        const chunks = cleanNum(t).split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
        if (chunks.length) hw.part7.items.push({ chunks, answer: chunks.join(' ') });
      }
    }
  }

  // 答案键：'1. Mind Map' / '2. Reading Comprehension' ... 分节 + 纯列表
  extractReadingAnswers(lines, answers, hw);

  return { title: '', homework: hw, blackboard: { sections: hw.part1.sections }, answers };
}

function extractReadingAnswers(lines, answers, hw) {
  const akIdx = findLine(lines, t => /^Answer Key|答案/i.test(t.trim()));
  if (akIdx === -1) return;
  // 各节起点（答案键内的 "N. 名称"）
  const secStart = (n, names) => {
    const re = new RegExp(`^\\s*${n}\\.\\s*(?:${names})`, 'i');
    return findLine(lines, t => re.test(t.trim()), akIdx);
  };
  const bounds = [
    secStart(1, 'Mind Map|🧠'), secStart(2, 'Reading Comp|📚'),
    secStart(3, 'True|✅'), secStart(4, 'Summary|🍀'),
    secStart(5, 'Fill|Cloze|🔤'), secStart(6, 'Sentence|🗣'),
    secStart(7, 'Unscramble|🔄')
  ];
  const collect = (idx, nextIdx) => {
    if (idx === -1) return [];
    const end = nextIdx === -1 ? lines.length : nextIdx;
    const out = [];
    for (let i = idx + 1; i < end; i++) {
      const t = lines[i].text.trim();
      if (t) out.push(t.replace(/^\d+[.:]\s*/, ''));
    }
    return out;
  };
  const nextValid = (arr, from) => { for (let k = from + 1; k < arr.length; k++) if (arr[k] !== -1) return arr[k]; return -1; };

  // P1 Mind Map 答案 → 按 number 配
  const a1 = collect(bounds[0], nextValid(bounds, 0));
  a1.forEach((ans, k) => answers.part1.push({ number: k + 1, answer: ans }));
  // P2 → 字母（C/D/...）含 Q5 多选
  const a2 = collect(bounds[1], nextValid(bounds, 1));
  a2.forEach((ans, k) => answers.part2.push({ number: k + 1, answer: ans }));
  // P3 → T/F/NG
  const a3 = collect(bounds[2], nextValid(bounds, 2));
  a3.forEach((ans, k) => answers.part3.push({ number: k + 1, answer: ans }));
  // P4 → 单词
  const a4 = collect(bounds[3], nextValid(bounds, 3));
  a4.forEach((ans, k) => answers.part4.push({ number: k + 1, answer: ans }));
  // P5 → 单词
  const a5 = collect(bounds[4], nextValid(bounds, 4));
  a5.forEach((ans, k) => answers.part5.push({ number: k + 1, answer: ans }));
  // P6 → 英译
  const a6 = collect(bounds[5], nextValid(bounds, 5));
  a6.forEach((ans, k) => answers.part6.push({ number: k + 1, answer: ans }));
  // P7 → 整句
  const a7 = collect(bounds[6], -1);
  a7.forEach((ans, k) => answers.part7.push({ number: k + 1, answer: ans }));
}

// ════════════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════════════
function fixMojibakeName(name) {
  if (!name) return name;
  try {
    const u = Buffer.from(name, 'latin1').toString('utf8');
    if (!u.includes('\uFFFD') && /[\u0080-\u00ff]/.test(name)) return u;
  } catch (e) {}
  return name;
}

const TYPE_LABEL = { video: 'Video Practice', listening: 'Listening Practice', vocab: '词汇笔记', reading: 'Reading Homework' };

/**
 * @param {Buffer} buffer
 * @param {string} originalname
 * @returns {Promise<{buffer, type, newName, warnings}>}
 */
async function regenFromPW3(buffer, originalname) {
  originalname = fixMojibakeName(originalname);
  const xml = readDocumentXml(buffer);
  const blocks = parseBlocks(xml);
  const { lines, tables } = linesWithTables(blocks);
  const allText = lines.map(l => l.text).join('\n');
  const type = detectType(allText, originalname);
  if (!type) throw new Error('无法识别 PW3 文档类型');

  const title = makeTitle(originalname, TYPE_LABEL[type]);
  const warnings = [];
  let buf;

  if (type === 'video') {
    const data = extractVideo(lines, tables); data.title = title;
    if (!data.part1.length) warnings.push('P1 未提取到题目');
    buf = await buildVideoDoc(data);
  } else if (type === 'listening') {
    const data = extractListening(lines, tables); data.title = title;
    if (!data.part1.length) warnings.push('P1 未提取到题目');
    buf = await buildListeningDoc(data);
  } else if (type === 'vocab') {
    const data = extractVocab(lines, tables); data.title = title;
    if (!data.part1.length) warnings.push('P1 词条未提取到');
    buf = await buildVocabDoc(data);
  } else if (type === 'reading') {
    const data = extractReading(lines, tables); data.title = title;
    const { homeworkBuffer } = await buildBothDocs(data);
    buf = homeworkBuffer;
    if (!data.homework.part2.questions.length) warnings.push('P2 题目未提取到');
  }

  const newName = originalname.replace(/__+/g, '_').replace(/\.docx$/i, '_PW4重生成.docx');
  return { buffer: buf, type, newName, warnings, title };
}

module.exports = { regenFromPW3, detectType, extractVideo, extractVocab, extractReading };
