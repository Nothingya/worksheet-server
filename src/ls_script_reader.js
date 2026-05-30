// src/ls_script_reader.js
const fs   = require('fs');
const path = require('path');
const SCRIPT_DIR = path.join(__dirname, '..', 'PW4 LS script');

let _compiled = null;
function getCompiled() {
  if (!_compiled) {
    try { _compiled = require('./ls_script_data').UNIT_LS_SCRIPTS; }
    catch(_) { _compiled = {}; }
  }
  return _compiled;
}

// RTF 转纯文本
function stripRtf(buf) {
  const s = buf.toString('binary');
  let out = '', i = 0, depth = 0, skipDepth = -1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      depth++;
      const peek = s.slice(i + 1, i + 14);
      if (/^\\(fonttbl|colortbl|stylesheet|info|pict)/.test(peek)) skipDepth = depth;
      i++; continue;
    }
    if (ch === '}') {
      if (depth === skipDepth) skipDepth = -1;
      depth--; i++; continue;
    }
    if (skipDepth !== -1) { i++; continue; }
    if (ch !== '\\') { out += ch; i++; continue; }
    i++;
    if (i >= s.length) break;
    const nx = s[i];
    if (nx === '\\') { out += '\\'; i++; continue; }
    if (nx === '{' || nx === '}') { out += nx; i++; continue; }
    if (nx === '\n' || nx === '\r') { out += '\n'; i++; continue; }
    if (nx === "'") { i += 3; continue; }
    let word = '';
    while (i < s.length && /[a-zA-Z*]/.test(s[i])) { word += s[i]; i++; }
    while (i < s.length && /[-\d]/.test(s[i])) i++;
    if (i < s.length && s[i] === ' ') i++;
    if (word === 'par' || word === 'line') out += '\n';
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function readFile(filepath) {
  const buf = fs.readFileSync(filepath);
  // 检查内容是否是 RTF（不管扩展名，以 {\rtf 开头就是 RTF）
  const header = buf.slice(0, 6).toString('binary');
  if (header.startsWith('{\\rtf') || header.startsWith('{\rtf')) {
    const text = stripRtf(buf);
    if (text.length > 20) return text;
  }
  return buf.toString('utf8').trim();
}

function tryRead(unit, lesson) {
  if (!fs.existsSync(SCRIPT_DIR)) return null;
  const bases = [
    'PW4LS-unit' + unit + lesson,
    'PW4LS-unit' + unit + lesson.toLowerCase(),
    'PW4LS-Unit' + unit + lesson,
    'PW4LS-unit' + String(unit).padStart(2,'0') + lesson,
    'unit' + unit + lesson,
    'u' + unit + lesson,
  ];
  const exts = ['.rtf', '.txt', '.RTF', ''];
  for (const base of bases) {
    for (const ext of exts) {
      const p = path.join(SCRIPT_DIR, base + ext);
      if (fs.existsSync(p)) {
        const text = readFile(p);
        if (text.length > 20) {
          console.log('    [LS] Unit' + unit + lesson + ' -> ' + base + ext + ' (' + text.length + 'chars)');
          return text;
        }
      }
    }
  }
  // 模糊扫描所有文件（不限扩展名）
  try {
    const target = ('unit' + unit + lesson).toLowerCase();
    for (const file of fs.readdirSync(SCRIPT_DIR)) {
      if (file.startsWith('.')) continue;
      if (file.toLowerCase().replace(/[^a-z0-9]/g,'').includes(target)) {
        const text = readFile(path.join(SCRIPT_DIR, file));
        if (text.length > 20) {
          console.log('    [LS] Unit' + unit + lesson + ' -> ' + file + ' (模糊 ' + text.length + 'chars)');
          return text;
        }
      }
    }
  } catch(_) {}
  return null;
}

function getLSScript(unit, lesson) {
  return tryRead(unit, lesson) || (getCompiled()||{})[unit]?.[lesson] || '';
}
function getLSScripts(unit) {
  return { A: getLSScript(unit,'A'), B: getLSScript(unit,'B') };
}

function scanAvailable() {
  const byFile = [];
  if (fs.existsSync(SCRIPT_DIR)) {
    try {
      for (const file of fs.readdirSync(SCRIPT_DIR)) {
        if (file.startsWith('.')) continue;
        const m = file.match(/unit[_\-]?(\d+)[_\-]?([AB])/i);
        if (m) {
          try {
            const text = readFile(path.join(SCRIPT_DIR, file));
            byFile.push({ unit:parseInt(m[1]), lesson:m[2].toUpperCase(), file, chars:text.length });
          } catch(e) {
            byFile.push({ unit:parseInt(m[1]), lesson:m[2].toUpperCase(), file, chars:0, error:e.message });
          }
        }
      }
    } catch(_) {}
  }
  byFile.sort((a,b) => a.unit - b.unit || a.lesson.localeCompare(b.lesson));
  const compiled = getCompiled()||{};
  const byCompiled = Object.keys(compiled).map(Number)
    .filter(u=>compiled[u]?.A||compiled[u]?.B).sort((a,b)=>a-b);
  return { byFile, byCompiled, scriptDir:SCRIPT_DIR };
}

module.exports = { getLSScript, getLSScripts, scanAvailable };
