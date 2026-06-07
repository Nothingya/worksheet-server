/**
 * src/fix_ielts_tasks.js
 * Batch-corrects Task 1 and Task 6 in existing IELTS docx files.
 * Preserves all other tasks unchanged.
 */
'use strict';
const zlib = require('zlib');
const archiver = require('archiver');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, LineRuleType
} = require('docx');

// ── Typography (mirrors build_ielts.js) ───────────────────────────────────────
const FONT='Times New Roman', SP={line:276,lineRule:LineRuleType.AUTO};
const T12=24, T13=26;
const S_ACCENT='1A5276', S_LIGHT='D6EAF8';
const T_ACCENT='7B241C', T_LIGHT='FADBD8';
const B1={style:BorderStyle.SINGLE,size:4,color:'BBBBBB'};
const B0={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
const brd={top:B1,bottom:B1,left:B1,right:B1};
const brd0={top:B0,bottom:B0,left:B0,right:B0};
const PAGE={size:{width:11906,height:16838},margin:{top:900,right:900,bottom:900,left:900}};

// ── docx helpers ──────────────────────────────────────────────────────────────
const r=(t,o={})=>new TextRun({text:t,font:FONT,size:o.sz||T12,bold:!!o.bold,italics:!!o.ital,color:o.color||'000000'});
const p=(t,o={})=>new Paragraph({children:[r(t,o)],spacing:{...SP,before:o.before||80,after:o.after||80},alignment:o.align||AlignmentType.LEFT});
const pRuns=(runs,o={})=>new Paragraph({children:runs,spacing:{...SP,before:o.before||80,after:o.after||80}});
function td(t,o={}) {
  return new TableCell({borders:o.nob?brd0:brd,width:o.w?{size:o.w,type:WidthType.DXA}:undefined,
    shading:o.fill?{fill:o.fill,type:ShadingType.CLEAR}:undefined,
    margins:{top:80,bottom:80,left:120,right:120},
    children:[new Paragraph({children:[r(t,{sz:o.sz||T12,bold:!!o.bold,color:o.color||'000000',ital:!!o.ital})],
      alignment:o.align||AlignmentType.LEFT,spacing:{...SP,before:40,after:40}})]});
}
function hdrRow(labels,widths,fill) {
  return new TableRow({children:labels.map((l,i)=>new TableCell({borders:brd,
    width:{size:widths[i],type:WidthType.DXA},shading:{fill,type:ShadingType.CLEAR},
    margins:{top:80,bottom:80,left:120,right:120},
    children:[new Paragraph({children:[r(l,{bold:true})],spacing:{...SP,before:40,after:40}})]}))});
}
function taskBar(emoji,label,accent) {
  return new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[9360],
    rows:[new TableRow({children:[new TableCell({borders:brd0,
      shading:{fill:accent,type:ShadingType.CLEAR},margins:{top:120,bottom:120,left:200,right:200},
      children:[new Paragraph({children:[r(emoji+'  '+label,{sz:T13,bold:true,color:'FFFFFF'})],
        spacing:{...SP,before:0,after:0}})]})]})]});
}
const _fy=arr=>{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};

// ── ZIP: extract XML ──────────────────────────────────────────────────────────
function extractXmlFromDocx(buffer) {
  let eocd=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)
    {if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd===-1)throw new Error('Invalid ZIP: EOCD not found');
  const cdOff=buffer.readUInt32LE(eocd+16), cdSz=buffer.readUInt32LE(eocd+12);
  let pos=cdOff;
  while(pos<cdOff+cdSz){
    if(buffer.readUInt32LE(pos)!==0x02014b50)break;
    const comp=buffer.readUInt16LE(pos+10), csz=buffer.readUInt32LE(pos+20);
    const fnl=buffer.readUInt16LE(pos+28), el=buffer.readUInt16LE(pos+30), cl=buffer.readUInt16LE(pos+32);
    const lho=buffer.readUInt32LE(pos+42), name=buffer.slice(pos+46,pos+46+fnl).toString('utf8');
    if(name==='word/document.xml'){
      const lf=buffer.readUInt16LE(lho+26), le2=buffer.readUInt16LE(lho+28);
      const ds=lho+30+lf+le2, raw=buffer.slice(ds,ds+csz);
      return (comp===0?raw:zlib.inflateRawSync(raw)).toString('utf8');
    }
    pos+=46+fnl+el+cl;
  }
  throw new Error('word/document.xml not found');
}

