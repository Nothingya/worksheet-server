# 前端 UI 改动（放在 🎓 IELTS 阅读模块下方，同一标签页内新增子区块）

在 IELTS 标签页的 Reading 区块 **下方** 插入以下 HTML + JS：

```html
<!-- ════════ IELTS Listening Review（阅读下方）════════ -->
<div class="ls-section" style="margin-top:24px;border-top:2px solid #e5e7eb;padding-top:16px;">
  <h3>🎧 IELTS Listening 复盘 Worksheet</h3>

  <!-- Step 1: 上传/解析一本书 -->
  <div class="ls-ingest">
    <label>① 上传剑桥真题 .docx（解析一次后自动缓存）</label>
    <input type="file" id="lsFile" accept=".docx" />
    <button onclick="lsIngest()">解析并缓存</button>
    <span id="lsIngestStatus"></span>
  </div>

  <!-- Step 2: 选书 + 选 Test -->
  <div class="ls-generate" style="margin-top:12px;">
    <label>② 选择书目</label>
    <select id="lsBook" onchange="lsRefreshTests()"></select>

    <label>选择 Test</label>
    <select id="lsTest">
      <option value="all">全部 Test</option>
    </select>

    <button onclick="lsGenerate()">生成 Worksheet</button>
    <span id="lsGenStatus"></span>
  </div>
</div>

<script>
// 载入已缓存书目
async function lsLoadBooks() {
  const r = await fetch('/ls/books');
  const books = await r.json();
  const sel = document.getElementById('lsBook');
  sel.innerHTML = '';
  books.forEach(b => {
    const o = document.createElement('option');
    o.value = b.key;
    o.textContent = `${b.bookTitle} (${b.key})  ·  Tests: ${b.tests.join('/')}`;
    o.dataset.tests = JSON.stringify(b.tests);
    sel.appendChild(o);
  });
  lsRefreshTests();
}
// 根据选中的书刷新可用 Test
function lsRefreshTests() {
  const opt = document.getElementById('lsBook').selectedOptions[0];
  const tests = opt ? JSON.parse(opt.dataset.tests || '[]') : [];
  const ts = document.getElementById('lsTest');
  ts.innerHTML = '<option value="all">全部 Test</option>';
  tests.forEach(tn => {
    const o = document.createElement('option');
    o.value = tn; o.textContent = `Test ${tn}`;
    ts.appendChild(o);
  });
}
// 解析+缓存
async function lsIngest() {
  const f = document.getElementById('lsFile').files[0];
  if (!f) return alert('请选择 .docx 文件');
  const st = document.getElementById('lsIngestStatus');
  st.textContent = '解析中（首次需调用 AI，请稍候）…';
  const fd = new FormData();
  fd.append('file', f);
  const r = await fetch('/ls/ingest', { method:'POST', body:fd });
  const j = await r.json();
  if (j.ok) {
    st.textContent = `✅ ${j.bookTitle} 已缓存，可用 Tests: ${j.tests.join('/')}`;
    await lsLoadBooks();
  } else {
    st.textContent = '❌ ' + (j.error || '失败');
  }
}
// 生成下载（单个=docx，全部=zip）
async function lsGenerate() {
  const bookKey = document.getElementById('lsBook').value;
  const testSel = document.getElementById('lsTest').value;
  if (!bookKey) return alert('请先选择书目');
  const st = document.getElementById('lsGenStatus');
  st.textContent = '生成中…';
  const r = await fetch('/ls/generate', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ bookKey, testSel })
  });
  if (!r.ok) { st.textContent = '❌ ' + (await r.json()).error; return; }
  const blob = await r.blob();
  const cd = r.headers.get('Content-Disposition') || '';
  const fn = (cd.match(/filename="(.+?)"/) || [])[1]
    || (testSel==='all' ? bookKey+'_AllTests.zip' : bookKey+'_Test'+testSel+'.docx');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fn; a.click();
  URL.revokeObjectURL(url);
  st.textContent = '✅ 已下载 ' + fn;
}
// 页面载入时拉一次书目
lsLoadBooks();
</script>
```

## 用户操作流程
1. 把 .docx 拖到上传框（或先放进 `ielts_listening_input/` 文件夹）→ 点「解析并缓存」
2. 系统调用一次 AI 解析全部 Test → 写入 `ielts_listening_cache/<book>.json`（**只需一次**）
3. 之后从下拉选书 + 选 Test（1/2/3/4 或「全部 Test」）→ 点「生成 Worksheet」即时下载
   - 单个 Test → 下载 .docx
   - 全部 → 下载 zip（含所有 Test）
