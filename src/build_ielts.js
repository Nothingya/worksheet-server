/**
 * src/build_ielts.js  (v3)
 * Typography : Times New Roman · Main title 16pt · Section headers 13pt · Body 12pt
 * Line spacing: 1.15
 * Task 1     : right column shuffled (answer key updated accordingly)
 * PDF        : via soffice --headless
 * Design     : PW4-style with emoji icons, Name/Class/Date header, clean layout
 */
'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, LineRuleType,
} = require('docx');
const fs = require('fs'), path = require('path'), os = require('os');
const { execSync } = require('child_process');

// ── Typography ────────────────────────────────────────────────────────────────
const FONT = 'Times New Roman';
const SP   = { line: 276, lineRule: LineRuleType.AUTO };
const T16  = 32;   // 16 pt – main title only
const T13  = 26;   // 13 pt – section/task headers
const T12  = 24;   // 12 pt – all body text

// ── Colours ───────────────────────────────────────────────────────────────────
// Student
const S_ACCENT = '1A5276';   // dark blue header bars
const S_LIGHT  = 'D6EAF8';   // light blue cell fill
const S_MID    = 'EBF5FB';   // very light
// Teacher
const T_ACCENT = '7B241C';   // dark red
const T_LIGHT  = 'FADBD8';
const T_MID    = 'FDEDEC';

// ── Borders ───────────────────────────────────────────────────────────────────
const B1  = { style: BorderStyle.SINGLE, size: 4,  color: 'BBBBBB' };
const B0  = { style: BorderStyle.NONE,   size: 0,  color: 'FFFFFF' };
const brd  = { top:B1, bottom:B1, left:B1, right:B1 };
const brd0 = { top:B0, bottom:B0, left:B0, right:B0 };

const PAGE = { size:{ width:11906, height:16838 },   // A4
               margin:{ top:900, right:900, bottom:900, left:900 } };

// ══ Helpers ═══════════════════════════════════════════════════════════════════
function r(text, o={}) {
  return new TextRun({ text, font:FONT,
    size:   o.sz    || T12,
    bold:   o.bold  || false,
    italics:o.ital  || false,
    color:  o.color || '000000',
  });
}
function p(text, o={}) {
  return new Paragraph({
    children: [r(text, o)],
    spacing: { ...SP, before:o.before||80, after:o.after||80 },
    alignment: o.align || AlignmentType.LEFT,
    pageBreakBefore: o.pgbrk || false,
  });
}
function pRuns(runs, o={}) {
  return new Paragraph({ children:runs,
    spacing: { ...SP, before:o.before||80, after:o.after||80 },
    alignment: o.align || AlignmentType.LEFT });
}

// Full-width header bar with emoji + text
function taskBar(emoji, label, accent) {
  return new Table({
    width:{ size:9360, type:WidthType.DXA }, columnWidths:[9360],
    rows:[ new TableRow({ children:[ new TableCell({
      borders:brd0,
      shading:{ fill:accent, type:ShadingType.CLEAR },
      margins:{ top:120, bottom:120, left:200, right:200 },
      children:[new Paragraph({
        children:[ r(emoji + '  ' + label, { sz:T13, bold:true, color:'FFFFFF' }) ],
        spacing:{ ...SP, before:0, after:0 },
      })],
    })]}), ],
  });
}

function td(text, o={}) {   // table cell
  return new TableCell({
    borders: o.nob ? brd0 : brd,
    width:   o.w   ? { size:o.w, type:WidthType.DXA } : undefined,
    shading: o.fill? { fill:o.fill, type:ShadingType.CLEAR } : undefined,
    margins: { top:80, bottom:80, left:120, right:120 },
    children:[new Paragraph({
      children:[ r(text,{ sz:o.sz||T12, bold:false, color:o.color||'000000', ital:o.ital||false }) ],
      alignment: o.align || AlignmentType.LEFT,
      spacing:{ ...SP, before:40, after:40 },
    })],
  });
}
function tdParas(paras, o={}) {
  return new TableCell({
    borders: o.nob ? brd0 : brd,
    width:   o.w   ? { size:o.w, type:WidthType.DXA } : undefined,
    shading: o.fill? { fill:o.fill, type:ShadingType.CLEAR } : undefined,
    margins: { top:80, bottom:80, left:120, right:120 },
    children: paras,
  });
}
function hdrRow(labels, widths, fill) {
  return new TableRow({ children: labels.map((l,i) =>
    new TableCell({
      borders:brd, width:{ size:widths[i], type:WidthType.DXA },
      shading:{ fill, type:ShadingType.CLEAR },
      margins:{ top:80, bottom:80, left:120, right:120 },
      children:[new Paragraph({ children:[r(l,{sz:T12,bold:true})],
        spacing:{...SP,before:40,after:40} })],
    })
  )});
}

// ── Title block + Name/Class/Date ─────────────────────────────────────────────
function titleBlock(pi, role) {
  const book  = pi.bookCode || 'C?';
  const tNum  = (pi.test    ||'Test 1'          ).replace('Test ','');
  const pNum  = (pi.passage ||'READING PASSAGE 1').replace('READING PASSAGE ','');
  const main  = `IELTS ${book}  ·  Test ${tNum}  ·  Reading Passage ${pNum}`;
  const sub   = pi.title || '';
  const accent = role==='student' ? S_ACCENT : T_ACCENT;
  const roleStr = role==='student'
    ? 'Student Handout  ·  B1–C1  ·  Target Band 7–7.5'
    : "Teacher's Answer Key  ·  For Instructor Use Only";

  const rows = [
    // Main title bar
    new Table({
      width:{size:9360,type:WidthType.DXA},columnWidths:[9360],
      rows:[new TableRow({children:[new TableCell({
        borders:brd0, shading:{fill:accent,type:ShadingType.CLEAR},
        margins:{top:160,bottom:160,left:300,right:300},
        children:[
          new Paragraph({ children:[r(main,{sz:T16,bold:true,color:'FFFFFF'})],
            alignment:AlignmentType.CENTER, spacing:{...SP,before:0,after:60} }),
          new Paragraph({ children:[r(sub, {sz:T12,ital:true,color:'D0D0D0'})],
            alignment:AlignmentType.CENTER, spacing:{...SP,before:0,after:0} }),
        ],
      })]}),],
    }),
  ];

  rows.push(p(''));
  return rows;
}

// ── Shuffle helpers ───────────────────────────────────────────────────────────
function _fisherYates(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * shufflePairs — 6-column Task 1 layout
 *
 * Fixed:   编号 1–6 (left) and 字母 A–F (right) are always in sequential order.
 * Shuffled: 题干表达 (question expressions) and 原文表达 (original expressions)
 *           are shuffled INDEPENDENTLY so that row i never has a matching pair.
 *
 * Returns:
 *   questionOrder[i]  = pair whose questionExpression sits in row i (numbered i+1)
 *   originalOrder[i]  = pair whose originalExpression sits in row i (lettered A+i)
 *   answers[i]        = the letter that number (i+1) should match, e.g. "C"
 *   answerSummary     = "1:C  2:B  3:F  4:A  5:E  6:D"
 */
function shufflePairs(pairs) {
  let questionOrder, originalOrder;
  let tries = 0;
  // Guarantee derangement: no row i can have same pair on both sides
  do {
    questionOrder = _fisherYates(pairs);
    originalOrder = _fisherYates(pairs);
    tries++;
  } while (tries < 30 && questionOrder.some((p, i) => p.id === originalOrder[i].id));

  // answers[i] = the letter of the row where questionOrder[i]'s original appears
  const answers = questionOrder.map(qPair => {
    const j = originalOrder.findIndex(o => o.id === qPair.id);
    return String.fromCharCode(65 + j);   // 0→A, 1→B, 2→C …
  });
  const answerSummary = answers.map((a, i) => `${i+1}:${a}`).join('   ');

  return { questionOrder, originalOrder, answers, answerSummary };
}

// Shuffle Task 6 headings: keep A-E labels fixed, shuffle the texts,
// remap section correct answers to new labels, build answer summary.
// Retries until no 3 consecutive section answers form a sequential run (A→B→C etc.)
function shuffleTask6(task6) {
  const headings = task6.headings || [];
  const sections = task6.sections || [];

  let displayHeadings, sectionAnswers;
  let tries = 0;

  do {
    // Shuffle the heading texts while A-E labels stay sequential
    const shuffledTexts = _fisherYates(headings);
    displayHeadings = shuffledTexts.map((h, i) => ({
      label:         String.fromCharCode(65 + i),
      text:          h.text,
      originalLabel: h.label,
    }));

    const labelRemap = {};
    displayHeadings.forEach(dh => { labelRemap[dh.originalLabel] = dh.label; });

    sectionAnswers = sections.map(sec => ({
      sectionLabel:  sec.sectionLabel || sec.sectionName || '',
      newAnswer:     labelRemap[sec.correctHeading] || sec.correctHeading || '?',
      matchingLogic: sec.matchingLogic || '',
    }));

    tries++;
  } while (tries < 50 && _hasSequentialRun(sectionAnswers));

  const answerSummary   = sectionAnswers.map(s => `${s.sectionLabel}: ${s.newAnswer}`).join('   ');
  const distractorLabel = (()=>{
    const remap={};displayHeadings.forEach(dh=>{remap[dh.originalLabel]=dh.label;});
    return remap[task6.distractorLabel] || task6.distractorLabel || '';
  })();

  return { displayHeadings, sectionAnswers, answerSummary, distractorLabel };
}

// Sort sections by Roman numeral / Arabic number in label
function _sectionOrder(label) {
  const rom={I:1,II:2,III:3,IV:4,V:5};
  const m=(label||'').match(/([IVX]+|\d+)\s*$/i);
  if(!m)return 0;
  return rom[m[1].toUpperCase()]||parseInt(m[1])||0;
}

// Returns true if any two ADJACENT sections (sorted by section order) have consecutive letter answers
function _hasSequentialRun(sectionAnswers) {
  const pairs=[...sectionAnswers]
    .filter(s=>s&&s.newAnswer&&/^[A-E]$/.test(s.newAnswer))
    .sort((a,b)=>_sectionOrder(a.sectionLabel)-_sectionOrder(b.sectionLabel));
  if(pairs.length<2)return false;
  const c=pairs.map(s=>s.newAnswer.charCodeAt(0));
  for(let i=0;i<c.length-1;i++){
    if(Math.abs(c[i+1]-c[i])===1)return true; // ANY 2 consecutive letters
  }
  return false;
}

// ══ STUDENT DOC ════════════════════════════════════════════════════════════════
function buildStudentDoc(data) {
  const { passageInfo:pi, task1, task2, task3, task4, task5, task6 } = data;
  const ch = [...titleBlock(pi,'student')];

  // ── Task 1: 6-column table ─────────────────────────────────────────────────
  // 编号(1-6 fixed) | 题干表达(shuffled) | 字母(A-F fixed) | 原文表达(shuffled) | 答案 | 改写策略
  // Both content columns are independently shuffled — guaranteed no row has a matching pair.
  ch.push(taskBar('🔄','Task 1  同义替换矩阵  (Paraphrasing Matrix)', S_ACCENT));
  ch.push(p(task1.instruction_zh,{ital:true,before:80,after:100}));
  const { questionOrder, originalOrder, answers, answerSummary } = data._shuffledTask1 || shufflePairs(task1.pairs||[]);
  const t1cw = [560, 3280, 480, 4240, 800];
  const t1rows = [hdrRow(['编号','题干表达','字母','原文表达','答案'], t1cw, S_LIGHT)];
  questionOrder.forEach((qPair, i) => {
    const letter = String.fromCharCode(65 + i);
    t1rows.push(new TableRow({children:[
      td(String(i+1),                                      {w:t1cw[0], align:AlignmentType.CENTER}),
      td(qPair.questionExpression||qPair.paraphrase||'',   {w:t1cw[1], ital:true}),
      td(letter,                                           {w:t1cw[2], align:AlignmentType.CENTER}),
      td(originalOrder[i].originalExpression || originalOrder[i].paraphrase || originalOrder[i].questionExpression || '', {w:t1cw[3]}),
      td('____',                                           {w:t1cw[4], align:AlignmentType.CENTER}),
    ]}));
  });
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:t1cw,rows:t1rows}),p(''));

  // ── Task 2 ──────────────────────────────────────────────────────────────────
  ch.push(taskBar('✂️','Task 2  剔骨疗法  (Skeleton Extraction)', S_ACCENT));
  ch.push(p(task2.instruction_zh,{ital:true,before:80,after:100}));
  const t2rows = [hdrRow(['#','原句与答题区'],[400,8960],S_LIGHT)];
  (task2.sentences||[]).forEach(s => {
    t2rows.push(new TableRow({children:[
      td(String(s.id),{w:400,align:AlignmentType.CENTER}),
      tdParas([
        new Paragraph({children:[r(s.original,{ital:true})], spacing:{...SP,before:40,after:40}}),
        new Paragraph({children:[r('Core subject: _________________________________')],spacing:{...SP,before:40,after:20}}),
        new Paragraph({children:[r('Core verb phrase: _________________________________')],spacing:{...SP,before:20,after:60}}),
      ],{w:8960}),
    ]}));
  });
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[400,8960],rows:t2rows}),p(''));

  // ── Task 3 ──────────────────────────────────────────────────────────────────
  ch.push(taskBar('🔍','Task 3  指代追踪  (Reference Tracking)', S_ACCENT));
  ch.push(p(task3.instruction_zh,{ital:true,before:80,after:100}));
  const t3rows = [hdrRow(['#','含指代词的原句【目标词加【】】','原文指代内容（QUOTE）'],[400,5200,3760],S_LIGHT)];
  (task3.items||[]).forEach(item => {
    t3rows.push(new TableRow({children:[
      td(String(item.id),{w:400,align:AlignmentType.CENTER}),
      td(item.sentenceWithTarget,{w:5200,ital:true}),
      tdParas([
        new Paragraph({children:[r('QUOTE: ________________________________')],spacing:{...SP,before:40,after:20}}),
        new Paragraph({children:[r('解释: ________________________________')],spacing:{...SP,before:20,after:40}}),
      ],{w:3760}),
    ]}));
  });
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[400,5200,3760],rows:t3rows}),p(''));

  // ── Task 4 ──────────────────────────────────────────────────────────────────
  ch.push(taskBar('⚖️','Task 4  逻辑陷阱鉴赏  (T/F/NG Discrimination)', S_ACCENT));
  ch.push(p('判断 False 还是 Not Given，圈出关键词并用 1–2 句解释。',{ital:true,before:80,after:100}));
  (task4.truthSentences||[]).forEach((ts,ti) => {
    ch.push(p(`【真理句 ${ti+1}】`,{bold:true,before:120,after:40}));
    ch.push(new Paragraph({children:[r(`"${ts.originalTruth}"`,{ital:true,color:'2C3E50'})],spacing:{...SP,before:40,after:80}}));
    const rows=[hdrRow(['#','陈述','F / NG？','错误/无据点分析'],[400,4960,1600,2400],S_LIGHT)];
    (ts.statements||[]).forEach(st => {
      rows.push(new TableRow({children:[
        td(`(${st.label})`,{w:400,align:AlignmentType.CENTER}),
        td(st.text,        {w:4960}),
        td('',             {w:1600}),
        td('',             {w:2400}),
      ]}));
    });
    ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[400,4960,1600,2400],rows}),p(''));
  });

  // ── Task 5 — Section outline with details ────────────────────────────────────
  ch.push(taskBar('🗺️','Task 5  段落细节填空  (Section Outline)', S_ACCENT));
  ch.push(p(task5.instruction_zh,{ital:true,before:80,after:100}));
  _sectionOutlineStudent(ch, task5, S_ACCENT, S_LIGHT, S_MID);
  ch.push(p('※ 每空不超过 3 个词，必须来自原文，注意拼写。',{ital:true,color:'666666',before:60,after:160}));

  // ── Task 6 ──────────────────────────────────────────────────────────────────
  ch.push(taskBar('🏷️','Task 6  主旨匹配  (Heading Match)', S_ACCENT));
  ch.push(p(task6.instruction_zh,{ital:true,before:80,after:100}));
  const { displayHeadings, sectionAnswers } = data._shuffledTask6 || shuffleTask6(task6);

  // Heading table: A-E fixed labels, content shuffled
  const t6hrows=[hdrRow(['字母','标题内容'],[480,8880],S_LIGHT)];
  displayHeadings.forEach(h=>t6hrows.push(new TableRow({children:[
    td(h.label,{w:480,align:AlignmentType.CENTER,bold:true}),
    td(h.text, {w:8880}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[480,8880],rows:t6hrows}),p(''));

  // Answer blanks: Section I: ___  Section II: ___  ...
  const n = sectionAnswers.length || 4;
  const sw = Math.floor(9360/n);
  ch.push(new Table({
    width:{size:9360,type:WidthType.DXA},columnWidths:Array(n).fill(sw),
    rows:[
      new TableRow({children:sectionAnswers.map(s=>td(s.sectionLabel,{w:sw,fill:S_LIGHT,bold:true,align:AlignmentType.CENTER}))}),
      new TableRow({children:sectionAnswers.map(_=>td('____',{w:sw,align:AlignmentType.CENTER}))}),
    ],
  }),p(''));
  ch.push(p('干扰项: ____    理由: __________________________________________________',{before:40,after:200}));

  return mkDoc(ch);
}

// ══ TEACHER DOC ════════════════════════════════════════════════════════════════
function buildTeacherDoc(data) {
  const { passageInfo:pi, task1, task2, task3, task4, task5, task6 } = data;
  const ch = [...titleBlock(pi,'teacher')];

  // Task 1
  ch.push(taskBar('🔄','Task 1 — 同义替换矩阵  答案 & 解析',T_ACCENT));
  const { questionOrder, originalOrder, answers, answerSummary } = data._shuffledTask1 || shufflePairs(task1.pairs||[]);
  const t1cw = [480, 2560, 480, 2960, 720, 2160];
  const t1rows=[hdrRow(['编号','题干表达','字母','原文表达','答案','改写策略'],t1cw,T_LIGHT)];
  questionOrder.forEach((qPair, i) => {
    const letter = String.fromCharCode(65 + i);
    t1rows.push(new TableRow({children:[
      td(String(i+1),                                    {w:t1cw[0], align:AlignmentType.CENTER}),
      td(qPair.questionExpression||qPair.paraphrase||'', {w:t1cw[1], ital:true}),
      td(letter,                                         {w:t1cw[2], align:AlignmentType.CENTER}),
      td(originalOrder[i].originalExpression || originalOrder[i].paraphrase || originalOrder[i].questionExpression || '', {w:t1cw[3]}),
      td(answers[i],                                     {w:t1cw[4], align:AlignmentType.CENTER, color:T_ACCENT, bold:true}),
      td(qPair.strategy||'',                             {w:t1cw[5]}),
    ]}));
  });
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:t1cw,rows:t1rows}));
  ch.push(pRuns([
    r('答案速览：', {bold:true, color:T_ACCENT}),
    r(answerSummary, {bold:true}),
  ], {before:80, after:160}));

  // Task 2
  ch.push(taskBar('✂️','Task 2 — 剔骨疗法  答案 & 解析',T_ACCENT));
  const t2rows=[hdrRow(['#','核心主干','划去成分','语法考点'],[400,3200,2560,3200],T_LIGHT)];
  (task2.sentences||[]).forEach(s=>t2rows.push(new TableRow({children:[
    td(String(s.id),{w:400,align:AlignmentType.CENTER}),
    td(s.coreSkeleton,{w:3200,color:T_ACCENT}),
    td((s.modifiersToRemove||[]).join(' | '),{w:2560}),
    td(s.teacherNote,{w:3200}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[400,3200,2560,3200],rows:t2rows}),p(''));

  // Task 3
  ch.push(taskBar('🔍','Task 3 — 指代追踪  答案 & 解析',T_ACCENT));
  const t3rows=[hdrRow(['#','原文引用答案 (QUOTE)','考点解析'],[400,4160,4800],T_LIGHT)];
  (task3.items||[]).forEach(item=>t3rows.push(new TableRow({children:[
    td(String(item.id),{w:400,align:AlignmentType.CENTER}),
    td(item.answer,{w:4160,color:T_ACCENT}),
    td(item.teacherNote,{w:4800}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[400,4160,4800],rows:t3rows}),p(''));

  // Task 4
  ch.push(taskBar('⚖️','Task 4 — T/F/NG 逻辑陷阱  答案 & 解析',T_ACCENT));
  (task4.truthSentences||[]).forEach((ts,ti)=>{
    ch.push(p(`【真理句 ${ti+1}】`,{bold:true,before:120,after:40}));
    ch.push(new Paragraph({children:[r(`"${ts.originalTruth}"`,{ital:true,color:'555555'})],spacing:{...SP,before:40,after:80}}));
    const rows=[hdrRow(['#','答案','陷阱类型','错误点','教学要点'],[400,1200,1600,2960,3200],T_LIGHT)];
    (ts.statements||[]).forEach(st=>rows.push(new TableRow({children:[
      td(`(${st.label})`,{w:400,align:AlignmentType.CENTER}),
      td(st.answer,{w:1200,color:st.answer==='FALSE'?T_ACCENT:'1A5276',align:AlignmentType.CENTER}),
      td(st.trapType,{w:1600}),
      td(st.errorPoint,{w:2960}),
      td(st.teacherNote,{w:3200}),
    ]})));
    ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[400,1200,1600,2960,3200],rows}),p(''));
  });

  // Task 5
  ch.push(taskBar('🗺️','Task 5 — 段落细节填空  答案 & 解析',T_ACCENT));
  _sectionOutlineTeacher(ch,task5,T_ACCENT,T_LIGHT);
  ch.push(p(''));

  // Task 6
  ch.push(taskBar('🏷️','Task 6 — 主旨匹配  答案 & 解析',T_ACCENT));
  const { displayHeadings:t6dh, sectionAnswers:t6sa, answerSummary:t6sum, distractorLabel:t6dis } = data._shuffledTask6 || shuffleTask6(task6);
  // Heading reference table
  const t6hrows=[hdrRow(['字母','标题内容'],[480,8880],T_LIGHT)];
  t6dh.forEach(h=>t6hrows.push(new TableRow({children:[td(h.label,{w:480,align:AlignmentType.CENTER}),td(h.text,{w:8880,ital:true})]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[480,8880],rows:t6hrows}));
  // Answer summary line
  ch.push(pRuns([r('答案速览：',{bold:true,color:T_ACCENT}),r(t6sum,{bold:true})],{before:80,after:80}));
  // Section answer table
  const t6rows=[hdrRow(['Section','答案','匹配逻辑'],[1800,720,6840],T_LIGHT)];
  t6sa.forEach(sec=>t6rows.push(new TableRow({children:[
    td(sec.sectionLabel,{w:1800}),
    td(sec.newAnswer,{w:720,color:T_ACCENT,align:AlignmentType.CENTER,bold:true}),
    td(sec.matchingLogic,{w:6840}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[1800,720,6840],rows:t6rows}));
  ch.push(p(`干扰项：${t6dis}`,{color:T_ACCENT,before:120,after:60}));
  ch.push(p(task6.distractorExplanation||'',{color:'333333',before:40,after:160}));

  return mkDoc(ch);
}

// ══ Section Outline builders (Task 5) ════════════════════════════════════════
// Matches the format in the example image:
//   Section I (Para A & B)
//   • Detail sentence with (31)___ blank
//     ↓ (Connector label)
//   • Next detail with (32)___ blank

function _sectionOutlineStudent(ch, t5={}, accent, fill1, fill2) {
  // Matches image-3 format:
  // TITLE (bold)
  // Section I. (Para A & B)  ← bold inline
  // • sentence with (31)___ blank   ← bullet, number bold
  //   ↓ (Connector)                 ← small blue box
  // • next detail...

  // Article title (from passageInfo if available — skip here, use section structure)
  const sections = t5.sections || [];

  sections.forEach(sec => {
    // Section header: bold text, not a table bar
    ch.push(new Paragraph({
      children: [
        r(sec.sectionLabel + '. ', {sz:T13, bold:true}),
        r('(' + sec.paragraphs + ')', {sz:T12, bold:false, color:'444444'}),
      ],
      spacing: {...SP, before:120, after:40},
    }));

    (sec.details||[]).forEach(detail => {
      // Parse the detail text: replace (31)___ with bold number + underscores
      const parts = detail.text.split(/(\(\d+\)_{0,}[_]+)/);
      const bulletRuns = [r('', {sz:T12})]; // empty first run (bullet is via indent)
      parts.forEach(part => {
        const blankMatch = part.match(/\((\d+)\)(_{3,})/);
        if (blankMatch) {
          bulletRuns.push(r(blankMatch[1] + '. ', {sz:T12, bold:true}));
          bulletRuns.push(r('_____________', {sz:T12}));
        } else if (part) {
          bulletRuns.push(r(part, {sz:T12}));
        }
      });

      ch.push(new Paragraph({
        children: bulletRuns,
        bullet: { level: 0 },
        spacing: {...SP, before:60, after:40},
      }));

      // Connectors removed — outline only
    });
    ch.push(p(''));
  });
}

function _sectionOutlineTeacher(ch, t5={}, accent, fill1) {
  const sections = t5.sections || [];
  const allDetails = sections.flatMap(sec =>
    (sec.details||[]).map(d => ({...d, sectionLabel:sec.sectionLabel}))
  );
  const rows = [hdrRow(['Section','题号','答案（原文词语）','原句上下文'],[1400,560,2400,5000],fill1)];
  let lastSection = '';
  allDetails.forEach(d => {
    rows.push(new TableRow({children:[
      td(d.sectionLabel !== lastSection ? d.sectionLabel : '', {w:1400, align:AlignmentType.CENTER}),
      td(String(d.id), {w:560, align:AlignmentType.CENTER}),
      td(d.answer, {w:2400, color:accent}),
      td(d.text, {w:5000}),
    ]}));
    lastSection = d.sectionLabel;
  });
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[1400,560,2400,5000],rows}));
}

// ══ Old flowchart builders (kept for backwards compat) ════════════════════════
function _flowchartStudent(ch, t5={}, accent, fill1, fill2) {
  // Tier 1
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[9360],
    rows:[new TableRow({children:[new TableCell({
      borders:brd, shading:{fill:fill1,type:ShadingType.CLEAR},
      margins:{top:100,bottom:100,left:200,right:200},
      children:[
        new Paragraph({children:[r('📌  Tier 1 — 篇章主旨 (Passage Theme)',{sz:T13,bold:true,color:accent})],spacing:{...SP,before:0,after:60}}),
        new Paragraph({children:[r(t5.tier1?.themeSentence||'________________',{sz:T12})],spacing:{...SP,before:0,after:0}}),
      ],
    })]}),],
  }));
  ch.push(new Paragraph({children:[r('▼',{sz:T12,color:accent})],alignment:AlignmentType.CENTER,spacing:{...SP,before:40,after:40}}));

  const t2=t5.tier2||[], t3=t5.tier3||[];
  t2.forEach(pg=>{
    const dets=(t3.find(d=>d.paragraphLabel===pg.paragraphLabel)||{}).details||[];
    // Gist row
    ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[520,8840],
      rows:[
        new TableRow({children:[
          new TableCell({borders:brd,shading:{fill:fill1,type:ShadingType.CLEAR},margins:{top:80,bottom:80,left:120,right:120},
            children:[new Paragraph({children:[r('§'+pg.paragraphLabel,{sz:T13,bold:true,color:accent})],spacing:{...SP,before:0,after:0}})]}),
          new TableCell({borders:brd,margins:{top:80,bottom:80,left:120,right:120},
            children:[new Paragraph({children:[r('主旨: '+pg.gistWithBlank,{sz:T12})],spacing:{...SP,before:0,after:0}})]}),
        ]}),
        ...dets.map((d,di)=>new TableRow({children:[
          new TableCell({borders:brd,shading:{fill:fill2,type:ShadingType.CLEAR},margins:{top:60,bottom:60,left:120,right:120},
            children:[new Paragraph({children:[r(di===0?'细节':'',{color:'999999'})],spacing:{...SP,before:0,after:0}})]}),
          new TableCell({borders:brd,margins:{top:60,bottom:60,left:120,right:120},
            children:[new Paragraph({children:[r(d.detailWithBlank,{sz:T12})],spacing:{...SP,before:0,after:0}})]}),
        ]})),
      ],
    }));
    ch.push(p(''));
  });
}

