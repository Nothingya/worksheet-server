// src/build_listening.js — Listening Practice
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, UnderlineType,
  Footer, PageNumber
} = require('docx');

const TNR='Times New Roman', RED='C00000', BLUE='1F4E79', GREY='595959';
const bdr = (c,sz=6) => ({style:BorderStyle.SINGLE,size:sz,color:c});
const allB = b => ({top:b,bottom:b,left:b,right:b});
const R = (text,opts={}) => new TextRun({text:String(text||''),font:TNR,size:22,...opts});
const P = (children,opts={}) => new Paragraph({spacing:{before:0,after:80,line:240},children,...opts});

const partHead = t => new Paragraph({
  spacing:{before:240,after:120,line:240},
  children:[R(t,{bold:true,size:28,color:RED})]
});
const instr = t => new Paragraph({
  spacing:{before:60,after:100,line:240},
  children:[R(t,{italics:true,color:GREY,size:20})]
});

// 彻底清理 Claude 可能在 statement 里塞入的各种格式前缀
function cleanStatement(raw) {
  var text = String(raw||'');
  // 1. 去掉 **6.** / *6.* 格式
  text = text.replace(/\*{1,3}\s*\d+\s*[.)]\s*\*{0,3}\s*/g, '');
  // 2. 去掉 6.  或 6)  开头编号（无星号）
  text = text.replace(/^\s*\d+\s*[.)]\s*/, '');
  // 3. 去掉开头横线和空格
  text = text.replace(/^[\s_]+/, '');
  // 4. 去掉所有剩余星号
  text = text.replace(/\*/g, '');
  return text.trim();
}

function makeFooter() {
  return new Footer({children:[new Paragraph({
    alignment:AlignmentType.RIGHT, spacing:{before:0,after:0,line:240},
    children:[new TextRun({children:[PageNumber.CURRENT],font:TNR,size:18,color:GREY})]
  })]});
}

function buildListening(data) {
  const title = data.title || 'Listening Practice';
  const ans = data.answers || {};
  const ch = [];

  // 标题
  ch.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:60,line:240},
    children:[R(title,{bold:true,size:32,color:RED})]}));
  ch.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:240,line:240},
    children:[R('Listening Practice',{bold:true,size:28,color:BLUE,underline:{type:UnderlineType.SINGLE}})]}));

  // Part 1
  ch.push(partHead('Part 1:  Listening Comprehension'));
  ch.push(instr('Instructions: You will hear an interview. For questions 1-5, choose the best answer (A, B or C).'));
  (data.part1||[]).forEach(q => {
    ch.push(P([R(q.number+'.  ',{bold:true}),R(q.question,{bold:true})],{spacing:{before:100,after:40,line:240}}));
    (q.options||[]).forEach(opt => ch.push(P([R('     '+opt)],{spacing:{before:0,after:20,line:240}})));
  });

  // Part 2
  ch.push(new Paragraph({spacing:{before:240,after:0,line:240},children:[R('')]}));
  ch.push(partHead('Part 2:  True, False or Not Given'));
  ch.push(instr('Instructions: Decide if the statements are True, False or Not Given. Write T, F or NG.'));
  (data.part2||[]).forEach(s => {
    ch.push(P([
      R(s.number+'.  ',{bold:true}),
      R('_________  '),
      R(cleanStatement(s.statement))
    ],{spacing:{before:80,after:60,line:240}}));
  });

  // Part 3
  ch.push(new Paragraph({spacing:{before:240,after:0,line:240},children:[R('')]}));
  ch.push(partHead('Part 3:  Table Summary'));
  ch.push(instr('Instructions: Complete the table. Write NO MORE THAN THREE WORDS for each answer.'));
  ch.push(new Paragraph({spacing:{before:0,after:60,line:240},children:[R('')]}));

  const p3 = data.part3 || {};
  const headers = p3.col_headers || ['Aspect','Observation / Advice','Reason / Outcome'];
  const TW=9360, CW=Math.floor(TW/3);
  const mkCell = (text, isHdr) => new TableCell({
    borders:allB(bdr(isHdr?BLUE:'CCCCCC',isHdr?10:6)),
    shading:isHdr?{fill:'EBF3FB',type:ShadingType.CLEAR}:undefined,
    margins:{top:100,bottom:100,left:140,right:140},
    width:{size:CW,type:WidthType.DXA},
    children:[new Paragraph({spacing:{before:0,after:0,line:260},children:[R(text,{bold:isHdr})]})]
  });
  ch.push(new Table({
    width:{size:TW,type:WidthType.DXA},columnWidths:[CW,CW,CW],
    rows:[
      new TableRow({children:headers.map(h=>mkCell(h,true))}),
      ...(p3.rows||[]).map(row=>new TableRow({children:[
        mkCell(row.col1||'',false),mkCell(row.col2||'',false),mkCell(row.col3||'',false)
      ]}))
    ]
  }));

  // Part 4
  ch.push(new Paragraph({spacing:{before:240,after:0,line:240},children:[R('')]}));
  ch.push(partHead('Part 4:  Dictation'));
  ch.push(instr('Instructions: Listen and complete the sentences. Write NO MORE THAN THREE WORDS for each answer.'));
  (data.part4||[]).forEach(seg => {
    const runs = seg.speaker ? [R(seg.speaker+':  ',{bold:true,color:BLUE})] : [];
    ch.push(P([...runs,R(seg.text||'')],{spacing:{before:60,after:50,line:240}}));
  });

  // Answer Key — pageBreakBefore 保证新页（比 PageBreak 更可靠）
  ch.push(new Paragraph({
    pageBreakBefore: true,
    spacing:{before:0,after:200,line:240},
    children:[R('Answer Key & Analysis',{bold:true,size:28,color:BLUE})]
  }));

  const secH = t => new Paragraph({spacing:{before:180,after:80,line:240},
    children:[R(t,{bold:true,size:24,color:BLUE})]});
  const aLine = (n,a,exp) => new Paragraph({
    spacing:{before:40,after:40,line:240},indent:{left:320},
    children:[R(n+'  ',{bold:true}),R(a,{bold:true,color:RED}),
      R(exp?'  -  '+exp:'',{color:GREY,size:20})]
  });

  ch.push(secH('Part 1:  Listening Comprehension'));
  (ans.part1||[]).forEach(a=>ch.push(aLine(a.number+'.', a.answer, a.quote||a.explanation||'')));
  ch.push(secH('Part 2:  True, False or Not Given'));
  (ans.part2||[]).forEach(a=>ch.push(aLine(a.number+'.', a.answer, a.explanation||'')));
  ch.push(secH('Part 3:  Table Summary'));
  (ans.part3||[]).forEach(a=>ch.push(aLine(a.number+'.', a.answer, '')));
  ch.push(secH('Part 4:  Dictation'));
  (ans.part4||[]).forEach(a=>ch.push(aLine(a.number+'.', a.answer, '')));

  return new Document({
    styles:{default:{document:{run:{font:TNR,size:22}}}},
    sections:[{
      footers:{default:makeFooter()},
      properties:{page:{size:{width:11906,height:16838},margin:{top:1080,right:1080,bottom:1200,left:1080}}},
      children:ch
    }]
  });
}

async function buildListeningDoc(data) { return Packer.toBuffer(buildListening(data)); }
module.exports = { buildListeningDoc };
