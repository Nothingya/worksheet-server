// src/build.js  — Complete 7-part worksheet renderer
// Homework: Parts 1–7 + Answer Key
// Blackboard: Part 1 (2×2 grid) only

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageBreak
} = require('docx');

// ── colours ────────────────────────────────────────────────────
const RED  = 'C00000', BLUE = '1F4E79', GREY = '595959';

// ── border helpers ─────────────────────────────────────────────
const b = (c='999999', sz=6) => ({ style: BorderStyle.SINGLE, size: sz, color: c });
const allB = (bdr) => ({ top:bdr, bottom:bdr, left:bdr, right:bdr });
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noB = allB(noBorder);

// ── run / paragraph factories ──────────────────────────────────
const R = (text, opts={}) => new TextRun({ text, font:'Times New Roman', size:24, ...opts });
const expandBlanks = t => String(t||'').replace(/_{2,}/g, m => '_'.repeat(Math.max(20, m.length)));
const P = (children, opts={}) => new Paragraph({ spacing:{before:60,after:60,line:276}, children, ...opts });
const blank = () => P([R('')]);

const heading = (text, color=RED) => new Paragraph({
  spacing:{before:260,after:130},
  children:[R(text, {bold:true, size:28, color})]
});

const instruction = (text) => new Paragraph({
  spacing:{before:80,after:140},
  children:[R(text, {italics:true, color:GREY})]
});

const wordBankTable = (words) => {
  const cols=4;
  const rows=[];
  for(let i=0;i<words.length;i+=cols){
    const cells=[];
    for(let j=0;j<cols;j++){
      const w = words[i+j]||'';
      cells.push(new TableCell({
        borders: allB(b()),
        width:{size:2340, type:WidthType.DXA},
        margins:{top:100,bottom:100,left:120,right:120},
        shading:{fill:'FFF2CC', type:ShadingType.CLEAR},
        children:[new Paragraph({alignment:AlignmentType.CENTER,
          children:[R(w,{bold:true})]})]
      }));
    }
    rows.push(new TableRow({children:cells}));
  }
  return new Table({width:{size:9360,type:WidthType.DXA},
    columnWidths:[2340,2340,2340,2340], rows});
};

