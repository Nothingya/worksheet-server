// server.js — Worksheet Generator (Full Pipeline)
// Top section:    📖 Reading & Writing  (Reading + Vocab + Video)
// Bottom section: 🎧 Listening & Speaking  (Listening A/B + LS Vocab + LS Video)

require('dotenv').config();
const express     = require('express');
const multer      = require('multer');
const archiver    = require('archiver');
const PDFParser   = require('pdf2json');
const pdfParse    = require('pdf-parse');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const Anthropic   = require('@anthropic-ai/sdk');

const { generateContent }   = require('./src/generate');
const { generateVocab }     = require('./src/generate_vocab');
const { generateVideo }     = require('./src/generate_video');
const { generateListening } = require('./src/generate_listening');
const { buildBothDocs }     = require('./src/build');
const { buildVocabDoc }     = require('./src/build_vocab');
const { buildVideoDoc }     = require('./src/build_video');
const { buildListeningDoc } = require('./src/build_listening');
const { extractText }       = require('./src/extract');
const { UNIT_WORDLIST }     = require('./src/wordlist_data');
const { UNIT_SCRIPTS }      = require('./src/script_data');
const { getLSScripts, scanAvailable } = require('./src/ls_script_reader');
const { LS_WORDLIST }       = require('./src/ls_wordlist_data');
const autoLoader            = require('./src/auto_loader');
const rwBookLoader          = require('./src/rw_book_loader');
const { extractAllPassages, extractPassagesForTest } = require('./src/ielts_splitter_docx');
const { generateIELTS }     = require('./src/generate_ielts');
const { buildIELTSDocs }    = require('./src/build_ielts');
const { fixIELTSDoc, computeShufflesFromDoc, computeMergedShuffles } = require('./src/fix_ielts_tasks');

if (!process.env.ANTHROPIC_API_KEY) { console.error('❌  ANTHROPIC_API_KEY not set.'); process.exit(1); }

const app    = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PORT   = process.env.PORT || 3000;
const jobs   = new Map();

// ── OpenAI (optional) ────────────────────────────────────────────
let OpenAIClient = null;
try {
  const { OpenAI } = require('openai');
  if (process.env.OPENAI_API_KEY) {
    OpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('🎨  OpenAI DALL-E ready');
  }
} catch(_) {}

function getOpenAIClient() { return OpenAIClient; }

// ── Multer ────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_, f, cb) => { const n=f.originalname.toLowerCase(); cb(null, n.endsWith('.pdf')||n.endsWith('.docx')||n.endsWith('.doc')); },
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ════════════════════════════════════════════════════════════════
// PDF UTILITIES
// ════════════════════════════════════════════════════════════════
function extractPageTexts(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', (data) => {
      if (!data.Pages?.length) return reject(new Error('PDF 无文字'));
      resolve(data.Pages.map((page, i) => ({
        pageNum: i + 1,
        text: (page.Texts||[]).map(t=>(t.R||[]).map(r=>{
          try{return decodeURIComponent(r.T);}catch{return r.T;}
        }).join('')).join(' ').replace(/\s+/g,' ').trim()
      })));
    });
    parser.on('pdfParser_dataError', e => reject(new Error(String(e.parserError||e))));
    parser.parseBuffer(buffer);
  });
}

function pageContains(text, kw) {
  const lo = text.toLowerCase();
  return lo.includes(kw) || lo.replace(/\s+/g,'').includes(kw.replace(/\s+/g,''));
}

function findBoundaries(pages) {
  const s=[], e=[];
  for (const p of pages) {
    if (pageContains(p.text,'preparing to read'))        s.push(p.pageNum);
    if (pageContains(p.text,'understanding the reading')) e.push(p.pageNum);
  }
  return { startPages:s, endPages:e };
}

function pairBoundaries(sp, ep) {
  return Array.from({length:Math.min(sp.length,ep.length)},(_,i)=>
    ({index:i+1,startPage:sp[i],endPage:ep[i]})).filter(p=>p.startPage<p.endPage);
}

async function getTitle(pages, start) {
  const pm = Object.fromEntries(pages.map(p=>[p.pageNum,p.text]));
  const snip = [start,start+1,start+2].map(n=>pm[n]||'').join('\n').slice(0,1200);
  const r = await client.messages.create({
    model:'claude-haiku-4-5', max_tokens:60,
    messages:[{role:'user',content:`What is the title of the reading article? ONLY the title.\n\n${snip}`}]
  });
  return r.content.filter(b=>b.type==='text').map(b=>b.text).join('').trim();
}

async function getAllTitles(pages, pairs) {
  const pm = Object.fromEntries(pages.map(p=>[p.pageNum,p.text]));
  const snippets = pairs.map((p,i)=>
    `--- Article ${i+1} (pages ${p.startPage}-${p.endPage}) ---\n`+
    [p.startPage,p.startPage+1,p.startPage+2].map(n=>pm[n]||'').join(' ').slice(0,800)
  ).join('\n\n');
  const r = await client.messages.create({
    model:'claude-sonnet-4-5', max_tokens:400,
    system:[{type:'text',text:'Extract article titles. Return ONLY a JSON array of strings, one per article. No markdown.',cache_control:{type:'ephemeral'}}],
    messages:[{role:'user',content:`Extract the title of each reading article:\n\n${snippets}`}]
  });
  const u=r.usage||{};
  console.log(`    [cache/titles] ${u.cache_read_input_tokens>0?'✅ HIT':'📝 MISS'}`);
  const raw = r.content.filter(b=>b.type==='text').map(b=>b.text).join('').replace(/```[\s\S]*?```/g,'').trim();
  try {
    const titles = JSON.parse(raw);
    if (Array.isArray(titles)) return titles.map((t,i)=>{
      const c=String(t).trim();
      return (c.length>80||/^(I |There is|No title|Sorry)/i.test(c)) ? `Chapter ${pairs[i]?.index||i+1} Reading` : c;
    });
  } catch(_) {}
  return raw.split('\n').map(l=>l.replace(/^[".\d\-\s]+/,'').replace(/",?$/,'').trim())
    .filter(l=>l&&l.length<80&&!/^(I |There is)/i.test(l))
    .concat(pairs.map((p,i)=>`Chapter ${p.index} Reading`)).slice(0,pairs.length);
}

async function slicePdf(buf, start, end) {
  const src=await PDFDocument.load(buf), tot=src.getPageCount();
  const s=Math.max(1,start), e=Math.min(tot,end);
  const doc=await PDFDocument.create();
  const cps=await doc.copyPages(src,Array.from({length:e-s+1},(_,i)=>s-1+i));
  cps.forEach(p=>doc.addPage(p));
  return Buffer.from(await doc.save());
}

async function getScriptText(buf) {
  try{const d=await pdfParse(buf);if(d.text.trim().length>200)return d.text;}catch(_){}
  return new Promise((res,rej)=>{
    const p=new PDFParser(null,1);
    p.on('pdfParser_dataReady',()=>res((p.getRawTextContent()||'').replace(/---+Page[^-]+-+/g,'\n').trim()));
    p.on('pdfParser_dataError',e=>rej(new Error(String(e))));
    p.parseBuffer(buf);
  });
}

function splitScript(text) {
  const rx=/(?:^|\n)(UNIT\s*(\d+)\s*:[^\n]*)/gi;
  const out=[]; let m,last=0,lm=null;
  while((m=rx.exec(text))!==null){
    if(lm){const c=text.slice(last,m.index).trim();if(c.length>50)out.push({...lm,content:c});}
    lm={unit:parseInt(m[2]),marker:m[1].trim()};last=m.index+m[0].length;
  }
  if(lm){const c=text.slice(last).trim();if(c.length>50)out.push({...lm,content:c});}
  return out;
}

// ── Convert text → simple PDF buffer (for script output) ────────
async function textToPdf(text, title='Script') {
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 11, margin = 50, lineH = size * 1.5;
  const addPage = () => {
    const p = doc.addPage([595,842]);
    return { page:p, y:p.getHeight()-margin };
  };
  let {page, y} = addPage();
  const lines = text.split('\n');
  for (const line of lines) {
    if (y < margin+lineH) { ({page,y}=addPage()); }
    // Wrap long lines
    const words = line.split(' ');
    let row = '';
    for (const w of words) {
      const test = row ? row+' '+w : w;
      const tw = font.widthOfTextAtSize(test, size);
      if (tw > 595-margin*2 && row) {
        page.drawText(row, {x:margin,y,size,font,color:rgb(0,0,0)});
        y -= lineH; row = w;
        if (y < margin+lineH) { ({page,y}=addPage()); }
      } else { row = test; }
    }
    if (row) { page.drawText(row, {x:margin,y,size,font,color:rgb(0,0,0)}); }
    y -= lineH;
  }
  return Buffer.from(await doc.save());
}

// ── DALL-E image generation ──────────────────────────────────────
function buildImagePrompt(data, customPrompt) {
  if (customPrompt?.trim()) return customPrompt.trim();
  const title=data.title||'article', sections=data.homework?.part1?.sections||[];
  const themes=sections.map(s=>s.title).filter(Boolean).join(', ');
  const keywords=sections.flatMap(s=>(s.items||[]).map(it=>it.answer)).filter(Boolean).slice(0,10).join(', ');
  const summary=(data.homework?.part4?.passage||'').slice(0,200);
  return `Educational visual overview (导览图) for EFL article "${title}". `+
    `Themes: ${themes||title}. Key concepts: ${keywords||title}. ${summary}. `+
    `National Geographic style, professional, no text labels.`;
}
async function generateImage(data, customPrompt) {
  const oc=getOpenAIClient(); if(!oc) return null;
  try {
    const res=await oc.images.generate({model:'dall-e-3',prompt:buildImagePrompt(data,customPrompt),n:1,size:'1024x1024',quality:'standard'});
    const buf=await(await fetch(res.data[0].url)).arrayBuffer();
    return Buffer.from(buf);
  } catch(e){ console.error('    ⚠️  Image failed:',e.message); return null; }
}

// ════════════════════════════════════════════════════════════════
// RW PIPELINE  (Reading + Vocab + Video)
// ════════════════════════════════════════════════════════════════
async function runBatch(job, bookFiles, scriptBuf) {
  const upd=(step,detail)=>{job.currentStep=step;job.currentDetail=detail;};
  job.splitResult=`批量模式：${bookFiles.length} 个文件`;
  const videos=[];
  if(scriptBuf){
    try{
      const txt=await getScriptText(scriptBuf), secs=splitScript(txt);
      if(secs.length){for(const s of secs)videos.push({type:'VideoReading',chapter:s.unit,title:`Unit ${s.unit} Video Script`,text:`${s.marker}\n\n${s.content}`});}
      job.scriptResult=secs.length?`找到 ${secs.length} 段视频脚本`:'未找到 UNIT 标记，跳过';
    }catch(e){job.scriptResult='脚本处理失败：'+e.message;}
  } else { job.scriptResult='未上传，跳过'; }
  const items=[
    ...bookFiles.map((f,i)=>{
      const m=f.originalname.match(/(?:ch|chap|chapter|unit|u)[\s._-]*(\d+)/i);
      return {type:'Reading',chapter:m?parseInt(m[1]):i+1,title:f.originalname.replace(/\.pdf$/i,'').replace(/[_.-]/g,' ').trim(),buffer:f.buffer};
    }),
    ...videos
  ];
  job.total=items.length; job.done=0; job.failed=0; job.files=[];
  for(const item of items){ if(job.cancelled) break; await processItem(job,item,upd); }
  job.status='done';
}

async function runPipeline(job, bookBuf, scriptBuf) {
  const upd=(step,detail)=>{job.currentStep=step;job.currentDetail=detail;};
  upd('拆分教材','提取文字...');
  const pages=await extractPageTexts(bookBuf);
  const {startPages,endPages}=findBoundaries(pages);
  if(!startPages.length||!endPages.length) throw new Error(`边界不足 (PREPARING:${startPages.length} UNDERSTANDING:${endPages.length})`);
  const pairs=pairBoundaries(startPages,endPages);
  upd('拆分教材',`配对到 ${pairs.length} 篇，提取标题...`);
  const titles=await getAllTitles(pages,pairs);
  const articles=[];
  for(let i=0;i<pairs.length;i++){
    const p=pairs[i], title=titles[i]||`Chapter ${p.index} Reading`;
    const buf=await slicePdf(bookBuf,p.startPage,p.endPage);
    articles.push({type:'Reading',chapter:p.index,title,buffer:buf});
    upd('拆分教材',`Ch${String(p.index).padStart(2,'0')} "${title}"`);
  }
  job.splitResult=`找到 ${articles.length} 篇 Reading`;
  const videos=[];
  if(scriptBuf){
    upd('拆分视频脚本','提取文字...');
    const txt=await getScriptText(scriptBuf), secs=splitScript(txt);
    if(secs.length){for(const s of secs)videos.push({type:'VideoReading',chapter:s.unit,title:`Unit ${s.unit} Video Script`,text:`${s.marker}\n\n${s.content}`});job.scriptResult=`找到 ${secs.length} 段脚本`;}
    else job.scriptResult='未找到 UNIT 标记';
  } else { job.scriptResult=Object.keys(UNIT_SCRIPTS).length?'内置✅':'未上传'; }
  const all=[...articles,...videos];
  job.total=all.length; job.done=0; job.failed=0; job.files=[];
  for(const item of all){ if(job.cancelled) break; await processItem(job,item,upd); }
  job.status='done';
}

async function processItem(job, item, upd) {
  upd('生成作业',`${job.done+job.failed+1}/${job.total} "${item.title}"`);
  const ch=String(item.chapter).padStart(2,'0');
  const t=item.title.replace(/[<>:"/\\|?*]/g,'').replace(/\s+/g,'_').slice(0,40);
  try {
    if(item.type==='VideoReading'){
      const scriptText=(UNIT_SCRIPTS[item.chapter])||item.text||'';
      const vdata=await generateVideo(scriptText,item.title);
      vdata.title = 'PW4 RW U' + ch + ' Video Practice';
      const vBuf=await buildVideoDoc(vdata);
      job.files.push({folder:'video',name:`PW4 RW U${ch} Video Practice.docx`,buf:vBuf});
    } else {
      const text=item.buffer?await extractText(item.buffer):item.text;
      const wordList=job.wordListMap?.[item.chapter]||[];
      const rwData=await generateContent(text,item.title);
      rwData.title = 'PW4 RW U' + ch + ' Reading Practice';
      const [{homeworkBuffer:hw,blackboardBuffer:bb},voc,img]=await Promise.all([
        buildBothDocs(rwData),
        wordList.length?generateVocab(text,wordList,item.title).then(d=>buildVocabDoc(d)):Promise.resolve(null),
        job.generateImage?generateImage(rwData,job.imagePrompt):Promise.resolve(null)
      ]);
      job.files.push({folder:'reading',name:`PW4 RW U${ch} Reading Homework.docx`,buf:hw});
      job.files.push({folder:'reading',name:`PW4 RW U${ch} Reading Blackboard.docx`,buf:bb});
      if(voc)job.files.push({folder:'vocabulary',name:`PW4 RW U${ch} 词汇笔记.docx`,buf:voc});
      if(img)job.files.push({folder:'reading',name:`PW4 RW U${ch} 导览图.png`,buf:img});
    }
    job.done++;
  } catch(err) {
    console.error(`[${job.id}] ❌ "${item.title}": ${err.message}`);
    job.failed++;
  }
}

// ════════════════════════════════════════════════════════════════
// LS PIPELINE  (Listening A + B + LS Vocab + LS Video)
// ════════════════════════════════════════════════════════════════
async function runLSPipeline(job, unitNum, lessonMode, lsScriptBuf, lsVideoBuf) {
  const upd=(s,d)=>{job.currentStep=s;job.currentDetail=d;};
  job.files=[]; job.done=0; job.failed=0; job.stepStatus={A:'pending',B:'pending',other:'pending'};

  // ── Gather all data sources ──────────────────────────────────
  let unitScripts = getLSScripts(unitNum);   // reads from PW4 LS script/ folder

  // If user uploaded an LS script PDF, override
  if(lsScriptBuf) {
    try {
      const rawTxt = await getScriptText(lsScriptBuf);
      // Simple unit split: take everything as one blob for the requested unit
      if(rawTxt.length > 200) {
        // Try to find lesson A and B sections
        const aIdx = rawTxt.search(/\bLESSON\s+A\b/i);
        const bIdx = rawTxt.search(/\bLESSON\s+B\b/i);
        if(aIdx !== -1 && bIdx !== -1) {
          unitScripts = { A: rawTxt.slice(aIdx, bIdx).trim(), B: rawTxt.slice(bIdx).trim() };
        } else if(aIdx !== -1) {
          unitScripts = { A: rawTxt.slice(aIdx).trim(), B: '' };
        } else {
          unitScripts = { A: rawTxt.trim(), B: '' };
        }
      }
    } catch(e){ console.warn('⚠️  Could not parse uploaded LS script:', e.message); }
  }

  const lsWords = autoLoader.cache.lsWordList[`${unitNum}A`]
               || autoLoader.cache.lsWordList[unitNum]
               || LS_WORDLIST[`${unitNum}A`]
               || LS_WORDLIST[unitNum] || [];

  const videoScript = lsVideoBuf
    ? await getScriptText(lsVideoBuf).catch(()=>'')
    : (autoLoader.cache.lsVideoScripts[unitNum] || autoLoader.cache.rwVideoScripts[unitNum] || UNIT_SCRIPTS[unitNum] || '');

  const ch = String(unitNum).padStart(2,'0');

  // ── Figure out what we CAN do (only count tasks with data) ───
  const listenTasks = [];
  if((lessonMode==='A'||lessonMode==='both') && (unitScripts.A||'').length > 50) listenTasks.push('A');
  if((lessonMode==='B'||lessonMode==='both') && (unitScripts.B||'').length > 50) listenTasks.push('B');

  const willVocab = true; // 始终生成词汇笔记，无词表时从脚本提取
  const willVideo = videoScript.length > 50;

  job.total = listenTasks.length + (willVocab?1:0) + (willVideo?1:0);

  // ── Report what's missing ────────────────────────────────────
  const missing = [];
  if(lessonMode==='A'||lessonMode==='both')  { if(!(unitScripts.A||'').length) missing.push('Lesson A脚本'); }
  if(lessonMode==='B'||lessonMode==='both')  { if(!(unitScripts.B||'').length) missing.push('Lesson B脚本'); }
  if(!willVocab) missing.push('LS词表');
  if(!willVideo) missing.push('视频脚本');
  if(missing.length) console.log(`[LS Unit${unitNum}] 跳过（无数据）: ${missing.join(', ')}`);

  console.log(`[LS Unit${unitNum}] scripts: A=${unitScripts.A?.length||0}chars B=${unitScripts.B?.length||0}chars vocab=${lsWords.length}words video=${videoScript.length}chars`);
  if(job.total === 0) {
    job.status='done';
    job.splitResult=`缺少脚本文件，请将 PW4LS-unit${unitNum}A.txt 放入 "PW4 LS script/" 文件夹`;
    job.stepStatus={A:'skipped',B:'skipped',other:'skipped'};
    return;
  }

  // ── Listening A / B ──────────────────────────────────────────
  for(const lesson of listenTasks){
    upd(`生成 Listening ${lesson}`, `Unit ${unitNum}`);
    try {
      const data = await generateListening(unitScripts[lesson], `Unit ${unitNum} Lesson ${lesson}`, lesson);
      data.title = 'PW4 LS U' + unitNum + lesson + ' Listening Practice';
      const buf  = await buildListeningDoc(data);
      job.files.push({folder:'listening', name:`PW4 LS U${unitNum}${lesson} Listening Practice.docx`, buf});
      job.done++; job.stepStatus[lesson]='done';
    } catch(e){ console.error(`❌ Listening ${lesson}:`, e.message); job.failed++; job.stepStatus[lesson]='error:'+e.message.slice(0,60); }
  }

  // ── LS Vocab ─────────────────────────────────────────────────
  // Bug #051 fix: generate SEPARATE vocab docs for A and B instead of merging them.
  // vocabTargets = ['A','B'] when both, or ['A'] / ['B'] for single lesson.
  job.stepStatus.other='running';
  if(willVocab){
    const vocabTargets = lessonMode === 'both'
      ? listenTasks                  // only lessons that actually have scripts
      : [lessonMode];

    // We budgeted 1 slot for vocab; if generating 2, adjust the total so progress bar is correct
    if(vocabTargets.length > 1) job.total += vocabTargets.length - 1;

    for(const lesson of vocabTargets){
      upd('生成词汇笔记', `Unit ${unitNum} Lesson ${lesson}`);
      try {
        const scriptText = unitScripts[lesson] || '';
        // Prefer lesson-specific wordlist (e.g. "3A"), fall back to shared list
        const words = autoLoader.cache.lsWordList[`${unitNum}${lesson}`]
                   || LS_WORDLIST[`${unitNum}${lesson}`]
                   || lsWords;
        const vdata = await generateVocab(
          scriptText || `Unit ${unitNum} Lesson ${lesson} listening practice.`,
          words,
          `Unit ${unitNum} Lesson ${lesson}`
        );
        vdata.title = `PW4 LS U${unitNum}${lesson} 词汇笔记`;
        const vbuf = await buildVocabDoc(vdata);
        job.files.push({folder:'vocabulary', name:`PW4 LS U${unitNum}${lesson} 词汇笔记.docx`, buf:vbuf});
        job.done++;
      } catch(e){
        console.error(`LS Vocab ${lesson} error:`, e.message, e.stack);
        job.failed++;
        job.stepStatus.other = 'error:' + e.message.slice(0,80);
      }
    }
  }

  // ── LS Video ─────────────────────────────────────────────────
  if(willVideo){
    upd('生成 Video Practice', `Unit ${unitNum}`);
    try {
      const vdata = await generateVideo(videoScript, `Unit ${unitNum} Video`);
      vdata.title = 'PW4 LS U' + unitNum + ' Video Practice';
      const vbuf  = await buildVideoDoc(vdata);
      job.files.push({folder:'video', name:'PW4 LS U' + unitNum + ' Video Practice.docx', buf:vbuf});
      job.done++;
    } catch(e){ console.error('❌ LS Video:', e.message); job.failed++; }
  }
  if(job.stepStatus.other==='running') job.stepStatus.other='done';

  job.status='done';
}

// ════════════════════════════════════════════════════════════════
// HTML
// ════════════════════════════════════════════════════════════════
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>📚 作业生成器</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f2f5;min-height:100vh;padding:24px 16px;color:#1a1a2e}
.card{background:#fff;border-radius:16px;padding:28px;max-width:700px;margin:0 auto 20px;box-shadow:0 4px 20px rgba(0,0,0,.07)}
.section-header{display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #f0f0f0}
.section-header h2{font-size:20px;font-weight:700}
.section-rw h2{color:#C00000}.section-ls h2{color:#1F4E79}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.zone{border:2px dashed #d0d0d0;border-radius:12px;padding:20px 14px;text-align:center;cursor:pointer;transition:all .2s;background:#fafafa}
.zone:hover,.zone.over{border-color:#1F4E79;background:#EBF3FB}
.zone.filled{border-color:#2e7d32;background:#f1f8e9}
.zone input{display:none}
.zi{font-size:28px;margin-bottom:6px}.zl{font-size:13px;font-weight:600;color:#444;margin-bottom:3px}
.zh{font-size:11px;color:#888}.zf{font-size:11px;color:#2e7d32;font-weight:600;margin-top:5px;word-break:break-all}
.notice{background:#f0f7f0;border:1px solid #c8e6c9;border-radius:8px;padding:10px 14px;font-size:12px;color:#2e7d32;margin-bottom:14px}
.notice.blue{background:#EBF3FB;border-color:#90CAF9;color:#1565C0}
.mode-row{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.mode-btn{padding:7px 16px;border:1.5px solid #d0d0d0;border-radius:20px;background:#fff;font-size:13px;cursor:pointer;transition:all .2s}
.mode-btn.active{background:#1F4E79;color:#fff;border-color:#1F4E79}
.mode-btn.active.red{background:#C00000;border-color:#C00000}
.btn{width:100%;padding:13px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s}
.btn-rw{background:#C00000;color:#fff}.btn-rw:hover{background:#a00000}.btn-rw:disabled{background:#ccc;cursor:not-allowed}
.btn-ls{background:#1F4E79;color:#fff}.btn-ls:hover{background:#163a5c}.btn-ls:disabled{background:#ccc;cursor:not-allowed}
.btn-dl{background:#2e7d32;color:#fff;margin-top:10px}.btn-dl:hover{background:#1b5e20}
.btn-stop{background:#b71c1c;color:#fff;margin-top:6px;font-size:12px;padding:7px;display:none}.btn-stop:hover{background:#7f0000}
.module-bar{display:flex;gap:8px;max-width:700px;margin:0 auto 16px;padding:0 16px}
.module-tag{padding:5px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid}
.module-tag.active{background:#C00000;color:#fff;border-color:#C00000}.module-tag.ielts-active{background:#1F4E79!important;border-color:#1F4E79!important}
.module-tag.inactive{background:#fff;color:#888;border-color:#ccc}
.prog{margin-top:20px;display:none}.prog.show{display:block}
.step{display:flex;gap:10px;margin-bottom:12px;align-items:flex-start}
.si{font-size:17px;width:22px;flex-shrink:0}.sn{font-weight:600;font-size:13px;color:#333}.sd{font-size:12px;color:#666;margin-top:2px}
.bw{background:#eee;border-radius:8px;height:7px;margin-top:7px}.bb{height:7px;border-radius:8px;transition:width .4s;background:#1F4E79;width:0%}
.rbox{margin-top:16px;padding:14px;border-radius:10px;text-align:center;display:none}
.rbox.show{display:block}.rok{background:#f1f8e9;border:1px solid #a5d6a7}.rer{background:#fff3f3;border:1px solid #ef9a9a}
.rt{font-size:17px;font-weight:700;margin-bottom:5px}.rs{font-size:12px;color:#666}
.divider{display:flex;align-items:center;gap:12px;margin:8px 0;color:#999;font-size:12px}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:#e0e0e0}
.unit-row{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.unit-input{width:100px;padding:8px 12px;border:1.5px solid #d0d0d0;border-radius:8px;font-size:14px}
.unit-input:focus{outline:none;border-color:#1F4E79}
.img-box{border:1px solid #e0e0e0;border-radius:10px;padding:14px;background:#fafafa;margin-bottom:14px}
.img-box label{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;cursor:pointer}
.img-box input[type=checkbox]{width:16px;height:16px;accent-color:#C00000}
.img-prompt{width:100%;margin-top:10px;padding:9px 12px;border:1px solid #d0d0d0;border-radius:8px;font-size:12px;display:none}
.no-key{font-size:11px;color:#e53935;margin-top:4px}
</style>
</head>
<body>

<!-- ── READING & WRITING ─────────────────────────────────────── -->
<div class="module-bar">
  <span class="module-tag active" id="tag-pw4" onclick="switchModule('pw4')" style="cursor:pointer">📚 PW4</span>
  <span class="module-tag inactive" id="tag-ielts" onclick="switchModule('ielts')" style="cursor:pointer">🎓 IELTS</span>
  <span class="module-tag inactive" id="tag-fix" onclick="switchModule('fix')" style="cursor:pointer">🔧 纠错</span>
</div>
<div class="card section-rw" id="pw4-card">
  <div class="section-header">
    <span style="font-size:24px">📖</span>
    <h2>阅读写作 Reading & Writing</h2>
  </div>

  <div class="mode-row" id="rw-modes">
    <button class="mode-btn active red" onclick="setRWMode('reading',this)">📖 Reading</button>
    <button class="mode-btn" onclick="setRWMode('video',this)">🎬 Video</button>
    <button class="mode-btn" onclick="setRWMode('both',this)">📖+🎬 Both</button>
  </div>

  <div class="unit-row">
    <label style="font-size:13px;font-weight:600">Unit 编号：</label>
    <input type="number" class="unit-input" id="rw-unit" min="1" max="10" placeholder="1-10" value="1">
    <span id="rw-unit-title" style="font-size:12px;color:#888;margin-left:8px"></span>
  </div>
  <div class="notice" id="rw-book-notice" style="background:#fff8e1;border-color:#ffe082;color:#e65100">
    Loading...
  </div>
  <div class="notice" id="rw-script-notice" style="display:none">🎬 视频脚本：加载中...</div>

  <div class="notice">📋 <strong>词汇笔记自动生成</strong> — 已内置 Pathways L4 Unit 1–10 词表，按章节自动匹配</div>

  <div class="img-box">
    <label><input type="checkbox" id="gen-img" onchange="togglePrompt()">
      🎨 同时生成导览图（DALL-E 3）
      <span id="no-key" class="no-key" style="display:none">⚠️ 需在 .env 设置 OPENAI_API_KEY</span>
    </label>
    <input type="text" class="img-prompt" id="img-prompt" placeholder="自定义描述（留空则自动）">
  </div>

  <button class="btn btn-rw" id="btn-rw" onclick="goRW()">🚀 生成 Unit 阅读写作作业</button>
  <button class="btn btn-stop" id="stop-rw" onclick="stopJob('rw')">⛔ 停止生成</button>

  <div class="prog" id="rw-prog">
    <div class="step"><div class="si" id="ri1">⏳</div><div><div class="sn">拆分教材</div><div class="sd" id="rd1">等待中...</div></div></div>
    <div class="step"><div class="si" id="ri2">⏳</div><div><div class="sn">拆分视频脚本</div><div class="sd" id="rd2">等待中...</div></div></div>
    <div class="step"><div class="si" id="ri3">⏳</div><div><div class="sn">生成作业</div><div class="sd" id="rd3">等待中...</div><div class="bw" id="rbw" style="display:none"><div class="bb" id="rbb"></div></div></div></div>
  </div>
  <div class="rbox rok" id="rw-ok"><div class="rt">🎉 完成！</div><div class="rs" id="rw-rs"></div><button class="btn btn-dl" onclick="dlJob('rw')">📦 下载 ZIP</button></div>
  <div class="rbox rer" id="rw-er"><div class="rt">❌ 出错</div><div class="rs" id="rw-em"></div></div>
</div>

<!-- ── LISTENING & SPEAKING ──────────────────────────────────── -->
<div class="card section-ls" id="ls-card">
  <div class="section-header">
    <span style="font-size:24px">🎧</span>
    <h2>听力口语 Listening & Speaking</h2>
  </div>

  <div class="unit-row">
    <label style="font-size:13px;font-weight:600">Unit 编号：</label>
    <input type="number" class="unit-input" id="ls-unit" min="1" max="10" placeholder="1–10" value="1">
  </div>

  <div class="mode-row" id="ls-modes">
    <button class="mode-btn active" onclick="setLSMode('both',this)">🎧 A+B 两篇</button>
    <button class="mode-btn" onclick="setLSMode('A',this)">Lesson A</button>
    <button class="mode-btn" onclick="setLSMode('B',this)">Lesson B</button>
  </div>

  <div class="notice blue" id="ls-script-notice">📋 LS Script 状态：加载中...</div>

  <div class="grid">
    <div class="zone" id="zls" onclick="document.getElementById('fls').click()">
      <input type="file" id="fls" accept=".pdf">
      <div class="zi">🎧</div><div class="zl">LS Script PDF</div>
      <div class="zh">可选 · 覆盖内置脚本</div>
      <div class="zf" id="nls"></div>
    </div>
    <div class="zone" id="zlsv" onclick="document.getElementById('flsv').click()">
      <input type="file" id="flsv" accept=".pdf">
      <div class="zi">🎬</div><div class="zl">LS Video Script</div>
      <div class="zh">可选 · 视频脚本</div>
      <div class="zf" id="nlsv"></div>
    </div>
  </div>

  <div class="notice">📋 <strong>词汇笔记自动生成</strong> — 上传 LS 词表后匹配（<code>node setup_ls_wordlist.js &lt;pdf&gt;</code>）</div>

  <button class="btn btn-ls" id="btn-ls" onclick="goLS()">🎧 生成听力口语作业</button>
  <button class="btn btn-stop" id="stop-ls" onclick="stopJob('ls')">⛔ 停止生成</button>

  <div class="prog" id="ls-prog">
    <div class="step"><div class="si" id="li1">⏳</div><div><div class="sn">生成 Listening A</div><div class="sd" id="ld1">等待中...</div></div></div>
    <div class="step"><div class="si" id="li2">⏳</div><div><div class="sn">生成 Listening B</div><div class="sd" id="ld2">等待中...</div></div></div>
    <div class="step"><div class="si" id="li3">⏳</div><div><div class="sn">生成其他文档</div><div class="sd" id="ld3">等待中...</div><div class="bw" id="lbw" style="display:none"><div class="bb blue-bar" id="lbb" style="background:#1F4E79"></div></div></div></div>
  </div>
  <div class="rbox rok" id="ls-ok"><div class="rt">🎉 完成！</div><div class="rs" id="ls-rs"></div><button class="btn btn-dl" onclick="dlJob('ls')">📦 下载 ZIP</button></div>
  <div class="rbox rer" id="ls-er"><div class="rt">❌ 出错</div><div class="rs" id="ls-em"></div></div>
</div>


<script>
function switchModule(mod) {
  document.querySelectorAll('.module-tag').forEach(t => t.classList.remove('active','ielts-active'));
  var pw4  = document.getElementById('pw4-card');
  var ls   = document.getElementById('ls-card');
  var ielts = document.getElementById('ielts-card');
  var fix   = document.getElementById('fix-card');
  if (mod === 'ielts') {
    document.getElementById('tag-ielts').classList.add('active','ielts-active');
    if (pw4) pw4.style.display='none'; if (ls) ls.style.display='none';
    if (ielts) ielts.style.display='block'; if (fix) fix.style.display='none';
  } else if (mod === 'fix') {
    document.getElementById('tag-fix').classList.add('active');
    document.getElementById('tag-fix').style.background='#2E7D32';
    document.getElementById('tag-fix').style.color='#fff';
    document.getElementById('tag-fix').style.borderColor='#2E7D32';
    if (pw4) pw4.style.display='none'; if (ls) ls.style.display='none';
    if (ielts) ielts.style.display='none'; if (fix) fix.style.display='block';
  } else {
    document.getElementById('tag-pw4').classList.add('active');
    if (pw4) pw4.style.display=''; if (ls) ls.style.display='';
    if (ielts) ielts.style.display='none'; if (fix) fix.style.display='none';
  }
}

// ── Fix tool ─────────────────────────────────────────────────────
let fixFiles = [];
function handleFixFiles(files) {
  fixFiles = Array.from(files).slice(0, 12);
  document.getElementById('fix-filelist').textContent = fixFiles.map(f=>f.name).join('  |  ');
  document.getElementById('btn-fix').disabled = fixFiles.length === 0;
}
function handleFixDrop(e) { handleFixFiles(e.dataTransfer.files); }
async function goFix() {
  if (!fixFiles.length) return;
  document.getElementById('btn-fix').disabled=true;
  document.getElementById('stop-fix').style.display='block';
  document.getElementById('fix-prog').style.display='block';
  document.getElementById('fix-ok').style.display='none';
  document.getElementById('fix-er').style.display='none';
  document.getElementById('fi1').textContent='⏳';
  document.getElementById('fd1').textContent='上传中...';
  document.getElementById('fbw').style.display='block';
  document.getElementById('fbb').style.width='0%';
  const fd=new FormData();
  fixFiles.forEach(f=>fd.append('files',f));
  const r=await fetch('/fix-ielts-tasks',{method:'POST',body:fd});
  const{jobId}=await r.json();
  jobs.fix=jobId;
  timers.fix=setInterval(()=>pollFix(jobId),1500);
}
async function pollFix(jobId) {
  const r=await fetch('/status/'+jobId);
  const j=await r.json();
  if (j.currentDetail) document.getElementById('fd1').textContent='处理: '+j.currentDetail;
  if (j.total>0){
    const p=Math.round((j.done+j.failed+(j.skipped||0))/j.total*100);
    document.getElementById('fbb').style.width=p+'%';
  }
  if (j.status==='done'){
    clearInterval(timers.fix);
    document.getElementById('fi1').textContent='✅';
    document.getElementById('fd1').textContent='✅'+j.done+' 纠错  ➖'+(j.skipped||0)+' 跳过  ❌'+j.failed+' 失败';
    document.getElementById('fix-ok').style.display='block';
    document.getElementById('fix-rs').textContent='共 '+j.files+' 个文件已纠错，'+(j.skipped||0)+' 个已是新格式跳过';
    document.getElementById('btn-fix').disabled=false;
    document.getElementById('stop-fix').style.display='none';
  }
  if (j.status==='error'){
    clearInterval(timers.fix);
    document.getElementById('fi1').textContent='❌';
    document.getElementById('fix-er').style.display='block';
    document.getElementById('fix-em').textContent=j.error;
    document.getElementById('btn-fix').disabled=false;
  }
}


function ieltsFileChanged(input) {
  var lbl = document.getElementById('n-ielts');
  var zone = document.getElementById('z-ielts');
  if (input.files && input.files.length > 0) {
    if (lbl) lbl.textContent = input.files[0].name;
    if (zone) zone.classList.add('filled');
  }
}

async function goIELTS() {
  var ieltsInput = document.getElementById('f-ielts');
  var file = ieltsInput && ieltsInput.files && ieltsInput.files[0];
  if (!file) { alert('请先点击区域选择 Word 文档（.docx）'); return; }
  console.log('[goIELTS] file:', file.name, file.size, file.type);

  const testNum    = document.getElementById('ielts-test').value;
  const passageNum = document.getElementById('ielts-passage').value;

  document.getElementById('btn-ielts').disabled = true;
  document.getElementById('stop-ielts').style.display = 'block';
  document.getElementById('ielts-prog').classList.add('show');
  document.getElementById('ielts-ok').classList.remove('show');
  document.getElementById('ielts-er').classList.remove('show');
  isi(1,'⏳','解析 PDF...');isi(2,'⏳','等待中...');

  const fd = new FormData();
  fd.append('section', 'ielts');
  fd.append('ielts_docx', file);
  fd.append('testNum',    testNum);
  fd.append('passageNum', passageNum);

  const r = await fetch('/process', { method:'POST', body:fd });
  const j = await r.json();
  if (!r.ok) { showErr('ielts', j.error||'失败'); return; }
  jobs.ielts = j.jobId;
  timers.ielts = setInterval(() => pollJob('ielts'), 2500);
}

function isi(n,ic,dt){
  document.getElementById('ii'+n).textContent=ic;
  document.getElementById('id'+n).textContent=dt;
}

let jobs = {rw: null, ls: null};
let timers = {rw: null, ls: null};
let rwMode = 'reading', lsMode = 'both';

// ── File zones ──────────────────────────────────────────────────
function setupZone(inputId, zoneId, labelId) {
  const inp=document.getElementById(inputId), zone=document.getElementById(zoneId), lbl=document.getElementById(labelId);
  if(!inp)return;
  inp.addEventListener('change',()=>{
    if(inp.files.length>0){
      lbl.textContent=inp.files.length===1?inp.files[0].name:inp.files.length+' 个文件';
      zone.classList.add('filled');
    }
    checkRWReady();
  });
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('over');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('over'));
  zone.addEventListener('drop',e=>{
    e.preventDefault();zone.classList.remove('over');
    const pdfs=[...e.dataTransfer.files].filter(f=>f.name.endsWith('.pdf'));
    if(!pdfs.length)return;
    const dt=new DataTransfer();pdfs.forEach(f=>dt.items.add(f));inp.files=dt.files;
    lbl.textContent=pdfs.length===1?pdfs[0].name:pdfs.length+' 个文件';
    zone.classList.add('filled');checkRWReady();
  });
}
setupZone('fb','zb','nb');setupZone('fs','zs','ns');
setupZone('fls','zls','nls');setupZone('flsv','zlsv','nlsv');

function checkRWReady() { /* always enabled */ }

function setRWMode(mode, el) {
  rwMode=mode;
  document.querySelectorAll('#rw-modes .mode-btn').forEach(b=>b.classList.remove('active','red'));
  el.classList.add('active','red');
}
function setLSMode(mode, el) {
  lsMode=mode;
  document.querySelectorAll('#ls-modes .mode-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

function togglePrompt(){document.getElementById('img-prompt').style.display=document.getElementById('gen-img').checked?'block':'none';}

// ── Config ──────────────────────────────────────────────────────
fetch('/api/config').then(r=>r.json()).then(cfg=>{
  if(!cfg.hasOpenAI){document.getElementById('gen-img').disabled=true;document.getElementById('no-key').style.display='inline';}
  const n=document.getElementById('ls-script-notice');
  if(cfg.hasLSScripts){
    const files=cfg.lsScriptFiles&&cfg.lsScriptFiles.length?'<br><span style=\"font-size:10px;color:#555\">'+cfg.lsScriptFiles.join(' &nbsp;·&nbsp; ')+'</span>':'';
    n.innerHTML='📋 已读取脚本 Unit '+cfg.lsScriptUnits.join('/')+files;
  } else {
    n.innerHTML='⚠️ 请将脚本文件放入 <code>PW4 LS script/</code> 文件夹，命名如 <code>PW4LS-unit1A.txt</code>';
    n.style.background='#fff8e1';n.style.borderColor='#ffe082';n.style.color='#e65100';
  }
  // RW book notice
  const bookNotice = document.getElementById('rw-book-notice');
  if(cfg.rwBookReady && cfg.rwBookUnits && cfg.rwBookUnits.length){
    bookNotice.style.background='#f0f7f0';
    bookNotice.style.borderColor='#c8e6c9';
    bookNotice.style.color='#2e7d32';
    bookNotice.innerHTML='📖 已载入教材：'+cfg.rwBookFile+' (Unit '+cfg.rwBookUnits.join('/')+'）';
    // Update unit title on change
    document.getElementById('rw-unit').addEventListener('change', function(){
      updateRWTitle();
    });
  } else {
    bookNotice.innerHTML='⚠️ 未检测到教材 PDF，请将课本放入 input/ 文件夹，重启服务器后自动加载。';
  }
  // Script notice
  const rwVidFile = cfg.detectedFiles && cfg.detectedFiles.rwVideo;
  const scriptNotice = document.getElementById('rw-script-notice');
  if(rwVidFile){
    scriptNotice.style.display='block';
    scriptNotice.innerHTML='🎬 视频脚本已自动读取：'+rwVidFile;
  }
  window._rwCfg = cfg;

}).catch(()=>{});

// ── RW Generate ─────────────────────────────────────────────────
function updateRWTitle(){
  const unit = parseInt(document.getElementById('rw-unit').value);
  const cfg = window._rwCfg;
  if(cfg && cfg.rwBookReady){
    // title will be shown after generation
    document.getElementById('rw-unit-title').textContent = 'Unit '+unit;
  }
}

async function goRW(){
  const rwUnit = parseInt(document.getElementById('rw-unit').value);
  if(!rwUnit || rwUnit<1 || rwUnit>10){ alert('请输入 1–10 的 Unit 编号'); return; }
  document.getElementById('btn-rw').disabled=true;
  document.getElementById('stop-rw').style.display='block';
  document.getElementById('rw-prog').classList.add('show');
  document.getElementById('rw-ok').classList.remove('show');
  document.getElementById('rw-er').classList.remove('show');
  rsi(1,'⏳','等待中...');rsi(2,'⏳','等待中...');rsi(3,'⏳','等待中...');

  const fd=new FormData();
  fd.append('section','rw'); fd.append('rwMode',rwMode); fd.append('unit', rwUnit);
  const genImg=document.getElementById('gen-img').checked&&!document.getElementById('gen-img').disabled;
  fd.append('generateImage',String(genImg));
  const ip=document.getElementById('img-prompt').value.trim();if(ip)fd.append('imagePrompt',ip);

  const r=await fetch('/process',{method:'POST',body:fd}); const j=await r.json();
  if(!r.ok){showErr('rw',j.error||'失败');return;}
  jobs.rw=j.jobId;
  document.getElementById('stop-rw').style.display='block';
  timers.rw=setInterval(()=>pollJob('rw'),2500);
}

// ── LS Generate ─────────────────────────────────────────────────
async function goLS(){
  const unit=parseInt(document.getElementById('ls-unit').value);
  if(!unit||unit<1||unit>10){alert('请输入 1–10 的 Unit 编号');return;}
  document.getElementById('btn-ls').disabled=true;
  document.getElementById('ls-prog').classList.add('show');
  document.getElementById('ls-ok').classList.remove('show');
  document.getElementById('ls-er').classList.remove('show');
  lsi(1,'⏳','等待中...');lsi(2,'⏳','等待中...');lsi(3,'⏳','等待中...');

  const fd=new FormData();
  fd.append('section','ls'); fd.append('unit',unit); fd.append('lessonMode',lsMode);
  const lsf=document.getElementById('fls').files[0];if(lsf)fd.append('ls_script',lsf);
  const lsvf=document.getElementById('flsv').files[0];if(lsvf)fd.append('ls_video',lsvf);

  const r=await fetch('/process',{method:'POST',body:fd}); const j=await r.json();
  if(!r.ok){showErr('ls',j.error||'失败');return;}
  jobs.ls=j.jobId;
  document.getElementById('stop-ls').style.display='block';
  timers.ls=setInterval(()=>pollJob('ls'),2500);
}

async function stopJob(sect) {
  if (!jobs[sect]) return;
  await fetch('/stop/'+jobs[sect], {method:'POST'});
  clearInterval(timers[sect]);
  document.getElementById('stop-'+sect).style.display='none';
  document.getElementById('btn-'+sect).disabled=false;
  showErr(sect, '已停止生成');
}

// ── Poll ────────────────────────────────────────────────────────
async function pollJob(sect){
  const r=await fetch('/status/'+jobs[sect]); const j=await r.json();
  if(sect==='ielts'){
    isi(1, j.splitResult ? '✅' : '⏳', j.splitResult || '提取中...');
    if(j.total>0){const p=Math.round((j.done+j.failed)/j.total*100);isi(2,j.status==='done'?'✅':'⏳',j.done+j.failed+'/'+j.total+'（✅'+j.done+' ❌'+j.failed+'）');document.getElementById('ibw').style.display='block';document.getElementById('ibb').style.width=p+'%';}
    if(j.status==='done'){clearInterval(timers.ielts);document.getElementById('ielts-ok').classList.add('show');document.getElementById('ielts-rs').textContent=j.files+' 个文件（学生版+教师版）';document.getElementById('btn-ielts').disabled=false;document.getElementById('stop-ielts').style.display='none';}
    if(j.status==='error'){clearInterval(timers.ielts);showErr('ielts',j.error);document.getElementById('btn-ielts').disabled=false;}
    return;
  }
  if(sect==='rw'){
    rsi(1,j.splitResult?'✅':'⏳',j.splitResult||j.currentDetail||'处理中...');
    rsi(2,j.scriptResult?(j.scriptResult.includes('跳过')||j.scriptResult.includes('未上传')?'➖':'✅'):'⏳',j.scriptResult||'等待中...');
    if(j.total>0){const p=Math.round((j.done+j.failed)/j.total*100);rsi(3,j.status==='done'?'✅':'⏳',\`\${j.done+j.failed}/\${j.total}（✅\${j.done} ❌\${j.failed}）\`);document.getElementById('rbw').style.display='block';document.getElementById('rbb').style.width=p+'%';}
    if(j.status==='done'){clearInterval(timers.rw);document.getElementById('rw-ok').classList.add('show');document.getElementById('rw-rs').textContent=\`\${j.files} 个文件（✅\${j.done} ❌\${j.failed}）\`;document.getElementById('btn-rw').disabled=false;document.getElementById('stop-rw').style.display='none';}
    if(j.status==='error'){clearInterval(timers.rw);showErr('rw',j.error);document.getElementById('btn-rw').disabled=false;}
  } else {
    const prog=j.currentDetail||'处理中...';
    if(j.currentStep?.includes('A'))lsi(1,'⏳',prog);
    else if(j.currentStep?.includes('B'))lsi(2,'⏳',prog);
    else if(j.currentStep)lsi(3,'⏳',prog);
    if(j.total>0){const p=Math.round((j.done+j.failed)/j.total*100);document.getElementById('lbw').style.display='block';document.getElementById('lbb').style.width=p+'%';}
    if(j.status==='done'){
      clearInterval(timers.ls);
      if(j.total===0){
        showErr('ls', j.splitResult||'未找到脚本，请将 PW4LS-unit#A.txt 放入 "PW4 LS script/" 文件夹');
        lsi(1,'⚠️','无脚本');lsi(2,'⚠️','无脚本');lsi(3,'⚠️','无脚本');
      } else {
        const ss=j.stepStatus||{};
        const icon=s=>s==='done'?'✅':s==='skipped'?'➖':s==='pending'?'➖':s?.startsWith('error')?'❌':'✅';
        const label=s=>s==='done'?'完成':s==='skipped'?'跳过（无脚本）':s==='pending'?'未运行':s?.startsWith('error')?s.slice(6):'完成';
        lsi(1,icon(ss.A),label(ss.A));
        lsi(2,icon(ss.B),label(ss.B));
        lsi(3,icon(ss.other),label(ss.other));
        document.getElementById('ls-ok').classList.add('show');
        document.getElementById('ls-rs').textContent=\`\${j.files} 个文件（✅\${j.done} ❌\${j.failed}）\`;
      }
      document.getElementById('btn-ls').disabled=false;document.getElementById('stop-ls').style.display='none';
    }
    if(j.status==='error'){clearInterval(timers.ls);showErr('ls',j.error);document.getElementById('btn-ls').disabled=false;}
  }
}

function rsi(n,ic,dt){document.getElementById('ri'+n).textContent=ic;document.getElementById('rd'+n).textContent=dt;}
function lsi(n,ic,dt){document.getElementById('li'+n).textContent=ic;document.getElementById('ld'+n).textContent=dt;}
function showErr(s,msg){document.getElementById(s+'-er').classList.add('show');document.getElementById(s+'-em').textContent=msg||'出错';}
function dlJob(s){window.location.href='/download/'+jobs[s];}
</script>

<!-- ── IELTS DEEP READING ────────────────────────────────────── -->
<div class="card section-rw" id="ielts-card" style="display:none" data-module="ielts">
  <div class="section-header">
    <span style="font-size:24px">🎓</span>
    <h2 style="color:#1F4E79">IELTS 深度阅读练习册</h2>
  </div>
  <div class="notice blue">📖 上传剑桥雅思真题 Word 文档（C8–C18 .docx），自动识别 Test 1–4 / Reading Passage 1–3，排除 Listening / Writing / Speaking，生成学生练习册 + 教师答案册。</div>

  <div class="grid">
    <div class="zone" id="z-ielts" onclick="document.getElementById('f-ielts').click()" style="cursor:pointer">
      <div class="zi">📖</div>
      <div class="zl">上传雅思 Word 文档</div>
      <div class="zh">Cambridge IELTS C8–C18（.docx 格式）</div>
      <div class="zf" id="n-ielts"></div>
    </div>
    <input type="file" id="f-ielts" accept=".docx,.doc" style="display:none" onchange="ieltsFileChanged(this)">
    <div style="padding:14px;background:#f9f9f9;border-radius:12px;border:1px solid #e0e0e0">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">选择 Test & Passage</div>
      <div style="margin-bottom:8px">
        <label style="font-size:12px">Test 编号：</label>
        <select id="ielts-test" style="padding:5px 8px;border-radius:6px;border:1px solid #ccc;font-size:13px">
          <option value="0">全部 (All)</option>
          <option value="1">Test 1</option><option value="2">Test 2</option>
          <option value="3">Test 3</option><option value="4">Test 4</option>
        </select>
      </div>
      <div>
        <label style="font-size:12px">Passage：</label>
        <select id="ielts-passage" style="padding:5px 8px;border-radius:6px;border:1px solid #ccc;font-size:13px">
          <option value="0">全部 (All)</option>
          <option value="1">Passage 1</option>
          <option value="2">Passage 2</option>
          <option value="3">Passage 3</option>
        </select>
      </div>
    </div>
  </div>

  <button class="btn btn-ls" id="btn-ielts" onclick="goIELTS()" style="margin-top:8px">🎓 生成 IELTS 深度练习册</button>
  <button class="btn btn-stop" id="stop-ielts" onclick="stopJob('ielts')">⛔ 停止</button>

  <div class="prog" id="ielts-prog">
    <div class="step"><div class="si" id="ii1">⏳</div><div><div class="sn">提取 Passage</div><div class="sd" id="id1">等待中...</div></div></div>
    <div class="step"><div class="si" id="ii2">⏳</div><div><div class="sn">生成练习册</div><div class="sd" id="id2">等待中...</div>
      <div class="bw" id="ibw" style="display:none"><div class="bb" id="ibb" style="background:#1F4E79"></div></div>
    </div></div>
  </div>
  <div class="rbox rok" id="ielts-ok"><div class="rt">🎉 完成！</div><div class="rs" id="ielts-rs"></div><button class="btn btn-dl" onclick="dlJob('ielts')">📦 下载 ZIP（学生版 + 教师版）</button></div>
  <div class="rbox rer" id="ielts-er"><div class="rt">❌ 出错</div><div class="rs" id="ielts-em"></div></div>
</div>

<!-- ── FIX TOOL ──────────────────────────────────────────────── -->
<div class="card section-rw" id="fix-card" style="display:none">
  <div class="section-header">
    <span style="font-size:24px">🔧</span>
    <h2 style="color:#2E7D32">IELTS 练习册纠错工具</h2>
  </div>
  <div class="notice" style="background:#F1F8E9;border-color:#A5D6A7;color:#2E7D32">
    📄 上传已生成的 IELTS docx（学生版或教师版，最多 12 份），自动将 Task 1 和 Task 6 更新为新格式。已符合格式的文件自动跳过。
  </div>
  <div id="fix-drop" style="border:2px dashed #A5D6A7;border-radius:12px;padding:28px;text-align:center;cursor:pointer;background:#FAFAFA;margin-bottom:14px"
    onclick="document.getElementById('fix-input').click()"
    ondragover="event.preventDefault();this.style.borderColor='#2E7D32'"
    ondragleave="this.style.borderColor='#A5D6A7'"
    ondrop="event.preventDefault();this.style.borderColor='#A5D6A7';handleFixDrop(event)">
    <div style="font-size:28px;margin-bottom:6px">📂</div>
    <div style="font-size:13px;font-weight:600;color:#444">点击或拖入 docx 文件（最多 12 份）</div>
    <div id="fix-filelist" style="font-size:11px;color:#2E7D32;margin-top:8px;word-break:break-all"></div>
  </div>
  <input type="file" id="fix-input" accept=".docx" multiple style="display:none" onchange="handleFixFiles(this.files)">
  <button class="btn" id="btn-fix" onclick="goFix()" disabled
    style="background:#2E7D32;color:#fff;margin-bottom:6px">🔧 开始纠错 Task 1 &amp; Task 6</button>
  <button class="btn btn-stop" id="stop-fix" style="display:none" onclick="stopJob('fix')">⛔ 停止</button>
  <div class="prog show" id="fix-prog" style="display:none">
    <div class="step"><div class="si" id="fi1">⏳</div>
      <div><div class="sn">处理进度</div><div class="sd" id="fd1">等待中...</div>
        <div class="bw" id="fbw" style="display:none"><div class="bb" id="fbb" style="background:#2E7D32;width:0%"></div></div>
      </div>
    </div>
  </div>
  <div class="rbox rok" id="fix-ok" style="display:none">
    <div class="rt">🎉 完成！</div><div class="rs" id="fix-rs"></div>
    <button class="btn" style="background:#2E7D32;color:#fff;margin-top:10px" onclick="dlJob('fix')">📦 下载纠错后的文件 (ZIP)</button>
  </div>
  <div class="rbox rer" id="fix-er" style="display:none">
    <div class="rt">❌ 出错</div><div class="rs" id="fix-em"></div>
  </div>
</div>
</body></html>`;


// ════════════════════════════════════════════════════════════════
// IELTS PIPELINE
// ════════════════════════════════════════════════════════════════
async function runIELTSPipeline(job, pdfBuf, fileName, testNum, passageNum) {
  // Extract book code from filename e.g. "C8.pdf" → "C8", "cambridge_ielts_9.pdf" → "C9"
  // Match "C8", "C12" etc. directly from filename
  const bookMatch = (fileName||'').match(/C(\d{1,2})/i);
  const bookCode  = bookMatch ? 'C' + bookMatch[1] : 'C?';
  const upd = (s, d) => { job.currentStep = s; job.currentDetail = d; };

  upd('提取 Passage', '解析 PDF...');
  const all = await extractAllPassages(pdfBuf);

  // Filter by test / passage selection
  let passages = all;
  if (testNum > 0)    passages = passages.filter(p => p.test === `Test ${testNum}`);
  if (passageNum > 0) passages = passages.filter(p => p.passage === `READING PASSAGE ${passageNum}`);

  if (!passages.length) {
    job.status = 'error';
    job.error  = `未找到匹配的 Passage（test=${testNum} passage=${passageNum}）。请确认 PDF 是剑桥雅思真题格式。`;
    return;
  }

  job.splitResult = `找到 ${passages.length} 篇 Passage（${passages.map(p=>p.test+' '+p.passage).join(', ')}）`;
  job.total = passages.length; job.done = 0; job.failed = 0; job.files = [];

  for (const passage of passages) {
    if (job.cancelled) break;
    const label = `${passage.test} ${passage.passage}`;
    upd('生成练习册', `${job.done + job.failed + 1}/${job.total} "${passage.title || label}"`);

    try {
      const data = await generateIELTS(passage);
      // Inject bookCode and passage metadata into the parsed JSON
      if (data.passageInfo) {
        data.passageInfo.bookCode = bookCode;
        data.passageInfo.test     = passage.test;
        data.passageInfo.passage  = passage.passage;
      }
      const { studentBuffer, teacherBuffer, studentPdf, teacherPdf } = await buildIELTSDocs(data);

      const safeTitle = (passage.title || label).replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').slice(0, 40);
      const tNum = passage.test.replace('Test ','');
      const pNum = passage.passage.replace('READING PASSAGE ','');
      const stem = `IELTS_${bookCode}_Test${tNum}_Reading${pNum}_${safeTitle}`;

      job.files.push({ folder:'ielts', name:`${stem}_Student.docx`,  buf:studentBuffer });
      job.files.push({ folder:'ielts', name:`${stem}_Teacher.docx`, buf:teacherBuffer });
      if (studentPdf) job.files.push({ folder:'ielts', name:`${stem}_Student.pdf`,  buf:studentPdf });
      if (teacherPdf) job.files.push({ folder:'ielts', name:`${stem}_Teacher.pdf`, buf:teacherPdf });
      job.done++;
    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data||err.message) : err.message;
      console.error(`[IELTS] ❌ ${label}:`, errMsg);
      job.failed++;
      job.lastError = errMsg;
    }
  }

  job.status = 'done';
}

// ════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/', (_, res) => res.send(HTML));

app.get('/api/debug-ls/:unit', (req, res) => {
  const unit = parseInt(req.params.unit) || 1;
  const { getLSScripts, scanAvailable } = require('./src/ls_script_reader');
  // 清除模块缓存强制重新读取
  Object.keys(require.cache).filter(k=>k.includes('ls_script_reader')).forEach(k=>delete require.cache[k]);
  const reader = require('./src/ls_script_reader');
  const scan   = reader.scanAvailable();
  const scripts = reader.getLSScripts(unit);
  res.json({
    scriptDir:  scan.scriptDir,
    dirExists:  require('fs').existsSync(scan.scriptDir),
    allFiles:   require('fs').readdirSync(scan.scriptDir).filter(f=>!f.startsWith('.')),
    files:      scan.byFile,
    unit,
    scriptA:    { length: scripts.A.length, preview: scripts.A.slice(0,80) },
    scriptB:    { length: scripts.B.length, preview: scripts.B.slice(0,80) },
  });
});

app.get('/api/config', (_, res) => {
  const rwUnits  = Object.keys(UNIT_SCRIPTS).map(Number).sort((a,b)=>a-b);
  const lsScan   = scanAvailable();
  const lsFileUnits = [...new Set(lsScan.byFile.map(f=>f.unit))].sort((a,b)=>a-b);
  const lsUnits  = lsFileUnits.length ? lsFileUnits : lsScan.byCompiled;
  res.json({
    hasOpenAI:     !!OpenAIClient,
    hasRWScripts:  rwUnits.length>0, rwScriptUnits: rwUnits,
    rwBookReady:   rwBookLoader.cache.ready,
    rwBookUnits:   rwBookLoader.getAvailableUnits(),
    rwBookFile:    rwBookLoader.cache.bookFile,
    hasLSScripts:  lsUnits.length>0, lsScriptUnits: lsUnits,
    hasLSVideo:    Object.keys(autoLoader.cache.lsVideoScripts).length>0,
    lsVideoUnits:  Object.keys(autoLoader.cache.lsVideoScripts).map(Number).sort((a,b)=>a-b),
    hasLSWords:    Object.keys(autoLoader.cache.lsWordList).length>0,
    loadedFiles:   autoLoader.cache.loaded,
    detectedFiles: autoLoader.cache.detectedFiles,
    lsScriptFiles: lsScan.byFile.map(f=>f.file),
    wordlistUnits: Object.keys(UNIT_WORDLIST).map(Number).sort((a,b)=>a-b)
  });
});

app.post('/process', upload.any(), async (req, res) => {
  const all      = req.files||[];
  const section  = req.body?.section||'rw';
  const jobId    = Math.random().toString(36).slice(2,9).toUpperCase();
  const job      = { id:jobId, status:'processing', currentStep:'', currentDetail:'',
                     splitResult:null, scriptResult:null, total:0, done:0, failed:0, files:[] };
  jobs.set(jobId, job);
  res.json({ jobId });

  if (section === 'ielts') {
    // Debug: log all received fields
    console.log('[IELTS] req.files fields:', (req.files||[]).map(f=>f.fieldname+':'+f.originalname));
    console.log('[IELTS] req.body keys:', Object.keys(req.body||{}));
    // Accept both ielts_docx (new) and ielts_pdf (legacy cache) field names
    const ieltsDocxFile = all.find(f => f.fieldname === 'ielts_docx' || f.fieldname === 'ielts_pdf');
    const ieltsPdfBuf   = ieltsDocxFile?.buffer || null;
    if (!ieltsPdfBuf) { job.status='error'; job.error='未上传 Word 文档（请刷新页面后重试）'; return; }
    const ieltsFileName = ieltsDocxFile?.originalname || 'unknown.docx';
    const testNum    = parseInt(req.body?.testNum)    || 0;
    const passageNum = parseInt(req.body?.passageNum) || 0;
    console.log(`[job ${jobId}] IELTS extract test=${testNum} passage=${passageNum} file=${ieltsFileName}`);
    runIELTSPipeline(job, ieltsPdfBuf, ieltsFileName, testNum, passageNum)
      .catch(e => { job.status='error'; job.error=e.message; });
  } else if (section==='ls') {
    const unit       = parseInt(req.body?.unit)||1;
    const lessonMode = req.body?.lessonMode||'both';
    const lsScriptBuf= all.find(f=>f.fieldname==='ls_script')?.buffer||null;
    const lsVideoBuf = all.find(f=>f.fieldname==='ls_video')?.buffer||null;
    console.log(`[job ${jobId}] LS Unit ${unit} Lesson ${lessonMode}`);
    runLSPipeline(job, unit, lessonMode, lsScriptBuf, lsVideoBuf)
      .catch(e=>{job.status='error';job.error=e.message;});
  } else {
    const rwUnit    = parseInt(req.body?.unit) || 0;
    const bookFiles  = all.filter(f=>f.fieldname==='book');
    const scriptBuf  = all.find(f=>f.fieldname==='script')?.buffer||null;
    job.generateImage= req.body?.generateImage==='true' && !!getOpenAIClient();
    job.imagePrompt  = req.body?.imagePrompt||'';
    job.wordListMap  = UNIT_WORDLIST;

    // Use pre-loaded unit article if available
    if (rwUnit > 0 && rwBookLoader.cache.ready) {
      const article = rwBookLoader.getArticle(rwUnit);
      if (!article) {
        job.status='error'; job.error=`Unit ${rwUnit} 未在教材中找到，请确认教材已正确加载`; return;
      }
      const ch = String(rwUnit).padStart(2,'0');
      const videoScript = autoLoader.cache.rwVideoScripts[rwUnit] || '';
      const items = [
        { type:'Reading', chapter:rwUnit, title:article.title, buffer:article.pdfBuffer },
        ...(videoScript ? [{ type:'VideoReading', chapter:rwUnit, title:`Unit ${rwUnit} Video`, text:videoScript }] : [])
      ];
      job.splitResult = `Unit ${rwUnit}: ${article.title}`;
      job.scriptResult = videoScript ? '✅ 视频脚本已加载' : '无视频脚本';
      job.total = items.length; job.done = 0; job.failed = 0; job.files = [];
      console.log(`[job ${jobId}] RW Unit ${rwUnit} "${article.title}", video:${videoScript?'✅':'❌'}`);
      const upd = (s,d) => { job.currentStep=s; job.currentDetail=d; };
      (async()=>{ for(const item of items){ if(job.cancelled) break; await processItem(job,item,upd); } job.status='done'; })()
        .catch(e=>{job.status='error';job.error=e.message;});
      return;
    }

    // Fallback: uploaded files (legacy mode)
    console.log(`[job ${jobId}] RW fallback mode: ${bookFiles.length} files`);
    if(!bookFiles.length && !scriptBuf){
      job.status='error'; job.error='请先等待教材加载，或上传教材 PDF'; return;
    }
    if (bookFiles.length===0 && scriptBuf) {
      job.splitResult='仅处理 Script';
      const txt=await getScriptText(scriptBuf), secs=splitScript(txt);
      const items=secs.map(s=>({type:'VideoReading',chapter:s.unit,title:`Unit ${s.unit} Video`,text:`${s.marker}\n\n${s.content}`}));
      job.total=items.length; job.scriptResult=`${secs.length} 段脚本`;
      for(const item of items){if(job.cancelled)break;await processItem(job,item,(s,d)=>{job.currentStep=s;job.currentDetail=d;});}
      job.status='done';
    } else {
      const buf = bookFiles.length>0 ? bookFiles[0].buffer : null;
      if(buf) extractPageTexts(buf).then(pages=>{
        const{startPages,endPages}=findBoundaries(pages);
        return (startPages.length>=2&&endPages.length>=2)?runPipeline(job,buf,scriptBuf):runBatch(job,bookFiles,scriptBuf);
      }).catch(e=>{job.status='error';job.error=e.message;});
    }
  }
});

app.post('/stop/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({error:'不存在'});
  if (j.status === 'processing') {
    j.cancelled = true;
    j.status = 'cancelled';
    j.error = '用户已停止生成';
  }
  res.json({ok: true, status: j.status});
});

app.get('/status/:id', (req, res) => {
  const j=jobs.get(req.params.id);
  if(!j) return res.status(404).json({error:'不存在'});
  res.json({status:j.status,currentStep:j.currentStep,currentDetail:j.currentDetail,
    splitResult:j.splitResult,scriptResult:j.scriptResult,
    total:j.total,done:j.done,failed:j.failed,files:j.files.length,
    stepStatus:j.stepStatus||{},error:j.error||j.lastError||null});
});

app.get('/download/:id', (req, res) => {
  const j=jobs.get(req.params.id);
  if(!j||!j.files.length) return res.status(404).json({error:'无文件'});
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition',`attachment; filename="worksheets_${req.params.id}.zip"`);
  const arc=archiver('zip',{zlib:{level:6}});
  arc.pipe(res);
  for(const f of j.files) arc.append(f.buf,{name:(f.folder?f.folder+'/':'')+f.name});
  arc.finalize();
});

// ════════════════════════════════════════════════════════════════
// FIX IELTS TASKS  (批量纠错 Task 1 & Task 6)
// ════════════════════════════════════════════════════════════════
app.post('/fix-ielts-tasks', upload.any(), async (req, res) => {
  const files = (req.files||[]).filter(f =>
    f.originalname.toLowerCase().endsWith('.docx'));
  if (!files.length) return res.status(400).json({error:'未上传 .docx 文件'});

  const jobId = Math.random().toString(36).slice(2,9).toUpperCase();
  const job   = { id:jobId, status:'processing', currentStep:'纠错', currentDetail:'',
                  total:files.length, done:0, failed:0, skipped:0, files:[] };
  jobs.set(jobId, job);
  res.json({ jobId });

  (async () => {
    // ── Group files by base name to share shuffle between student/teacher pairs ──
    // e.g.  "IELTS_C17_Test1_P1_Student.docx"  +  "...Teacher.docx"  → same shuffle
    function baseName(name) {
      return name
        .replace(/_FIXED_[^.]+\.docx$/i, '.docx') // strip previous fix suffix
        .replace(/(_Student|_Teacher)\.docx$/i, '.docx')
        .toLowerCase();
    }

    const groups = new Map();
    for (const f of files) {
      const key = baseName(f.originalname);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }

    for (const [, groupFiles] of groups) {
      // Compute ONE shared shuffle from any file in the group (pairs are identical)
      let sharedShuffles = null;
      // Prefer merged shuffles (student headings + teacher answers) for pairs
      const stuFile = groupFiles.find(f => /student/i.test(f.originalname));
      const tchFile = groupFiles.find(f => /teacher/i.test(f.originalname));
      try {
        if (stuFile && tchFile) {
          sharedShuffles = computeMergedShuffles(stuFile.buffer, tchFile.buffer);
        } else {
          // Prefer teacher file for strategy; fall back to student
          const teacherFile = groupFiles.find(f => /teacher/i.test(f.originalname));
          sharedShuffles = computeShufflesFromDoc((teacherFile || groupFiles[0]).buffer);
        }
      } catch(e) { console.warn('[fix] shuffle compute failed:', e.message); }

      for (const file of groupFiles) {
        job.currentDetail = file.originalname;
        try {
          const result = await fixIELTSDoc(file.buffer, file.originalname, sharedShuffles);
          if (result.skipped) {
            job.skipped++;
            console.log('[fix] ➖ '+file.originalname+': '+result.reason);
          } else {
            job.done++;
            const prefix = result.fixed.join('+');
            const outName = file.originalname.replace(/\.docx$/i, '_FIXED_'+prefix+'.docx');
            job.files.push({ name: outName, buf: result.buffer });
            console.log('[fix] ✅ '+file.originalname+' → '+prefix+' ('+result.role+')');
          }
        } catch(e) {
          job.failed++;
          console.error('[fix] ❌ '+file.originalname+':', e.message);
        }
      }
    }
    job.status = 'done';
    job.currentDetail = '';
  })().catch(e => { job.status='error'; job.error=e.message; });
});

Promise.all([autoLoader.init(), rwBookLoader.load()]).then(() => {
  // Prevent HTML caching
app.use((req, res, next) => {
  if (req.path === '/') res.set('Cache-Control', 'no-store');
  next();
});
app.listen(PORT, () => console.log(`\n🚀  作业生成器：http://localhost:${PORT}\n`));
}).catch(e => { console.error('Init error:', e); process.exit(1); });