// ZIP: get all entries ─────────────────────────────────────────────────────────
function getAllZipEntries(buffer) {
  let eocd=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)
    {if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd===-1)return[];
  const cdOff=buffer.readUInt32LE(eocd+16), cdSz=buffer.readUInt32LE(eocd+12);
  const entries=[];
  let pos=cdOff;
  while(pos<cdOff+cdSz){
    if(buffer.readUInt32LE(pos)!==0x02014b50)break;
    const comp=buffer.readUInt16LE(pos+10), csz=buffer.readUInt32LE(pos+20);
    const fnl=buffer.readUInt16LE(pos+28), el=buffer.readUInt16LE(pos+30), cl=buffer.readUInt16LE(pos+32);
    const lho=buffer.readUInt32LE(pos+42), name=buffer.slice(pos+46,pos+46+fnl).toString('utf8');
    if(!name.endsWith('/')){
      const lf=buffer.readUInt16LE(lho+26), le2=buffer.readUInt16LE(lho+28);
      const ds=lho+30+lf+le2, raw=buffer.slice(ds,ds+csz);
      try{entries.push({name,data:comp===0?raw:zlib.inflateRawSync(raw)});}
      catch(e){entries.push({name,data:raw});}
    }
    pos+=46+fnl+el+cl;
  }
  return entries;
}

// ZIP: repack with new XML ─────────────────────────────────────────────────────
function packDocx(entries, newXml) {
  return new Promise((resolve,reject)=>{
    const arc=archiver('zip',{zlib:{level:6}});
    const chunks=[];
    arc.on('data',d=>chunks.push(d));
    arc.on('end',()=>resolve(Buffer.concat(chunks)));
    arc.on('error',reject);
    for(const e of entries)
      arc.append(e.name==='word/document.xml'?Buffer.from(newXml,'utf8'):e.data,{name:e.name});
    arc.finalize();
  });
}

// ── XML helpers ───────────────────────────────────────────────────────────────
const decode=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");

function findTableContaining(xml, text) {
  const tp=xml.indexOf(text);
  if(tp===-1)return -1;
  let depth=0;
  for(let i=tp;i>=0;i--){
    if(xml.substr(i,8)==='</w:tbl>')depth++;
    else if(xml.substr(i,6)==='<w:tbl'&&(xml[i+6]==='>'||xml[i+6]===' ')){
      if(depth===0)return i; depth--;
    }
  }
  return -1;
}

function findTableEnd(xml, start) {
  let depth=0;
  for(let i=start;i<xml.length-8;i++){
    if(xml.substr(i,6)==='<w:tbl'&&(xml[i+6]==='>'||xml[i+6]===' '))depth++;
    else if(xml.substr(i,8)==='</w:tbl>'){if(--depth===0)return i+8;}
  }
  return -1;
}

function parseTableRows(tblXml) {
  const rows=[];
  for(const trBlock of tblXml.split(/<\/w:tr>/)){
    if(!trBlock.includes('<w:tr'))continue;
    const cells=[];
    for(const tcBlock of trBlock.split(/<\/w:tc>/)){
      if(!tcBlock.includes('<w:tc'))continue;
      cells.push([...tcBlock.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m=>decode(m[1])).join('').trim());
    }
    if(cells.length)rows.push(cells);
  }
  return rows;
}

// ── Role detection ────────────────────────────────────────────────────────────
function detectRole(xml) {
  return (xml.includes('答案 &amp; 解析')||xml.includes('答案 & 解析')||
          xml.includes('Teacher')||xml.includes('7B241C'))
    ? 'teacher' : 'student';
}

// ── Extract Task 1 pairs from docx XML ───────────────────────────────────────
function extractTask1Pairs(xml) {
  const barStart=findTableContaining(xml,'同义替换矩阵');
  if(barStart===-1)return null;
  const barEnd=findTableEnd(xml,barStart);
  if(barEnd===-1)return null;

  // Content table is the next <w:tbl> after the taskBar
  const cStart=xml.indexOf('<w:tbl',barEnd);
  if(cStart===-1)return null;
  const cEnd=findTableEnd(xml,cStart);
  const rows=parseTableRows(xml.slice(cStart,cEnd));
  if(!rows||rows.length<2)return null;

  const pairs=[];
  for(const row of rows.slice(1)){
    if(row.length<4)continue;
    // Detect column format:
    // Old teacher (5-col): [letter, questionExpr, answer/num, originalExpr, strategy]
    // New teacher (6-col): [num,    questionExpr, letter,     originalExpr, answer, strategy]
    // Student (5-col):     [num,    questionExpr, letter,     originalExpr, answer/____]
    const questionExpression=(row[1]||'').trim();
    const originalExpression=(row[3]||'').replace(/^[A-F]\.\s*/,'').trim();

    // Strategy lives in last column — but only if it doesn't look like an answer value.
    // Answer values: single letter A–F, "____", "→ N", empty
    const lastCol=(row[row.length-1]||'').trim();
    const looksLikeAnswer=/^[A-F]$/.test(lastCol)||/^→\s*\d+$/.test(lastCol)||lastCol==='____'||lastCol==='';
    const strategy=looksLikeAnswer?'':(row.length>=6?(row[5]||'').trim():lastCol);

    if(questionExpression||originalExpression)
      pairs.push({questionExpression,originalExpression,strategy});
  }
  return pairs.length>=4?pairs:null;
}

// ── Detect if Task 1 already correct ─────────────────────────────────────────
function task1NeedsFix(xml,role) {
  const barStart=findTableContaining(xml,'同义替换矩阵');
  if(barStart===-1)return true;
  const barEnd=findTableEnd(xml,barStart);
  if(barEnd===-1)return true;
  const cStart=xml.indexOf('<w:tbl',barEnd);
  if(cStart===-1)return true;
  const rows=parseTableRows(xml.slice(cStart,findTableEnd(xml,cStart)));
  if(!rows||rows.length<2)return true;
  const h=rows[0];
  // Student new format: 5 cols. Teacher: 6 cols.
  const expectedCols=role==='student'?5:6;
  if(h.length!==expectedCols)return true;
  // Check no letter prefix in 原文表达 column
  return rows.slice(1).some(row=>row[3]&&/^[A-F]\.\s/.test(row[3]));
}

// ── Extract Task 6 data ───────────────────────────────────────────────────────
function extractTask6Data(xml) {
  const barStart=findTableContaining(xml,'主旨匹配');
  if(barStart===-1)return null;
  const barEnd=findTableEnd(xml,barStart);
  if(barEnd===-1)return null;

  const headings=[], sections=[];
  let pos=barEnd, found=0;

  while(found<5){
    const tStart=xml.indexOf('<w:tbl',pos);
    if(tStart===-1)break;
    const tEnd=findTableEnd(xml,tStart);
    if(tEnd===-1)break;
    const rows=parseTableRows(xml.slice(tStart,tEnd));
    if(rows&&rows.length>=2){
      const h=rows[0];
      // Heading table: 2 cols, rows have A-E labels
      if(h.length===2&&rows.slice(1).some(r=>/^[A-E]$/.test((r[0]||'').trim()))){
        for(const row of rows.slice(1))
          if(/^[A-E]$/.test((row[0]||'').trim()))
            headings.push({label:row[0].trim(),text:row[1]||''});
      }
      // Teacher section table: [Section, 答案, 匹配逻辑]
      if(h.length===3&&rows.slice(1).some(r=>(r[0]||'').includes('Section'))){
        for(const row of rows.slice(1))
          if((row[0]||'').includes('Section'))
            sections.push({sectionLabel:row[0].trim(),correctHeading:(row[1]||'').trim(),matchingLogic:row[2]||''});
      }
      // Student section table: header row = section labels
      if(rows.length===2&&h.every(c=>c.includes('Section'))){
        h.forEach(sl=>sections.push({sectionLabel:sl.trim(),correctHeading:'',matchingLogic:''}));
      }
    }
    pos=tEnd; found++;
  }

  // Extract distractor info from paragraphs after the tables
  const afterTables=xml.slice(pos,pos+2000);
  const distractorMatch=afterTables.match(/干扰项[：:]\s*([A-E])/);
  const distractorLabel=distractorMatch?distractorMatch[1]:'';
  const expMatch=afterTables.match(/<w:t[^>]*>([^<]{20,})<\/w:t>/);
  const distractorExplanation=expMatch?decode(expMatch[1]):'';

  return{headings,sections,distractorLabel,distractorExplanation};
}

// ── Detect if Task 6 already correct ─────────────────────────────────────────
function task6NeedsFix(xml) {
  const barStart=findTableContaining(xml,'主旨匹配');
  if(barStart===-1)return false;
  const barEnd=findTableEnd(xml,barStart);
  const cStart=xml.indexOf('<w:tbl',barEnd);
  if(cStart===-1)return false;
  const rows=parseTableRows(xml.slice(cStart,findTableEnd(xml,cStart)));
  if(!rows||rows.length<2)return true;
  const h=rows[0];
  // New format heading table: 2 cols [字母, 标题内容]
  return !(h.length===2&&(h[0].includes('字母')||h[0]==='字母'));
}

// ── Shuffle ───────────────────────────────────────────────────────────────────
function shufflePairs(pairs) {
  let qi,oi,tries=0;
  do{qi=_fy(pairs.map((_,i)=>i));oi=_fy(pairs.map((_,i)=>i));tries++;}
  while(tries<30&&qi.some((q,i)=>q===oi[i]));
  const qo=qi.map(i=>pairs[i]), oo=oi.map(i=>pairs[i]);
  const answers=qi.map(qIdx=>String.fromCharCode(65+oi.findIndex(o=>o===qIdx)));
  return{questionOrder:qo,originalOrder:oo,answers,answerSummary:answers.map((a,i)=>`${i+1}:${a}`).join('   ')};
}

// Sort sections by Roman numeral / Arabic number in label
function _sectionOrder(label) {
  const rom={I:1,II:2,III:3,IV:4,V:5};
  const m=(label||'').match(/([IVX]+|\d+)\s*$/i);
  if(!m)return 0;
  return rom[m[1].toUpperCase()]||parseInt(m[1])||0;
}

// Returns true if ANY two ADJACENT sections (sorted by section order)
// have consecutive letter answers — e.g. Section I→B, Section II→C triggers.
function isSequentialAnswers(secAnswers) {
  let pairs;
  if(!secAnswers||!secAnswers.length)return false;
  if(typeof secAnswers[0]==='string'){
    pairs=secAnswers.filter(Boolean).map((a,i)=>({sectionLabel:'Section '+(i+1),newAnswer:a}));
  } else {
    pairs=secAnswers.filter(s=>s&&s.newAnswer&&/^[A-E]$/.test(s.newAnswer));
  }
  if(pairs.length<2)return false;
  pairs.sort((a,b)=>_sectionOrder(a.sectionLabel)-_sectionOrder(b.sectionLabel));
  const c=pairs.map(s=>s.newAnswer.charCodeAt(0));
  for(let i=0;i<c.length-1;i++){
    if(Math.abs(c[i+1]-c[i])===1)return true; // ANY 2 consecutive
  }
  return false;
}

function shuffleTask6(task6data) {
  const{headings,sections}=task6data;
  if(!headings.length)return null;
  let display,secAnswers,tries=0;
  do{
    const sh=_fy(headings);
    display=sh.map((h,i)=>({label:String.fromCharCode(65+i),text:h.text,orig:h.label}));
    const remap={};display.forEach(d=>{remap[d.orig]=d.label;});
    secAnswers=sections.map(s=>({
      sectionLabel:s.sectionLabel,
      newAnswer:s.correctHeading?(remap[s.correctHeading]||s.correctHeading):'',
      matchingLogic:s.matchingLogic||''
    }));
    tries++;
  }while(tries<50&&isSequentialAnswers(secAnswers));
  const used=new Set(secAnswers.map(s=>s.newAnswer).filter(Boolean));
  const dis=display.find(h=>!used.has(h.label))?.label||task6data.distractorLabel||'';
  const sum=secAnswers.filter(s=>s.newAnswer).map(s=>s.sectionLabel+': '+s.newAnswer).join('   ');
  return{display,secAnswers,summary:sum,distractorLabel:dis};
}

// ── Compute shuffles from one document ───────────────────────────────────────
function computeShufflesFromDoc(buffer) {
  const xml=extractXmlFromDocx(buffer);
  const pairs=extractTask1Pairs(xml);
  const t6=extractTask6Data(xml);
  return{
    task1:pairs?shufflePairs(pairs):null,
    task6:(t6&&t6.headings.length)?shuffleTask6(t6):null
  };
}