// ════════════════════════════════════════════════════════════════
// HOMEWORK VERSION — All 7 Parts
// ════════════════════════════════════════════════════════════════
function buildHomework(data) {
  const title  = data.title || 'Reading Worksheet';
  const hw     = data.homework || {};
  const ans    = data.answers || {};
  const ch = [];

  // ── Title block ───────────────────────────────────────────────
  ch.push(new Paragraph({
    alignment:AlignmentType.CENTER, spacing:{before:0,after:100},
    children:[R(title,{bold:true,size:32,color:RED})]
  }));
  ch.push(new Paragraph({
    alignment:AlignmentType.CENTER, spacing:{after:80},
    children:[R('Reading Practice',{italics:true,size:22,color:GREY})]
  }));
  // 新模板：不再显示 Name/Date 行

  // ─────────────────────────────────────────────────────────────
  // PART 1 — MIND MAP
  // ─────────────────────────────────────────────────────────────
  ch.push(heading('Part 1.  Mind Map  思维导图'));
  ch.push(instruction('Instructions: Complete the mind map below using words from the text. Use no more than 3 words for each blank.'));

  (hw.part1?.sections || []).forEach(sec => {
    ch.push(new Paragraph({
      spacing:{before:140,after:60},
      children:[R(`${sec.emoji}  `,{size:24}), R(sec.title,{bold:true,size:24})]
    }));
    (sec.items||[]).forEach(item => {
      ch.push(new Paragraph({
        spacing:{before:30,after:30,line:276},
        indent:{left:360,hanging:200},
        children:[
          R('•  '), R(`${item.label}  `,{bold:true}),
          ...(item.before?[R(item.before)]:[]),
          R(`(${item.number}) `,{bold:true}), R('____________________'),
          ...(item.after?[R(item.after)]:[])
        ]
      }));
    });
  });

  ch.push(new Paragraph({children:[new PageBreak()]}));

  // ─────────────────────────────────────────────────────────────
  // PART 2 — READING COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  ch.push(heading('Part 2.  Reading Comprehension  📖'));
  ch.push(instruction('Instructions: Read each question carefully and choose the best answer. For question 5, choose THREE correct options.'));

  (hw.part2?.questions || []).forEach(q => {
    const isMain = q.options && q.options.length === 6;
    if (isMain) {
      // 托福 Prose Summary 六选三格式
      ch.push(P([
        R(`${q.number}.  `,{bold:true}),
        R('[Prose Summary]  ',{bold:true,color:BLUE}),
        R('Directions: Complete the summary by selecting THREE answer choices that express the most important ideas in the passage.',{italics:true})
      ], {spacing:{before:120,after:80,line:276}}));
      const intro = q.intro || q.question || '';
      ch.push(P([
        R('Introductory Sentence: ',{bold:true}),
        R(intro,{italics:true})
      ], {spacing:{before:40,after:80,line:276}}));
      (q.options||[]).forEach(opt => {
        ch.push(P([R(`     ${opt}`)], {spacing:{before:40,after:40,line:276}}));
      });
      ch.push(P([
        R('Your Choice:  ',{bold:true}),
        R('[      ]    [      ]    [      ]')
      ], {spacing:{before:80,after:40,line:276}}));
    } else {
      ch.push(P([
        R(`${q.number}.  `,{bold:true}),
        R(q.question,{bold:true})
      ], {spacing:{before:120,after:60,line:276}}));
      (q.options||[]).forEach(opt => {
        ch.push(P([R(`     ${opt}`)], {spacing:{before:40,after:40,line:276}}));
      });
    }
    ch.push(blank());
  });

  // 新模板：P2→P3 不分页

  // ─────────────────────────────────────────────────────────────
  // PART 3 — TRUE / FALSE / NOT GIVEN
  // ─────────────────────────────────────────────────────────────
  ch.push(heading('Part 3.  True / False / Not Given  ✅'));
  ch.push(instruction('Instructions: Decide whether each statement is TRUE (T), FALSE (F), or NOT GIVEN (NG) according to the article. Write your answer on the line.'));

  (hw.part3?.statements || []).forEach(s => {
    ch.push(P([R(`${s.number}.  _____     `,{bold:true}), R(s.text)],
      {spacing:{before:80,after:80,line:276}}));
    ch.push(blank());
  });

  // ─────────────────────────────────────────────────────────────
  // PART 4 — SUMMARY COMPLETION
  // ─────────────────────────────────────────────────────────────
  ch.push(heading('Part 4.  Summary Completion  ✍️'));
  ch.push(instruction('Instructions: Complete the summary using words from the Word Bank. There are MORE words than blanks. Each word may be used ONCE only.'));

  if (hw.part4?.word_bank) {
    ch.push(new Paragraph({spacing:{before:100,after:80},
      children:[R('📦  Word Bank',{bold:true,size:24,color:BLUE})]}));
    ch.push(wordBankTable(hw.part4.word_bank));
    ch.push(blank());
  }
  if (hw.part4?.passage) {
    ch.push(P([R(expandBlanks(hw.part4.passage))], {spacing:{before:60,after:60,line:276}}));
  }

  // 新模板：P4→P5 不分页
  ch.push(new Paragraph({ spacing:{before:240,after:0,line:276}, children:[R('')] }));

  // ─────────────────────────────────────────────────────────────
  // PART 5 — FILL IN MISSING LETTERS
  // ─────────────────────────────────────────────────────────────
  ch.push(heading('Part 5.  Fill in the Missing Letters  🔤'));
  ch.push(instruction('Instructions: Read the passage and fill in the missing letters. The first letter(s) are given. Each underscore represents one missing letter.'));

  if (hw.part5?.title) {
    ch.push(new Paragraph({spacing:{before:100,after:80},
      children:[R(hw.part5.title,{bold:true,size:24,color:BLUE})]}));
  }

  (hw.part5?.lines || []).forEach(line => {
    // Render the line, making hint patterns bold
    // Pattern: letter(s) followed by _ _ _ _ (N) — bold the hint+underscores part
    const parts = line.split(/([a-zA-Z]{1,2}(?:_ )*_\s*\(\d+\))/g);
    const runs = [];
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        runs.push(R(part, {bold:true}));
      } else if (part) {
        runs.push(R(part));
      }
    });
    ch.push(P(runs, {spacing:{before:60,after:60,line:276}}));
  });

  // 新模板：P5→P6 不分页

  // ─────────────────────────────────────────────────────────────
  // PART 6 — SENTENCE IMITATION
  // ─────────────────────────────────────────────────────────────
  ch.push(heading('Part 6.  Sentence Imitation  ✒️'));
  ch.push(instruction('Instructions: Study each sentence and its Chinese translation. Then translate the new Chinese sentence below into English using a SIMILAR structure.'));

  (hw.part6?.items || []).forEach((item, i) => {
    const num = i + 1;
    ch.push(P([R(`${num}.  Original sentence:`,{bold:true,color:BLUE})],
      {spacing:{before:160,after:60}}));
    ch.push(P([R(`     ${item.original_en}`,{italics:true})]));
    ch.push(P([R(`     中文：${item.original_zh}`)]));
    ch.push(blank());
    // practice is now a single string (1 sentence)
    const practiceText = Array.isArray(item.practice) ? item.practice[0] : item.practice;
    if (practiceText) {
      ch.push(P([R('     ➤  请翻译以下中文：',{bold:true,color:RED})],
        {spacing:{before:60,after:40}}));
      ch.push(P([R(`     ${practiceText}`)],
        {spacing:{before:40,after:40}}));
      ch.push(P([R('     ________________________________________________________________________')],
        {spacing:{before:20,after:20}}));
      ch.push(P([R('     ________________________________________________________________________')],
        {spacing:{before:20,after:40}}));
    }
  });

  // 新模板：P6→P7 不分页
  ch.push(new Paragraph({ spacing:{before:240,after:0,line:276}, children:[R('')] }));

  // ─────────────────────────────────────────────────────────────
  // PART 7 — UNSCRAMBLE
  // ─────────────────────────────────────────────────────────────
  ch.push(heading('Part 7.  Unscramble the Sentences  🔀'));
  ch.push(instruction('Instructions: Rearrange the chunks below into a correct English sentence. Pay attention to grammar and meaning.'));

  // 新模板：相邻 1–3 词为一组，组间 / 分隔，无 [ ]
  function groupChunks(item) {
    const sentence = String(item.answer||'').trim();
    const words = sentence ? sentence.split(/\s+/) : (item.chunks||[]);
    const groups = [];
    let k = 0;
    while (k < words.length) {
      const take = Math.min(words.length - k, 1 + Math.floor(Math.random()*3));
      groups.push(words.slice(k, k+take).join(' '));
      k += take;
    }
    for (let i = groups.length-1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [groups[i],groups[j]] = [groups[j],groups[i]];
    }
    return groups;
  }
  (hw.part7?.items || []).forEach((item, i) => {
    const chunks = groupChunks(item).join('  /  ');
    ch.push(P([R(`${i+1}.  `,{bold:true}), R(chunks)],
      {spacing:{before:100,after:60}}));
    ch.push(P([R('     ➤  ________________________________________________________________')],
      {spacing:{before:40,after:20}}));
    ch.push(P([R('        ________________________________________________________________')],
      {spacing:{before:20,after:60}}));
  });

  ch.push(new Paragraph({children:[new PageBreak()]}));

  // ─────────────────────────────────────────────────────────────
  // ANSWER KEY
  // ─────────────────────────────────────────────────────────────
  ch.push(new Paragraph({spacing:{before:0,after:160},
    children:[R('📝  Answer Key & Explanations',{bold:true,size:28,color:BLUE})]}));

  const ansSection = (label) => new Paragraph({spacing:{before:180,after:100},
    children:[R(label,{bold:true,size:24,color:BLUE})]});

  const ansLine = (n, a, exp) => P([
    R(`(${n})  `,{bold:true}),
    R(a,{bold:true,color:RED}),
    R(exp ? `  —  ${exp}` : '')
  ], {spacing:{before:50,after:50,line:276}});

  // Part 1 answers
  if (ans.part1?.length) {
    ch.push(ansSection('Part 1.  Mind Map'));
    ans.part1.forEach(a => ch.push(ansLine(a.number, a.answer, a.note||'')));
  }

  // Part 2 answers
  if (ans.part2?.length) {
    ch.push(ansSection('Part 2.  Reading Comprehension'));
    ans.part2.forEach(a => ch.push(ansLine(a.number, a.answer,
      `${a.type ? a.type+'题 — ' : ''}${a.explanation||''}`)));
  }

  // Part 3 answers
  if (ans.part3?.length) {
    ch.push(ansSection('Part 3.  True / False / Not Given'));
    ans.part3.forEach(a => ch.push(ansLine(a.number, a.answer, a.explanation||'')));
  }

  // Part 4 answers
  if (ans.part4?.length) {
    ch.push(ansSection('Part 4.  Summary Completion'));
    ans.part4.forEach(a => ch.push(ansLine(a.number, a.answer, a.note||'')));
    const unused = (hw.part4?.word_bank||[])
      .filter(w => !(ans.part4||[]).map(a=>a.answer.toLowerCase()).includes(w.toLowerCase()));
    if (unused.length)
      ch.push(P([R(`Unused words: ${unused.join(', ')}.`,{italics:true,color:GREY})]));
  }

  // Part 5 answers
  if (ans.part5?.length) {
    ch.push(ansSection('Part 5.  Missing Letters'));
    ans.part5.forEach(a => ch.push(ansLine(a.number, a.answer, a.note||'')));
  }

  // Part 6 answers
  if (ans.part6?.length) {
    ch.push(ansSection('Part 6.  Sentence Imitation — Reference Translations'));
    ans.part6.forEach(a => {
      ch.push(P([R(`${a.number}. `,{bold:true}), R(a.answer,{color:RED})],
        {spacing:{before:60,after:30}}));
    });
  }

  // Part 7 answers
  if (ans.part7?.length) {
    ch.push(ansSection('Part 7.  Unscramble'));
    ans.part7.forEach(a => {
      ch.push(P([R(`${a.number}. `,{bold:true}), R(a.answer,{color:RED})],
        {spacing:{before:60,after:30}}));
    });
  }

  return new Document({
    styles:{default:{document:{run:{font:'Times New Roman',size:24}}}},
    sections:[{
      properties:{page:{
        size:{width:11906,height:16838},
        margin:{top:1080,right:1080,bottom:1080,left:1080}
      }},
      children:ch
    }]
  });
}


