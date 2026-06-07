'use strict';
// ═══════════════════════════════════════════════════════════════════
//  build_listening_ielts.js
//  数据驱动的 IELTS Listening 复盘 Worksheet 生成器
//  输入：listeningData (JSON, 见 data contract) → 输出：docx Buffer
//  兼容 worksheet-server（docx npm 库），与 build_ielts.js 并列
// ═══════════════════════════════════════════════════════════════════
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageBreak
} = require('docx');

// ── CONSTANTS ────────────────────────────────────────────────────
const PW = 9106;
const F  = 'Times New Roman';
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF', space: 0 };
const NO_BDR = { top: NB, bottom: NB, left: NB, right: NB, insideH: NB, insideV: NB };
const TN = (c) => ({ style: BorderStyle.SINGLE, size: 6,  color: c });
const TK = (c) => ({ style: BorderStyle.THICK,  size: 28, color: c, space: 8 });
const LS = { line: 276, lineRule: 'auto' };
const CM = { top: 100, bottom: 100, left: 160, right: 160 };
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚';
const C = {
  S1:'1E40AF', S1M:'2563EB', S2:'6D28D9', S2M:'7C3AED',
  S3:'065F46', S3M:'059669', S4:'92400E', S4M:'D97706',
  W:'FFFFFF', D:'1A1A2E', R:'DC2626', GR:'888888', WARN:'FEF9C3', WT:'713F12',
};
const SC = [null, // 1-indexed
  { main:C.S1, ph1:C.S1M, ph2:C.S1 },
  { main:C.S2, ph1:C.S2M, ph2:C.S2 },
  { main:C.S3, ph1:C.S3M, ph2:C.S3 },
  { main:C.S4, ph1:C.S4M, ph2:C.S4 },
];

// ── PRIMITIVES ───────────────────────────────────────────────────
const t = (s, o={}) => new TextRun({ text:s, font:F, size:24, color:C.D, ...o });
const b = (s, color=C.D, size=24) => new TextRun({ text:s, font:F, size, bold:true, color });
const it = (s, color='444444') => new TextRun({ text:s, font:F, size:22, italics:true, color });
const blk = () => new TextRun({ text:' _______________ ', font:F, size:24, underline:{ type:'single', color:'777777' } });
const numbBlk = (n) => [
  new TextRun({ text: CIRC[n-1], font:F, size:22, bold:true, color:C.S1 }),
  new TextRun({ text:'_______________', font:F, size:22, underline:{ type:'single', color:'777777' } }),
  new TextRun({ text:' ', font:F, size:22 }),
];
const dots = () => new TextRun({ text:'................................................................', font:F, size:24, color:'888888' });
const spkR = (name) => new TextRun({ text:`[${name}]  `, font:F, size:20, bold:true, color:C.GR });
const spc = (before=80, after=80, extra={}) => ({ before, after, ...LS, ...extra });
const sp = (before=160, after=0) => new Paragraph({ spacing: spc(before, after), children:[t('')] });
const oneBlank = () => [sp(160,0)];
const instr = (s) => new Paragraph({ spacing: spc(80,80), children:[it(s)] });
const pg = () => new Paragraph({ children:[new PageBreak()] });