// ── Merged shuffles from student+teacher pair ─────────────────────────────────
// Old teacher has no heading table → headings come from student.
// Old student has no correct answers → answers come from teacher.
function computeMergedShuffles(stuBuffer, tchBuffer) {
  const stuXml=extractXmlFromDocx(stuBuffer);
  const tchXml=extractXmlFromDocx(tchBuffer);
  const pairs=extractTask1Pairs(tchXml)||extractTask1Pairs(stuXml);
  const stuT6=extractTask6Data(stuXml)||{headings:[],sections:[],distractorLabel:'',distractorExplanation:''};
  const tchT6=extractTask6Data(tchXml)||{headings:[],sections:[],distractorLabel:'',distractorExplanation:''};
  const headings=stuT6.headings.length?stuT6.headings:tchT6.headings;
  const sections=(tchT6.sections.length&&tchT6.sections.some(s=>s.correctHeading))
    ?tchT6.sections:stuT6.sections;
  const mergedT6={
    headings,sections,
    distractorLabel:      tchT6.distractorLabel||stuT6.distractorLabel||'',
    distractorExplanation:tchT6.distractorExplanation||stuT6.distractorExplanation||''
  };
  return{
    task1:pairs?shufflePairs(pairs):null,
    task6:headings.length?shuffleTask6(mergedT6):null,
    mergedT6
  };
}

// ── Build replacement XML ──────────────────────────────────────────────────────
async function buildBodyXml(elements) {
  const doc=new Document({styles:{default:{document:{run:{font:FONT,size:T12}}}},
    sections:[{properties:{page:PAGE},children:elements}]});
  const buf=await Packer.toBuffer(doc);
  const xml=extractXmlFromDocx(buf);
  return xml.slice(xml.indexOf('<w:body>')+8, xml.lastIndexOf('</w:body>'));
}

// Accept optional pre-computed shuffle so student/teacher pairs stay in sync
async function makeTask1Xml(pairs, role, preShuf) {
  const accent=role==='teacher'?T_ACCENT:S_ACCENT;
  const fill  =role==='teacher'?T_LIGHT :S_LIGHT;
  const label =role==='teacher'?'Task 1 — 同义替换矩阵  答案 & 解析'
                               :'Task 1  同义替换矩阵  (Paraphrasing Matrix)';
  const{questionOrder,originalOrder,answers,answerSummary}=preShuf||shufflePairs(pairs);
  const els=[
    taskBar('🔄',label,accent),
    p('将左栏原文表达（1–6）与右栏同义替换选项（A–F）匹配，在 Answer 栏填写对应字母，每项只用一次。',
      {ital:true,before:80,after:100})
  ];
  if(role==='student'){
    const cw=[560,3280,480,4240,800];
    const rows=[hdrRow(['编号','题干表达','字母','原文表达','答案'],cw,fill)];
    questionOrder.forEach((qp,i)=>rows.push(new TableRow({children:[
      td(String(i+1),{w:cw[0],align:AlignmentType.CENTER}),
      td(qp.questionExpression||'',{w:cw[1],ital:true}),
      td(String.fromCharCode(65+i),{w:cw[2],align:AlignmentType.CENTER}),
      td(originalOrder[i].originalExpression||originalOrder[i].paraphrase||'',{w:cw[3]}),
      td('____',{w:cw[4],align:AlignmentType.CENTER}),
    ]})));
    els.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:cw,rows}));
  } else {
    const cw=[480,2560,480,2960,720,2160];
    const rows=[hdrRow(['编号','题干表达','字母','原文表达','答案','改写策略'],cw,fill)];
    questionOrder.forEach((qp,i)=>rows.push(new TableRow({children:[
      td(String(i+1),{w:cw[0],align:AlignmentType.CENTER}),
      td(qp.questionExpression||'',{w:cw[1],ital:true}),
      td(String.fromCharCode(65+i),{w:cw[2],align:AlignmentType.CENTER}),
      td(originalOrder[i].originalExpression||originalOrder[i].paraphrase||'',{w:cw[3]}),
      td(answers[i],{w:cw[4],align:AlignmentType.CENTER,color:accent,bold:true}),
      td(qp.strategy||'',{w:cw[5]}),
    ]})));
    els.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:cw,rows}));
    els.push(pRuns([r('答案速览：',{bold:true,color:accent}),r(answerSummary,{bold:true})],
      {before:80,after:160}));
  }
  els.push(new Paragraph({spacing:{...SP,before:0,after:80},children:[r('')]}));
  return buildBodyXml(els);
}

