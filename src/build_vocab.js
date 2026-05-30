// src/build_vocab.js — Vocabulary Notes
// Layout: Part 1 = 2-column (left half / right half of words)
// Font: Times New Roman, 1x line spacing, blank line between parts
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, Footer, PageNumber, PageBreak
} = require('docx');

const TNR  = 'Times New Roman';
const RED  = 'C00000';
const BLUE = '1F4E79';
const GREY = '595959';

// Single-spacing (1x = 240 twips), no extra before/after
const SP  = { before:0, after:0, line:240 };
const SP1 = { before:0, after:80, line:240 };   // small gap after item
const SP2 = { before:160, after:40, line:240 };  // gap before word header

const R = (text, opts={}) => new TextRun({ text, font:TNR, size:22, ...opts });
const P = (children, opts={}) => new Paragraph({ spacing:SP, children, ...opts });
const blank = () => new Paragraph({ spacing:SP, children:[R('')] });

const partHead = (text) => new Paragraph({
  spacing:{ before:0, after:120, line:240 },
  children:[ R(text, { bold:true, size:28, color:RED }) ]
});
const instr = (text) => new Paragraph({
  spacing:{ before:60, after:120, line:240 },
  children:[ R(text, { italics:true, color:GREY, size:20 }) ]
});
const noBorder = { style:BorderStyle.NONE, size:0, color:'FFFFFF' };
const noB = { top:noBorder, bottom:noBorder, left:noBorder, right:noBorder };

// ── Build paragraphs for ONE word entry ─────────────────────────
function wordEntry(item, num) {
  const paras = [];
  // Word header line
  paras.push(new Paragraph({
    spacing: SP2,
    children: [
      R(`${num}. `, { bold:true }),
      R(item.word, { bold:true, size:24, color:BLUE }),
      R(`  ${item.pos}  `, { italics:true, color:GREY }),
      R(item.chinese || '')
    ]
  }));
  // Collocations (indented 320 DXA ≈ 0.22 inch)
  (item.collocations || []).forEach(col => {
    paras.push(new Paragraph({
      spacing:SP,
      indent:{ left:320 },
      children:[
        R('• ', { color:RED }),
        R(col.en, { bold:true }),
        R(`  （${col.zh}）`, { color:GREY, size:20 })
      ]
    }));
  });
  // Example sentence
  if (item.example) {
    paras.push(new Paragraph({
      spacing: SP,
      indent:{ left:320 },
      children:[ R(item.example.en, { italics:true }) ]
    }));
    if (item.example.zh) {
      paras.push(new Paragraph({
        spacing: SP,
        indent:{ left:320 },
        children:[ R(item.example.zh, { color:GREY, size:20, italics:true }) ]
      }));
    }
  }
  // Derivatives
  if (item.derivatives?.length) {
    const txt = item.derivatives.map(d => `${d.word} (${d.pos} ${d.zh})`).join('；  ');
    paras.push(new Paragraph({
      spacing: { before:0, after:200, line:240 },  // space after last word element
      indent:{ left:320 },
      children:[ R('派生词：', { bold:true, color:RED }), R(txt) ]
    }));
  } else {
    // If no derivatives, add spacing after the last element of this word
    if (paras.length) {
      const last = paras[paras.length-1];
      // Just add spacing after the example line
    }
  }
  return paras;
}

// ── 2-column Part 1 table ────────────────────────────────────────
function buildPart1Table(items) {
  const half = Math.ceil(items.length / 2);
  const left  = items.slice(0, half);
  const right = items.slice(half);
  const CW = 4500; // each column ~3.1 inches, with small gutter

  const mkColCell = (words, startIdx) => {
    const paras = [];
    words.forEach((item, i) => wordEntry(item, startIdx + i + 1).forEach(p => paras.push(p)));
    return new TableCell({
      borders: noB,
      width: { size:CW, type:WidthType.DXA },
      margins: { top:0, bottom:0, left:120, right:120 },
      children: paras.length ? paras : [blank()]
    });
  };

  return new Table({
    width: { size:9360, type:WidthType.DXA },
    columnWidths: [CW, CW],
    rows: [
      new TableRow({ children: [
        mkColCell(left,  0),
        mkColCell(right, half)
      ]})
    ]
  });
}

// ── Page number footer ────────────────────────────────────────────
function makeFooter() {
  return new Footer({
    children:[new Paragraph({
      alignment:AlignmentType.RIGHT,
      children:[new TextRun({ children:[PageNumber.CURRENT], font:TNR, size:18, color:GREY })]
    })]
  });
}

// ── Main build ───────────────────────────────────────────────────
function buildVocab(data) {
  const title = data.title || '词汇笔记';
  const ch = [];

  // Title
  ch.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before:0, after:160, line:240 },
    children: [ R(title, { bold:true, size:32, color:RED }) ]
  }));

  // ── Part 1: Core Vocabulary  (2-column) ──────────────────────
  ch.push(partHead('Part 1.  Core Vocabulary  📚'));
  ch.push(instr('Study the vocabulary. Pay attention to definitions, collocations, and word forms.'));
  ch.push(blank());

  if ((data.part1||[]).length) {
    ch.push(buildPart1Table(data.part1));
  }
  // Blank line between Part 1 and Part 2
  ch.push(new Paragraph({ spacing:{ before:300, after:0, line:240 }, children:[R('')] }));

  // ── Part 2: Word Formation ───────────────────────────────────
  ch.push(partHead('Part 2.  Word Formation  ✏️'));
  ch.push(instr('Complete the sentences with the correct form of the words in brackets.'));
  ch.push(blank());

  (data.part2 || []).forEach((item, i) => {
    ch.push(new Paragraph({
      spacing:{ before:60, after:60, line:240 },
      children:[
        R(`${i+1}.  `, { bold:true }),
        R(item.sentence),
        R(`  (${item.base_word})`, { italics:true, color:BLUE })
      ]
    }));
  });
  ch.push(new Paragraph({ spacing:{ before:300, after:0, line:240 }, children:[R('')] }));

  // ── Part 3: Vocabulary Matching ──────────────────────────────
  ch.push(partHead('Part 3.  Vocabulary Matching  🔗'));
  ch.push(instr('Match the words on the left with their definitions on the right.'));
  ch.push(blank());

  const bdr6 = c => ({ style:BorderStyle.SINGLE, size:6, color:c });
  const allB = b => ({ top:b, bottom:b, left:b, right:b });

  const matchRows = [
    new TableRow({ children:[
      new TableCell({ borders:allB(bdr6(BLUE)), shading:{fill:'EBF3FB',type:ShadingType.CLEAR},
        margins:{top:80,bottom:80,left:140,right:140}, width:{size:3000,type:WidthType.DXA},
        children:[new Paragraph({children:[R('Word',{bold:true})]})] }),
      new TableCell({ borders:allB(bdr6(BLUE)), shading:{fill:'EBF3FB',type:ShadingType.CLEAR},
        margins:{top:80,bottom:80,left:140,right:140}, width:{size:6360,type:WidthType.DXA},
        children:[new Paragraph({children:[R('Definition',{bold:true})]})] })
    ]}),
    ...(data.part3||[]).map(item =>
      new TableRow({ children:[
        new TableCell({ borders:allB(bdr6('CCCCCC')), margins:{top:60,bottom:60,left:140,right:140}, width:{size:3000,type:WidthType.DXA},
          children:[new Paragraph({spacing:SP,children:[R(`(   ) ${item.number}.  `),R(item.word)]})] }),
        new TableCell({ borders:allB(bdr6('CCCCCC')), margins:{top:60,bottom:60,left:140,right:140}, width:{size:6360,type:WidthType.DXA},
          children:[new Paragraph({spacing:SP,children:[R(`${item.letter}.  `),R(item.definition)]})] })
      ]})
    )
  ];
  ch.push(new Table({ width:{size:9360,type:WidthType.DXA}, columnWidths:[3000,6360], rows:matchRows }));
  ch.push(new Paragraph({ spacing:{ before:300, after:0, line:240 }, children:[R('')] }));

  // ── Part 4: Vocabulary Quiz ──────────────────────────────────
  ch.push(partHead('Part 4.  Vocabulary Quiz  📝'));
  ch.push(instr('Fill in the blanks with the correct form of the words from the box.'));

  // Word box — 2 columns per row, yellow background
  const boxWords = (data.part3||[]).map(i => i.word).filter(Boolean);
  if (boxWords.length) {
    const CW2 = 4680;
    const mkBox = w => new TableCell({
      borders: allB(bdr6('BBBBBB')),
      shading: { fill:'FFF2CC', type:ShadingType.CLEAR },
      margins: { top:60, bottom:60, left:160, right:160 },
      width: { size:CW2, type:WidthType.DXA },
      children: [new Paragraph({ spacing:SP, children:[R(w,{bold:true})] })]
    });
    const boxRows = [];
    for (let i=0; i<boxWords.length; i+=2) {
      boxRows.push(new TableRow({ children:[mkBox(boxWords[i]||''), mkBox(boxWords[i+1]||'')] }));
    }
    ch.push(blank());
    ch.push(new Table({ width:{size:9360,type:WidthType.DXA}, columnWidths:[CW2,CW2], rows:boxRows }));
    ch.push(blank());
  }

  (data.part4||[]).forEach((item,i) => {
    ch.push(new Paragraph({
      spacing:{ before:60, after:60, line:240 },
      children:[ R(`${i+1}.  `,{bold:true}), R(item.sentence) ]
    }));
  });
  ch.push(blank());

  // ── Answer Key ───────────────────────────────────────────────
  ch.push(new Paragraph({children:[new PageBreak()]}));
  ch.push(new Paragraph({ spacing:{before:0,after:120,line:240},
    children:[R('Answer Key',{bold:true,size:28,color:BLUE})] }));

  const secH = t => new Paragraph({ spacing:{before:160,after:80,line:240},
    children:[R(t,{bold:true,size:24,color:BLUE})] });
  const ansLine = (n,a,note) => new Paragraph({ spacing:{before:30,after:30,line:240}, children:[
    R(`${n}.  `,{bold:true}), R(a,{bold:true,color:RED}),
    R(note?`  —  ${note}`:'',{color:GREY,size:20})
  ]});

  ch.push(secH('Part 2.  Word Formation'));
  (data.part2||[]).forEach((item,i) => ch.push(ansLine(i+1, item.answer, item.explanation||'')));
  ch.push(blank());

  ch.push(secH('Part 3.  Vocabulary Matching'));
  const key3 = data.part3_key || {};
  (data.part3||[]).forEach(item => ch.push(ansLine(item.number, key3[item.number]||'?', '')));
  ch.push(blank());

  ch.push(secH('Part 4.  Vocabulary Quiz'));
  (data.part4||[]).forEach((item,i) => ch.push(ansLine(i+1, item.answer, item.note||'')));

  return new Document({
    styles: { default: { document: { run: { font:TNR, size:22 } } } },
    sections: [{ footers:{ default:makeFooter() }, properties: { page: {
      size:{ width:11906, height:16838 },
      margin:{ top:1080, right:1080, bottom:1080, left:1080 }
    }}, children:ch }]
  });
}

async function buildVocabDoc(data) { return Packer.toBuffer(buildVocab(data)); }
module.exports = { buildVocabDoc };