// ── STRUCTURAL ───────────────────────────────────────────────────
function secHdr(pLabel, enTitle, zhTitle, emoji, color) {
  const w1 = Math.round(PW*0.86), w2 = PW-w1;
  return [ new Table({
      width:{ size:PW, type:WidthType.DXA }, columnWidths:[w1,w2], borders:NO_BDR,
      rows:[new TableRow({ children:[
        new TableCell({ shading:{ fill:color, type:ShadingType.CLEAR },
          margins:{ top:120, bottom:120, left:180, right:180 },
          width:{ size:w1, type:WidthType.DXA }, verticalAlign:VerticalAlign.CENTER,
          children:[
            new Paragraph({ spacing:spc(0,18), children:[new TextRun({ text:pLabel, font:F, size:18, bold:true, color:'BFDBFE' })] }),
            new Paragraph({ spacing:spc(0,10), children:[new TextRun({ text:enTitle, font:F, size:17, color:'BFDBFE' })] }),
            new Paragraph({ spacing:spc(0,0),  children:[new TextRun({ text:zhTitle, font:F, size:24, bold:true, color:C.W })] }),
          ]}),
        new TableCell({ shading:{ fill:color, type:ShadingType.CLEAR }, margins:CM,
          width:{ size:w2, type:WidthType.DXA }, verticalAlign:VerticalAlign.CENTER,
          children:[new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:emoji, size:52 })] })] }),
      ]})]
    }), sp(0,60) ];
}
function phBanner(text, color) {
  return [ new Table({
      width:{ size:PW, type:WidthType.DXA }, columnWidths:[PW], borders:NO_BDR,
      rows:[new TableRow({ children:[new TableCell({
        shading:{ fill:color, type:ShadingType.CLEAR },
        margins:{ top:70, bottom:70, left:160, right:160 }, width:{ size:PW, type:WidthType.DXA },
        children:[new Paragraph({ spacing:spc(0,0), children:[new TextRun({ text, font:F, size:28, bold:true, color:C.W })] })]
      })]})]
    }), sp(0,60) ];
}
function taskHdr(num, title, zh, bc) {
  return [
    new Paragraph({ spacing:spc(140,0), border:{ left:TK(bc) }, indent:{ left:120 },
      children:[ new TextRun({ text:`Task ${num}   `, font:F, size:22, bold:true, color:bc }),
                 new TextRun({ text:title, font:F, size:28, bold:true, color:C.D }) ] }),
    new Paragraph({ spacing:spc(0,80), border:{ left:TK(bc) }, indent:{ left:120 },
      children:[ new TextRun({ text:zh, font:F, size:22, color:'666666' }) ] }),
  ];
}
function mcqItem(num, qtext, opts) {
  return [
    new Paragraph({ spacing:spc(100,40), children:[b(`${num}.  `), t(qtext)] }),
    ...opts.map(([L,txt]) => new Paragraph({ spacing:spc(28,28), indent:{ left:480 },
      children:[b(`${L}  `), t(txt)] }))
  ];
}
function matchTable(rows, rightCol) {
  const w = [400, Math.round(PW*0.50), 400, Math.round(PW*0.36)];
  const bd = { top:TN('CCCCCC'), bottom:TN('CCCCCC'), left:TN('CCCCCC'), right:TN('CCCCCC') };
  const m2 = { top:60, bottom:60, left:100, right:100 };
  return [ new Table({
      width:{ size:w.reduce((a,v)=>a+v,0), type:WidthType.DXA }, columnWidths:w,
      rows: rows.map((item,i) => new TableRow({ children:[
        new TableCell({ borders:bd, margins:m2, width:{ size:w[0], type:WidthType.DXA },
          children:[new Paragraph({ alignment:AlignmentType.CENTER, children:[b(String(item.num))] })] }),
        new TableCell({ borders:bd, margins:m2, width:{ size:w[1], type:WidthType.DXA },
          children:[new Paragraph({ spacing:spc(0,0), children:[it(item.left)] })] }),
        new TableCell({ borders:bd, margins:m2, width:{ size:w[2], type:WidthType.DXA },
          children:[new Paragraph({ alignment:AlignmentType.CENTER,
            children:[new TextRun({ text:'  ___  ', font:F, size:22, underline:{type:'single'} })] })] }),
        new TableCell({ borders:bd, margins:m2, width:{ size:w[3], type:WidthType.DXA },
          children:[new Paragraph({ spacing:spc(0,0), children:[new TextRun({ text:rightCol[i], font:F, size:22 })] })] }),
      ]}))
    }), sp(0,60) ];
}
function dictLine(speaker, parts) {
  const runs = speaker ? [spkR(speaker)] : [];
  for (const p of parts) {
    if (typeof p === 'number') runs.push(...numbBlk(p));
    else runs.push(t(p));
  }
  return new Paragraph({ spacing:spc(48,48), children:runs });
}
function mmHead(emoji, title) {
  return new Paragraph({ spacing:spc(90,28),
    children:[ new TextRun({ text:`${emoji}  `, size:24 }), new TextRun({ text:title, font:F, size:24, bold:true, color:C.D }) ] });
}
function mmItem(parts) {
  const runs = [t('    •  ', { size:22 })];
  for (const p of parts) {
    if (p && p.b) runs.push(blk());
    else if (typeof p === 'string') runs.push(t(p, { size:22 }));
  }
  return new Paragraph({ spacing:spc(24,24), children:runs });
}
function sigMcq(num, qtext, opts) {
  return [
    new Paragraph({ spacing:spc(88,28), children:[b(`${num}.  `), it(qtext, C.D)] }),
    ...opts.map(([L,txt]) => new Paragraph({ spacing:spc(18,18), indent:{ left:440 },
      children:[b(`${L}  `), new TextRun({ text:txt, font:F, size:22 })] }))
  ];
}
function akRow(label, pairs) {
  const runs = [b(`${label}:  `,'444444')];
  for (const [n,ans] of pairs) {
    runs.push(new TextRun({ text:CIRC[n-1]+' ', font:F, size:22, bold:true }));
    runs.push(new TextRun({ text:ans+'   ', font:F, size:22, bold:true, color:C.R }));
  }
  return new Paragraph({ spacing:spc(50,50), children:runs });
}
function akSecHdr(label, color) {
  return [ new Table({ width:{ size:PW, type:WidthType.DXA }, columnWidths:[PW], borders:NO_BDR,
      rows:[new TableRow({ children:[new TableCell({
        shading:{ fill:color, type:ShadingType.CLEAR },
        margins:{ top:80, bottom:80, left:160, right:160 }, width:{ size:PW, type:WidthType.DXA },
        children:[new Paragraph({ spacing:spc(0,0), children:[new TextRun({ text:label, font:F, size:28, bold:true, color:C.W })] })]
      })]})] }), sp(0,60) ];
}
// chunk an answers array into rows of N for the AK
function akChunks(label3, arr, size=10) {
  const out = [];
  for (let i=0; i<arr.length; i+=size) {
    const slice = arr.slice(i, i+size).map((a, j) => [i+j+1, a]);
    const lab = i===0 ? `①–${CIRC[Math.min(i+size, arr.length)-1]}` : `${CIRC[i]}–${CIRC[Math.min(i+size, arr.length)-1]}`;
    out.push(akRow(lab, slice));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  DATA-DRIVEN PART BUILDERS
// ═══════════════════════════════════════════════════════════════════
const PART_META = {
  1: { en:'Everyday Conversation · Detail & Fact-Checking', emoji:'🗣️',
       ph1:'🔍  Phase 1  ·  Pre-Audio Review', ph2:'🎧  Phase 2  ·  Audio Re-listening Training' },
  2: { en:'Social Monologue · Synonyms & Spatial Reasoning', emoji:'🗺️',
       ph1:'🔍  Phase 1  ·  Pre-Audio Review', ph2:'🎧  Phase 2  ·  Audio Re-listening Training' },
  3: { en:'Academic Discussion · Pragmatics & Collocations', emoji:'🎓',
       ph1:'🔍  Phase 1  ·  Pre-Audio Review', ph2:'🎧  Phase 2  ·  Audio Re-listening Training' },
  4: { en:'Academic Lecture · Structure & Lexical Chunks', emoji:'🏫',
       ph1:'🔍  Phase 1  ·  Pre-Audio Review', ph2:'🎧  Phase 2  ·  Audio Re-listening Training' },
};

function buildPart1(d) {
  const col = SC[1], m = PART_META[1];
  const out = [ ...secHdr('PART 1', m.en, `${d.sceneEmoji||'📞'} ${d.scene}`, m.emoji, col.main),
    ...phBanner(m.ph1, col.ph1),
    ...taskHdr(1,'Listening Comprehension','Multiple Choice  (A / B / C)',col.main),
    instr('Choose the correct letter, A, B or C.') ];
  d.mcq.forEach((q,i) => out.push(...mcqItem(i+1, q.q, q.opts)));
  out.push(...oneBlank(), ...phBanner(m.ph2, col.ph2),
    ...taskHdr(2,'Fact-Checking Error Correction','Listen & Circle  ·  事实纠错', col.ph1),
    instr(`Listen to Part 1 again. There are ${d.errors.length} factual errors in the summary below. Circle each error as you hear it.`),
    sp(0,40),
    new Paragraph({ spacing:spc(80,80),
      border:{ top:TN('BAE6FD'), bottom:TN('BAE6FD'), left:TN('BAE6FD'), right:TN('BAE6FD') },
      shading:{ fill:'F0F9FF', type:ShadingType.CLEAR }, indent:{ left:120, right:120 },
      children:[ t(d.errorText) ] }),
    ...oneBlank(),
    ...taskHdr(3,'Intensive Dictation',`精听听写  ·  ${d.dictAnswers.length} blanks`,col.main),
    instr('Listen to Part 1 again. Fill in each blank with the missing word(s).'), sp(0,30));
  d.dictation.forEach(line => out.push(dictLine(line.speaker, line.parts)));
  out.push(sp(480,0), sp(0,0));
  return out;
}

function buildPart2(d) {
  const col = SC[2], m = PART_META[2];
  const out = [ ...secHdr('PART 2', m.en, `${d.sceneEmoji||'🏘️'} ${d.scene}`, m.emoji, col.main),
    ...phBanner(m.ph1, col.ph1),
    ...taskHdr(1,'Key Word Transformation','句型转换  ·  固定搭配',col.main),
    instr('Complete the second sentence so that it has a similar meaning to the first sentence, using the word given. Do not change the word given. Use between two and five words, including the word given.'),
    sp(0,40) ];
  d.kwt.forEach((q,i) => {
    out.push(new Paragraph({ spacing:spc(i?70:90,16), children:[b(`${i+1}   `), t(q.original)] }));
    out.push(new Paragraph({ spacing:spc(16,16), indent:{ left:360 }, children:[b(q.keyWord)] }));
    out.push(new Paragraph({ spacing:spc(16, i===d.kwt.length-1?80:70), indent:{ left:360 },
      children:[ t(q.transStart+'  '), dots(), t('  '+q.transEnd) ] }));
  });
  out.push(...oneBlank(),
    ...taskHdr(2,'Directional & Synonym Matching','方位词与同义替换连线  ·  Match 1–5 with A–E',col.ph1),
    instr('Match each phrase from the talk (1–5) with its closest paraphrase (A–E). Write the correct letter.'),
    ...matchTable(d.matching.rows, d.matching.options),
    ...oneBlank(), ...phBanner(m.ph2, col.ph2),
    ...taskHdr(3,'Spatial Dictation',`空间动线听写  ·  ${d.dictAnswers.length} blanks`,col.main),
    instr('Listen to Part 2 again. Fill in each blank. Focus on spatial references, movement verbs, and key activities.'), sp(0,30));
  d.dictation.forEach(line => out.push(dictLine(line.speaker, line.parts)));
  out.push(sp(480,0), sp(0,0));
  return out;
}

function buildPart3(d) {
  const col = SC[3], m = PART_META[3];
  const out = [ ...secHdr('PART 3', m.en, `${d.sceneEmoji||'💬'} ${d.scene}`, m.emoji, col.main),
    ...phBanner(m.ph1, col.ph1),
    ...taskHdr(1,'Pragmatic Function Matching','语用功能匹配  ·  5 items',col.main),
    instr('Match each extract (1–5) with the speaker\'s communicative function (A–E). Write the letter on the line.'),
    sp(0,30),
    new Paragraph({ spacing:spc(0,50), children:[ b('Functions:  '), t(d.functions) ] }) ];
  d.pragmatic.forEach((q,i) => out.push(new Paragraph({ spacing:spc(i?50:80, i===d.pragmatic.length-1?60:20),
    children:[ b(`${i+1}.  `), it(`"${q.quote}" — ${q.speaker}  `),
      t('→  '), new TextRun({ text:'___ ', font:F, size:24, underline:{type:'single'} }) ] })));
  out.push(...oneBlank(),
    ...taskHdr(2,'Logical Mind Map  —  Outline Format','逻辑思维导图填空  ·  原文词汇，每空 ≤ 3 词',col.ph1),
    instr('Fill in the blanks to complete the discussion outline. Use words from the recording only.'), sp(0,30));
  d.mindmap.forEach(sec => {
    out.push(mmHead(sec.emoji, sec.title));
    sec.items.forEach(item => out.push(mmItem(item)));
  });
  out.push(...oneBlank(), ...phBanner(m.ph2, col.ph2),
    ...taskHdr(3,'Academic Dictation',`学术听写  ·  ${d.dictAnswers.length} blanks  ·  No Word Bank`,col.main),
    instr('Listen to Part 3 and fill in each blank with the exact word(s) from the recording. No word bank, no letter hints, no word count provided.'), sp(0,30));
  d.dictation.forEach(line => out.push(dictLine(line.speaker, line.parts)));
  out.push(sp(480,0), sp(0,0));
  return out;
}

function buildPart4(d) {
  const col = SC[4], m = PART_META[4];
  const out = [ ...secHdr('PART 4', m.en, `${d.sceneEmoji||'🌊'} ${d.scene}`, m.emoji, col.main),
    ...phBanner(m.ph1, col.ph1),
    ...taskHdr(1,'Signpost Decoding','路标词逻辑功能判断  ·  5 questions (A / B / C)',col.main),
    instr('Each extract contains a discourse signpost. Choose A, B or C to describe its function in the lecture.') ];
  d.signpost.forEach((q,i) => out.push(...sigMcq(i+1, `"${q.quote}"`, q.opts)));
  out.push(...oneBlank(), ...phBanner(m.ph2, col.ph2),
    ...taskHdr(2,'Structural Mind Map','结构导图填空  ·  原文词汇，每空 ≤ 3 词',col.ph1),
    instr('Fill in the blanks. Use ONE, TWO or THREE words from the recording.'), sp(0,30));
  d.mindmap.forEach(sec => {
    out.push(mmHead(sec.emoji, sec.title));
    sec.items.forEach(item => out.push(mmItem(item)));
  });
  out.push(...oneBlank(),
    ...taskHdr(3,'Guided Dictation',`学术语块精听  ·  ${d.dictAnswers.length} blanks  ·  No Word Bank`,col.main),
    instr('Listen to Part 4. Fill in each blank with the missing word or phrase. No hints provided.'), sp(0,30));
  d.dictation.forEach(line => out.push(dictLine(line.speaker, line.parts)));
  out.push(sp(480,0), sp(0,0));
  return out;
}

function buildAnswerKey(data) {
  const out = [ sp(60,30),
    new Paragraph({ alignment:AlignmentType.CENTER, spacing:spc(0,12),
      children:[new TextRun({ text:'🔑  Answer Key  ·  教师版答案', font:F, size:36, bold:true, color:C.D })] }),
    new Paragraph({ alignment:AlignmentType.CENTER, spacing:spc(0,60),
      children:[new TextRun({ text:`${data.bookTitle}  ·  Test ${data.testNum} Listening  ·  Teacher Version`, font:F, size:22, color:'888888' })] }) ];
  const sceneEmoji = { 1:'📞', 2:'🏘️', 3:'💬', 4:'🍽️' };
  [1,2,3,4].forEach(pn => {
    const p = data.parts[pn], col = SC[pn].main;
    out.push(...akSecHdr(`${p.sceneEmoji||sceneEmoji[pn]}  Part ${pn} — ${p.scene}`, col));
    if (pn===1) {
      out.push(new Paragraph({ spacing:spc(50,30), children:[b('Task 1 · MCQ')] }),
        akRow('Answers', p.mcq.map((q,i)=>[i+1, q.answer])));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b(`Task 2 · Error Correction  (${p.errors.length} errors)`)] }),
        akRow('Errors', p.errors.map((e,i)=>[i+1, `${e.wrong} → ${e.correct}`])));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b(`Task 3 · Intensive Dictation  (${p.dictAnswers.length} blanks)`)] }),
        ...akChunks('', p.dictAnswers));
    } else if (pn===2) {
      out.push(new Paragraph({ spacing:spc(50,30), children:[b('Task 1 · Key Word Transformation')] }),
        akRow('Answers', p.kwt.map((q,i)=>[i+1, `${q.answer}  (${q.collocation})`])));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b('Task 2 · Directional Matching')] }),
        akRow('Answers', p.matching.answers.map((a,i)=>[i+1, a])));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b(`Task 3 · Spatial Dictation  (${p.dictAnswers.length} blanks)`)] }),
        ...akChunks('', p.dictAnswers));
    } else if (pn===3) {
      out.push(new Paragraph({ spacing:spc(50,30), children:[b('Task 1 · Pragmatic Function Matching')] }),
        akRow('Answers', p.pragmatic.map((q,i)=>[i+1, q.answer])));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b('Task 2 · Mind Map Blanks  (in order)')] }),
        new Paragraph({ spacing:spc(40,60), children:[new TextRun({ text:p.mindmapAnswers.join('  /  '), font:F, size:22, bold:true, color:C.R })] }));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b(`Task 3 · Academic Dictation  (${p.dictAnswers.length} blanks)`)] }),
        ...akChunks('', p.dictAnswers));
    } else {
      out.push(new Paragraph({ spacing:spc(50,30), children:[b('Task 1 · Signpost Decoding')] }),
        akRow('Answers', p.signpost.map((q,i)=>[i+1, q.answer])));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b('Task 2 · Mind Map Blanks  (in order)')] }),
        new Paragraph({ spacing:spc(40,60), children:[new TextRun({ text:p.mindmapAnswers.join('  /  '), font:F, size:22, bold:true, color:C.R })] }));
      out.push(new Paragraph({ spacing:spc(50,30), children:[b(`Task 3 · Guided Dictation  (${p.dictAnswers.length} blanks)`)] }),
        ...akChunks('', p.dictAnswers));
    }
    if (pn===2) out.push(pg());   // page break after Part 2 in AK
    else if (pn<4) out.push(sp(60,0));
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════
function buildListeningWorksheet(data) {
  // data = { bookTitle, testNum, parts:{1:{...},2:{...},3:{...},4:{...}} }
  const cover = [
    new Paragraph({ alignment:AlignmentType.CENTER, spacing:spc(0,8),
      children:[new TextRun({ text:`${data.bookTitle}  Test ${data.testNum}  —  Listening`, font:F, size:32, bold:true, color:C.D })] }),
    new Paragraph({ alignment:AlignmentType.CENTER, spacing:spc(0,120),
      children:[new TextRun({ text:'Review Worksheet  ·  全题型复盘练习', font:F, size:28, color:'555555' })] }),
  ];
  const doc = new Document({
    styles: { default: { document: { run: { font: F, size: 24, color: C.D } } } },
    numbering: { config: [] },
    sections: [{
      properties: { page: { size: { width:11906, height:16838 },
        margin: { top:1080, bottom:1080, left:1400, right:1400 } } },
      children: [
        ...cover,
        ...buildPart1(data.parts[1]),
        ...buildPart2(data.parts[2]),
        ...buildPart3(data.parts[3]),
        ...buildPart4(data.parts[4]),
        pg(),
        ...buildAnswerKey(data),
      ]
    }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildListeningWorksheet };
