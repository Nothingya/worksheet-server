#!/usr/bin/env node
// cli.js  —  Batch worksheet generator
//
// 支持格式：.pdf  .txt
// Usage:
//   node cli.js ./input ./output

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { extractText }     = require('./src/extract');
const { generateContent } = require('./src/generate');
const { buildBothDocs }   = require('./src/build');

const args      = process.argv.slice(2);
const inputArg  = args[0] || process.env.INPUT_DIR  || './input';
const outputArg = args[1] || process.env.OUTPUT_DIR || './output';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌  ANTHROPIC_API_KEY not set. Add it to your .env file.');
  process.exit(1);
}

fs.mkdirSync(outputArg, { recursive: true });

// Collect PDF + TXT files
let inputFiles = [];
const stat = fs.statSync(inputArg);
if (stat.isDirectory()) {
  inputFiles = fs.readdirSync(inputArg)
    .filter(f => f.toLowerCase().endsWith('.pdf') || f.toLowerCase().endsWith('.txt'))
    .map(f => path.join(inputArg, f));
} else if (inputArg.toLowerCase().endsWith('.pdf') || inputArg.toLowerCase().endsWith('.txt')) {
  inputFiles = [inputArg];
} else {
  console.error('❌  Input must be a PDF/TXT file or a folder.');
  process.exit(1);
}

if (inputFiles.length === 0) {
  console.error(`❌  No PDF or TXT files found in "${inputArg}".`);
  process.exit(1);
}

console.log(`\n📂  Found ${inputFiles.length} file(s) → output: "${outputArg}"\n`);

(async () => {
  let success = 0, fail = 0;

  for (const filePath of inputFiles) {
    const base = path.basename(filePath, path.extname(filePath));
    const ext  = path.extname(filePath).toLowerCase();
    console.log(`⏳  Processing: ${path.basename(filePath)}`);

    try {
      // 1. Extract text
      process.stdout.write('    [1/3] Extracting text... ');
      const text = ext === '.txt'
        ? fs.readFileSync(filePath, 'utf8')
        : await extractText(filePath);
      console.log(`done (${text.length} chars)`);

      // 2. Call Claude API
      process.stdout.write('    [2/3] Calling Claude API... ');
      const data = await generateContent(text, base.replace(/[_-]/g, ' '));
      console.log(`done → "${data.title}"`);

      // 3. Build docx
      process.stdout.write('    [3/3] Building Word documents... ');
      const { homeworkBuffer, blackboardBuffer } = await buildBothDocs(data);

      const hwPath = path.join(outputArg, `${base}_Homework.docx`);
      const bbPath = path.join(outputArg, `${base}_Blackboard.docx`);
      fs.writeFileSync(hwPath, homeworkBuffer);
      fs.writeFileSync(bbPath, blackboardBuffer);
      console.log('done');
      console.log(`    ✅  Saved:\n       ${hwPath}\n       ${bbPath}\n`);
      success++;

    } catch (err) {
      console.error(`\n    ❌  Failed: ${err.message}\n`);
      fail++;
    }
  }

  console.log('─'.repeat(50));
  console.log(`✅  Done. ${success} succeeded, ${fail} failed.`);
  console.log(`📁  Output: ${path.resolve(outputArg)}`);
})();
