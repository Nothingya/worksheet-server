// src/extract.js
// Level 1: pdf-parse  → 简单文字 PDF
// Level 2: pdf2json   → 图文混排教材（本地，无 API，无内容过滤）

const pdfParse = require('pdf-parse');
const PDFParser = require('pdf2json');
const fs = require('fs');

async function extractText(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);

  // Level 1: pdf-parse
  try {
    const data = await pdfParse(buffer);
    const text = data.text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    if (text.length >= 200) return text;
    console.log('    [extract] pdf-parse 内容不足，切换到 pdf2json...');
  } catch (e) {
    console.log('    [extract] pdf-parse 失败，切换到 pdf2json...');
  }

  // Level 2: pdf2json（本地，图文混排 PDF 专用）
  return extractWithPdf2json(buffer);
}

function extractWithPdf2json(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);

    parser.on('pdfParser_dataReady', () => {
      const raw = parser.getRawTextContent() || '';
      const text = raw
        .replace(/----------------Page \(\d+\) Break----------------/g, '\n')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      if (text.length < 100) {
        reject(new Error('无法提取文字，PDF 可能是纯扫描图片，请先 OCR 处理。'));
      } else {
        resolve(text);
      }
    });

    parser.on('pdfParser_dataError', (err) => {
      reject(new Error('pdf2json 解析失败：' + (err.parserError || err)));
    });

    parser.parseBuffer(buffer);
  });
}

module.exports = { extractText };
