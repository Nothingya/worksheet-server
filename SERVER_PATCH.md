# server.js 改动（放在 IELTS 阅读模块下方）

## 1. 顶部 require（与其它 build_* 并列）
```js
const { ingestBook, generateDocx, listCachedBooks, INPUT_DIR }
  = require('./src/listening_cache');
const archiver = require('archiver');   // 若未装：npm i archiver
```

## 2. 三个路由（加在 IELTS 路由附近）

```js
// ── A. 列出已缓存的书目（前端下拉用）────────────────────
app.get('/ls/books', (req, res) => {
  res.json(listCachedBooks());
});

// ── B. 上传 / 解析一本书（读取一次→保存记忆）────────────
//   也支持把文件先丢进 ielts_listening_input/ 再传 fileName
app.post('/ls/ingest', upload.single('file'), async (req, res) => {
  try {
    const force = req.body.force === 'true';
    let fileName, bufferOrPath;
    if (req.file) {                       // 直接上传
      fileName = req.file.originalname;
      bufferOrPath = req.file.buffer || require('fs').readFileSync(req.file.path);
    } else if (req.body.fileName) {       // 已放入 input 文件夹
      fileName = req.body.fileName;
      bufferOrPath = fileName;
    } else {
      return res.status(400).json({ error: '需要上传文件或提供 fileName' });
    }
    const result = await ingestBook(bufferOrPath, fileName, { force });
    res.json({
      ok: true, cached: result.cached, bookTitle: result.bookTitle,
      tests: Object.keys(result.tests).map(Number).sort(),
      key: fileName.replace(/\.docx$/i, ''),
    });
  } catch (e) {
    console.error('[LS ingest]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── C. 生成 docx（Test 1/2/3/4 或 all）──────────────────
app.post('/ls/generate', async (req, res) => {
  try {
    const { bookKey, testSel } = req.body;       // testSel: '1'|'2'|'3'|'4'|'all'
    const results = await generateDocx(bookKey, testSel);
    if (results.length === 0) return res.status(404).json({ error: '无可生成的 Test' });

    if (results.length === 1) {                  // 单个 → 直接下载 docx
      const r = results[0];
      res.setHeader('Content-Disposition',
        `attachment; filename="${r.fileName}"`);
      res.setHeader('Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      return res.send(r.buffer);
    }
    // 多个(all) → 打包 zip
    res.setHeader('Content-Disposition',
      `attachment; filename="${bookKey}_Listening_AllTests.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    for (const r of results) archive.append(r.buffer, { name: r.fileName });
    archive.finalize();
  } catch (e) {
    console.error('[LS generate]', e);
    res.status(500).json({ error: e.message });
  }
});
```

## 3. 依赖
```bash
npm i mammoth jsonrepair archiver   # jsonrepair/mammoth 可能已装
```
（generate 用的 @anthropic-ai/sdk 项目已有）

---

## 4. 启动时自动扫描（核心：一次性读取）

在 server.js 启动监听前加：

```js
const { scanAndIngestAll } = require('./src/listening_cache');

// 开机扫描 ielts_listening_input/：未缓存的 .docx 解析一次,已缓存跳过
scanAndIngestAll()
  .then(() => console.log('[LS] 启动扫描完成,缓存就绪'))
  .catch(e => console.error('[LS] 启动扫描出错:', e.message));
```

### 本地完整流程（doc 只读一次）
```
1. 把 C20.docx 丢进 worksheet-server/ielts_listening_input/
2. pm2 restart server
   → 自动检测到新文件 → 调一次 AI 解析 → 写 ielts_listening_cache/C20.json
   → 控制台打印 "✅ 完成: C20.docx"
3. 之后任意时刻(含再次重启): 网页选书+选Test → 直接从缓存JSON生成,不再调AI、不用再传doc
```

### 要点
- 已缓存的书在重启时打印 "已缓存,跳过" —— **不会重复调用 AI**
- 缓存 JSON 持久化在本地磁盘,pm2 重启不丢
- 想强制重新解析某本书: 删掉对应的 `ielts_listening_cache/<book>.json` 再重启,或调 `/ls/ingest` 传 `force=true`