// Accept optional pre-computed shuffle so student/teacher pairs stay in sync
async function makeTask6Xml(task6data, role, preShuf) {
  const accent=role==='teacher'?T_ACCENT:S_ACCENT;
  const fill  =role==='teacher'?T_LIGHT :S_LIGHT;
  const label =role==='teacher'?'Task 6 — 主旨匹配  答案 & 解析'
                               :'Task 6  主旨匹配  (Heading Match)';
  const sh=preShuf||shuffleTask6(task6data);
  if(!sh)return null;
  const{display,secAnswers,summary,distractorLabel}=sh;
  const n=secAnswers.length||4, sw=Math.floor(9360/n);
  const els=[
    taskBar('🏷️',label,accent),
    p('将以下标题（A–E）与 Task 5 的各 Section 匹配，写出每个 Section 的主旨。有一个干扰项。',
      {ital:true,before:80,after:100})
  ];
  const hrows=[hdrRow(['字母','标题内容'],[480,8880],fill)];
  display.forEach(h=>hrows.push(new TableRow({children:[
    td(h.label,{w:480,align:AlignmentType.CENTER,bold:true}),
    td(h.text,{w:8880}),
  ]})));
  els.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[480,8880],rows:hrows}));
  els.push(new Paragraph({spacing:{...SP,before:0,after:80},children:[r('')]}));
  if(role==='student'){
    els.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:Array(n).fill(sw),
      rows:[
        new TableRow({children:secAnswers.map(s=>td(s.sectionLabel,{w:sw,fill,bold:true,align:AlignmentType.CENTER}))}),
        new TableRow({children:secAnswers.map(_=>td('____',{w:sw,align:AlignmentType.CENTER}))}),
      ]}));
    els.push(new Paragraph({spacing:{...SP,before:80,after:80},children:[r('')]}));
    els.push(p('干扰项: ____    理由: __________________________________________________',{before:40,after:200}));
  } else {
    els.push(pRuns([r('答案速览：',{bold:true,color:accent}),r(summary,{bold:true})],{before:80,after:80}));
    const t6rows=[hdrRow(['Section','答案','匹配逻辑'],[1800,720,6840],fill)];
    secAnswers.forEach(s=>t6rows.push(new TableRow({children:[
      td(s.sectionLabel,{w:1800}),
      td(s.newAnswer||'?',{w:720,color:accent,align:AlignmentType.CENTER,bold:true}),
      td(s.matchingLogic,{w:6840}),
    ]})));
    els.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[1800,720,6840],rows:t6rows}));
    els.push(p('干扰项：'+distractorLabel,{color:accent,before:120,after:60}));
    els.push(p(task6data.distractorExplanation||'',{color:'333333',before:40,after:160}));
  }
  return buildBodyXml(els);
}

// ── Main fix entry ─────────────────────────────────────────────────────────────
async function fixIELTSDoc(buffer, filename, sharedShuffles) {
  const xml=extractXmlFromDocx(buffer);
  const role=detectRole(xml);

  const pairs=extractTask1Pairs(xml);
  if(!pairs)return{skipped:true,reason:'Task 1 pairs not parseable',filename,role};
  const task6data=extractTask6Data(xml)||{headings:[],sections:[],distractorLabel:'',distractorExplanation:''};

  const task1Xml=await makeTask1Xml(pairs,role,sharedShuffles&&sharedShuffles.task1);

  // Build task6: use preShuf even if this file's heading table is empty
  // (old teacher format has no heading table but sharedShuffles.task6 has the merged data)
  const hasTask6=(task6data.headings.length>0)||(sharedShuffles&&sharedShuffles.task6);
  const task6Xml=hasTask6?await makeTask6Xml(task6data,role,sharedShuffles&&sharedShuffles.task6):null;

  const t1s=findTableContaining(xml,'同义替换矩阵');
  const t2s=findTableContaining(xml,'剔骨疗法');
  const t6s=findTableContaining(xml,'主旨匹配');
  const be=xml.lastIndexOf('</w:body>');
  if(t1s===-1||t2s===-1||t6s===-1)
    return{skipped:true,reason:'Cannot locate task boundaries',filename,role};

  const part1=xml.slice(0,t1s);
  const part2=xml.slice(t2s,t6s);
  const part3=xml.slice(be);
  const newXml=part1+task1Xml+part2+(task6Xml||xml.slice(t6s,be))+part3;

  const entries=getAllZipEntries(buffer);
  const newBuffer=await packDocx(entries,newXml);
  const fixed=['Task 1'];
  if(task6Xml)fixed.push('Task 6');
  return{skipped:false,buffer:newBuffer,filename,role,fixed};
}

module.exports={fixIELTSDoc,computeShufflesFromDoc,computeMergedShuffles};