// ════════════════════════════════════════════════════════════════
// BLACKBOARD VERSION — Part 1 (2×2 grid) only
// ════════════════════════════════════════════════════════════════
function buildBlackboard(data) {
  const title = data.title || 'Reading Worksheet';
  const bdrT = { style:BorderStyle.SINGLE, size:18, color:BLUE };
  const allBT = allB(bdrT);

  const secTitle = (emoji, text) => new Paragraph({
    spacing:{before:0,after:80},
    children:[R(`${emoji}  ${text}`,{bold:true,size:26,color:BLUE})]
  });

  const bLine = (label, before, num) => new Paragraph({
    spacing:{before:44,after:44,line:276}, indent:{left:200},
    children:[
      R('•  '), R(`${label}  `,{bold:true}),
      ...(before?[R(before)]:[]),
      R(`(${num})  `,{bold:true}), R('________________')
    ]
  });

  const pLine = (label, text) => new Paragraph({
    spacing:{before:44,after:44,line:276}, indent:{left:200},
    children:[R('•  '), R(`${label}  `,{bold:true}), R(text)]
  });

  const cell = (items, bg) => {
    const paras = items.map(it => {
      if (it._h) return secTitle(it.emoji, it.title);
      if (it.type==='blank') return bLine(it.label, it.before, it.number);
      return pLine(it.label, it.text||'');
    });
    return new TableCell({
      borders:allBT,
      shading:{fill:bg, type:ShadingType.CLEAR},
      margins:{top:160,bottom:160,left:200,right:200},
      verticalAlign:VerticalAlign.TOP,
      children:paras
    });
  };

  const sections = data.blackboard?.sections || [];
  const BG = ['EBF3FB','FEF9E7','EAF4EA','FEF0F0'];

  const cells = sections.map((sec, i) => cell(
    [{_h:true, emoji:sec.emoji, title:sec.title}, ...(sec.items||[])],
    BG[i]||'F5F5F5'
  ));

  const rows = [];
  for (let i=0;i<cells.length;i+=2) {
    const pair = [cells[i], cells[i+1]||new TableCell({
      borders:allB(noBorder), children:[blank()]
    })];
    rows.push(new TableRow({children:pair}));
  }

  // Blackboard answers (Part 1 only)
  const bbAnswers = [];
  sections.forEach(sec =>
    (sec.items||[]).filter(it=>it.type==='blank').forEach(it =>
      bbAnswers.push([it.number, it.answer])
    )
  );
  bbAnswers.sort((a,b)=>a[0]-b[0]);

  const ansLine = (pairs) => new Paragraph({
    spacing:{before:40,after:40},
    children: pairs.flatMap(([n,a])=>[
      R(`(${n}) `,{bold:true}),
      R(a,{bold:true,color:RED}),
      R('          ')
    ])
  });

  const ch = [];
  ch.push(new Paragraph({
    alignment:AlignmentType.CENTER, spacing:{before:0,after:60},
    children:[R(title,{bold:true,size:32,color:RED})]
  }));
  ch.push(new Paragraph({
    alignment:AlignmentType.CENTER, spacing:{after:60},
    children:[R('Part 1  Mind Map  思维导图',{bold:true,size:26})]
  }));
  ch.push(new Paragraph({
    alignment:AlignmentType.CENTER, spacing:{after:40},
    children:[R('Complete the mind map. Use NO MORE THAN 3 WORDS for each blank.',{italics:true,size:22,color:GREY})]
  }));
  // 新模板：不再显示 Name/Date 行

  ch.push(new Table({width:{size:9360,type:WidthType.DXA},
    columnWidths:[4680,4680], rows}));

  ch.push(new Paragraph({spacing:{before:200,after:80},
    children:[R('📝  Answer Key',{bold:true,size:26,color:BLUE})]}));

  for (let i=0;i<bbAnswers.length;i+=5) {
    ch.push(ansLine(bbAnswers.slice(i,i+5)));
  }

  return new Document({
    styles:{default:{document:{run:{font:'Arial',size:24}}}},
    sections:[{
      properties:{page:{
        size:{width:11906,height:16838},
        margin:{top:900,right:900,bottom:900,left:900}
      }},
      children:ch
    }]
  });
}

// ── Export ────────────────────────────────────────────────────
async function buildBothDocs(data) {
  const [homeworkBuffer, blackboardBuffer] = await Promise.all([
    Packer.toBuffer(buildHomework(data)),
    Packer.toBuffer(buildBlackboard(data))
  ]);
  return { homeworkBuffer, blackboardBuffer };
}

module.exports = { buildBothDocs };
