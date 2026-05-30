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

// ── Shuffle helper ────────────────────────────────────────────────────────────
function shufflePairs(pairs) {
  const indices = pairs.map((_,i) => i);
  for (let i = indices.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const displayRight = indices.map((origIdx,slot) => ({
    displayNum:       slot+1,
    originalExpression: pairs[origIdx].originalExpression || pairs[origIdx].paraphrase || '',
    paraphrase:       pairs[origIdx].paraphrase || '',
    strategy:         pairs[origIdx].strategy,
    origId:           pairs[origIdx].id,
    teacherNote:      pairs[origIdx].teacherNote,
  }));
  const answerMap = {};
  displayRight.forEach(slot => { answerMap[slot.origId] = slot.displayNum; });
  return { displayRight, answerMap };
}

// ══ STUDENT DOC ════════════════════════════════════════════════════════════════
function buildStudentDoc(data) {
  const { passageInfo:pi, task1, task2, task3, task4, task5, task6 } = data;
  const ch = [...titleBlock(pi,'student')];

  // ── Task 1: LEFT=questionExpression, RIGHT=originalExpression (shuffled) ─────
  ch.push(taskBar('🔄','Task 1  同义替换矩阵  (Paraphrasing Matrix)', S_ACCENT));
  ch.push(p(task1.instruction_zh,{ital:true,before:80,after:100}));
  const { displayRight, answerMap } = data._shuffledTask1 || shufflePairs(task1.pairs||[]);
  const t1 = new Table({
    width:{size:9360,type:WidthType.DXA}, columnWidths:[480,3920,360,3880,720],
    rows:[
      hdrRow(['编号','题干表达 (A–F)','','原文表达 (1–6)','答案'],[480,3920,360,3880,720],S_LIGHT),
      ...(task1.pairs||[]).map((pair,i) => new TableRow({children:[
        td(pair.id,                           {w:480, align:AlignmentType.CENTER}),
        td(pair.questionExpression||pair.paraphrase||'', {w:3920,ital:true}),
        td(String(i+1),                       {w:360, align:AlignmentType.CENTER, color:'888888'}),
        td(displayRight[i].originalExpression||displayRight[i].paraphrase||'', {w:3880}),
        td('____',                            {w:720, align:AlignmentType.CENTER}),
      ]})),
    ],
  });
  ch.push(t1,p(''));

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
  const t6hrows=[hdrRow(['标题','内容'],[520,8840],S_LIGHT)];
  (task6.headings||[]).forEach(h=>t6hrows.push(new TableRow({children:[td(h.label,{w:520,align:AlignmentType.CENTER}),td(h.text,{w:8840})]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[520,8840],rows:t6hrows}),p(''));
  const n=(task6.sections||[]).length||4;
  const sw=Math.floor(9360/n);
  ch.push(new Table({
    width:{size:9360,type:WidthType.DXA},columnWidths:Array(n).fill(sw),
    rows:[
      new TableRow({children:(task6.sections||[]).map(sec=>td(sec.sectionLabel||sec.sectionName||'',{w:sw,fill:S_LIGHT}))}),
      new TableRow({children:(task6.sections||[]).map(_=>td('答案: ____',{w:sw,align:AlignmentType.CENTER}))}),
    ],
  }),p(''));
  ch.push(p('干扰项: ____    理由: __________________________________________________',{before:80,after:200}));

  return mkDoc(ch);
}

// ══ TEACHER DOC ════════════════════════════════════════════════════════════════
function buildTeacherDoc(data) {
  const { passageInfo:pi, task1, task2, task3, task4, task5, task6 } = data;
  const ch = [...titleBlock(pi,'teacher')];
  const { displayRight, answerMap } = data._shuffledTask1 || shufflePairs(task1.pairs||[]);

  // Task 1
  ch.push(taskBar('🔄','Task 1 — 同义替换矩阵  答案 & 解析',T_ACCENT));
  const t1rows=[hdrRow(['编号','题干表达（左栏）','答案','原文表达（右栏匹配）','改写策略'],[400,2800,520,3440,2200],T_LIGHT)];
  (task1.pairs||[]).forEach(pair=>{
    t1rows.push(new TableRow({children:[
      td(pair.id,{w:400,align:AlignmentType.CENTER}),
      td(pair.questionExpression||pair.paraphrase||'',{w:2800,ital:true}),
      td(`→ ${answerMap[pair.id]}`,{w:520,color:T_ACCENT,align:AlignmentType.CENTER}),
      td(pair.originalExpression||pair.paraphrase||'',{w:3440}),
      td(pair.strategy,{w:2200}),
    ]}));
  });
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[400,2800,520,3440,2200],rows:t1rows}));
  ch.push(p('右栏学生卷中的打乱顺序：',{ital:true,color:'888888',before:60,after:40}));
  const refRows=[hdrRow(['序号','原文表达（学生卷右栏顺序）'],[560,8800],T_LIGHT)];
  displayRight.forEach(slot=>refRows.push(new TableRow({children:[
    td(String(slot.displayNum),{w:560,align:AlignmentType.CENTER}),
    td(slot.originalExpression,{w:8800}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[560,8800],rows:refRows}),p(''));

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
  const t6rows=[hdrRow(['Section','答案','主旨 & 匹配逻辑'],[1800,720,6840],T_LIGHT)];
  (task6.sections||[]).forEach(sec=>t6rows.push(new TableRow({children:[
    td(sec.sectionLabel||sec.sectionName||'',{w:1800}),
    td(sec.correctHeading,{w:720,color:T_ACCENT,align:AlignmentType.CENTER}),
    td(sec.matchingLogic,{w:6840}),
  ]})));
  ch.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[1800,720,6840],rows:t6rows}));
  ch.push(p(`干扰项：${task6.distractorLabel}`,{color:T_ACCENT,before:120,after:60}));
  ch.push(p(task6.distractorExplanation,{color:'333333',before:40,after:160}));

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
  // Shuffle Task 1 ONCE so student and teacher versions are identical
  data._shuffledTask1 = shufflePairs((data.task1||{}).pairs||[]);

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