function _flowchartTeacher(ch, t5={}, accent, fill1, fill2) {
  ch.push(p('— Tier 1 篇章主旨 —',{bold:true,color:accent,before:80,after:40}));
  const b1rows=[hdrRow(['题号','答案','上下文'],[600,2400,6360],fill1)];
  (t5.tier1?.blanks||[]).forEach(b=>b1rows.push(new TableRow({children:[
    td(String(b.id),{w:600,align:AlignmentType.CENTER}),
    td(b.answer,{w:2400,color:accent}),
    td(b.context,{w:6360}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[600,2400,6360],rows:b1rows}),p(''));

  ch.push(p('— Tier 2 段落主旨 —',{bold:true,color:accent,before:80,after:40}));
  const b2rows=[hdrRow(['段落','题号','答案','完整主旨'],[560,600,2400,5800],fill1)];
  (t5.tier2||[]).forEach(pg=>b2rows.push(new TableRow({children:[
    td(pg.paragraphLabel,{w:560,align:AlignmentType.CENTER}),
    td(String(pg.blank?.id||''),{w:600,align:AlignmentType.CENTER}),
    td(pg.blank?.answer||'',{w:2400,color:accent}),
    td(pg.blank?.context||pg.gistWithBlank||'',{w:5800}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[560,600,2400,5800],rows:b2rows}),p(''));

  ch.push(p('— Tier 3 重要细节 —',{bold:true,color:accent,before:80,after:40}));
  const b3rows=[hdrRow(['段落','题号','答案','考点说明'],[560,600,2400,5800],fill1)];
  (t5.tier3||[]).forEach(pg=>(pg.details||[]).forEach((d,di)=>b3rows.push(new TableRow({children:[
    td(di===0?pg.paragraphLabel:'',{w:560,align:AlignmentType.CENTER}),
    td(String(d.id),{w:600,align:AlignmentType.CENTER}),
    td(d.answer,{w:2400,color:accent}),
    td(d.importance||'',{w:5800}),
  ]}))));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[560,600,2400,5800],rows:b3rows}));
}

// ══ Doc builder ════════════════════════════════════════════════════════════════
function mkDoc(children) {
  return new Document({
    styles:{ default:{ document:{ run:{ font:FONT, size:T12 } } } },
    sections:[{ properties:{ page:PAGE }, children }],
  });
}

// ══ PDF via soffice ════════════════════════════════════════════════════════════
// Find soffice — pm2 may have a restricted PATH
function findSoffice() {
  const candidates = [
    'soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/local/bin/soffice',
    '/usr/bin/soffice',
  ];
  for (const c of candidates) {
    try { execSync(`"${c}" --version`, { stdio:'pipe', timeout:5000 }); return c; }
    catch(_) {}
  }
  return null;
}

async function docxToPdf(buf) {
  const soffice = findSoffice();
  if (!soffice) throw new Error('soffice not found — PDF skipped');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'ielts-'));
  const dx  = path.join(tmp,'w.docx');
  const px  = path.join(tmp,'w.pdf');
  try {
    fs.writeFileSync(dx, buf);
    execSync(`"${soffice}" --headless --convert-to pdf --outdir "${tmp}" "${dx}"`,
             { timeout:90000, stdio:'pipe' });
    if (!fs.existsSync(px)) throw new Error('no pdf output');
    return fs.readFileSync(px);
  } finally { try{ fs.rmSync(tmp,{recursive:true}); }catch(_){} }
}

// ══ Main export ════════════════════════════════════════════════════════════════
async function buildIELTSDocs(data) {
  // Shuffle Task 1 and Task 6 ONCE so student and teacher versions are identical
  data._shuffledTask1 = shufflePairs((data.task1||{}).pairs||[]);
  data._shuffledTask6 = shuffleTask6(data.task6||{});

  const [sb, tb] = await Promise.all([
    Packer.toBuffer(buildStudentDoc(data)),
    Packer.toBuffer(buildTeacherDoc(data)),
  ]);
  let sp=null, tp=null;
  try { [sp,tp] = await Promise.all([docxToPdf(sb), docxToPdf(tb)]); }
  catch(e){ console.warn('[build_ielts] PDF skip:',e.message); }
  return { studentBuffer:sb, teacherBuffer:tb, studentPdf:sp, teacherPdf:tp };
}
module.exports = { buildIELTSDocs };
