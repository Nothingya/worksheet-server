# Bug Report — Worksheet Generator
# 按时间顺序记录。每次修复前必须先阅读本文件。

---

## #001 · setup_ls_scripts 边界识别失败
**症状** 多个 Unit 的 Lesson A 或 B 缺失（显示"缺失"）。
**根因** PDF 提取时页眉/页码插入在 `C.` 和 `DETAILS` 之间，正则无法匹配。
**修复** 多层 fallback：adjacent → C.+300chars → MAIN IDEAS → speaker labels。
**状态** ✅ 已修复

---

## #002 · 词表解析只找到1个Unit
**症状** `parseLSWordList` 只返回一个 Unit 的词。
**根因** 正则要求严格多列格式，PDF 提取后列间距不一致导致失败。
**修复** 改为极简正则：首部是词、尾部是数字即可。
**状态** ✅ 已修复

---

## #003 · UI显示"未检测到内置脚本"（文件名不一致）
**症状** 运行 setup 后重启，UI 仍显示黄色警告。
**根因** setup 写入 `ls_script_data.js`，server 读 `script_ls_data.js`，文件名不同。
**修复** 统一为 `ls_script_data.js`。
**状态** ✅ 已修复

---

## #004 · RTF 文件无法读取（.txt 扩展名但内容是 RTF）
**症状** 脚本文件存在但 `getLSScripts()` 返回空。
**根因** 文件扩展名改为 `.txt` 后，readFile 不走 RTF 解析路径。检测依赖扩展名而非文件内容。
**修复** 改为检测文件内容开头 `{\rtf`，与扩展名无关。
**状态** ✅ 已修复

---

## #005 · Part 3/4 填空线太短
**症状** Dictation 和 Table Summary 里的横线只有 3 个下划线。
**根因** `(N)___` 替换逻辑复杂且不稳定；Claude 有时不遵守格式。
**修复** 改从 prompt 层面解决：要求 Claude 直接生成长横线 `_____________`（12+）；build 直接渲染原文。
**状态** ✅ 已修复

---

## #006 · LS 词汇笔记未生成
**症状** 生成听力作业时无词汇笔记文件。
**根因** `willVocab` 依赖外部词表 PDF，未放置时为 `false`。
**修复** `willVocab = true` 始终生成；无词表时 Claude 从脚本文本自动提取词汇。
**状态** ✅ 已修复

---

## #007 · LS Video 文件名含 A/B
**症状** `PW4 LS U7AB Video Practice.docx`。
**根因** 文件名拼接时使用了 `lessonMode`。
**修复** Video 文件名固定为 `PW4 LS U7 Video Practice.docx`。
**状态** ✅ 已修复

---

## #008 · 填空线视觉太短（underline spaces 方案失败）
**症状** 填空线看起来只有一格宽。
**根因** `UnderlineType.SINGLE` 加空格在 Word 里宽度不稳定。
**修复** 改回连续下划线 `___`，按答案字母数 ×2，最少8个。后来进一步改为从 prompt 生成长横线。
**状态** ✅ 已修复

---

## #009 · 页码位置居中
**症状** 页脚页码显示在页面中央。
**修复** footer 段落 `AlignmentType.CENTER` → `AlignmentType.RIGHT`。
**状态** ✅ 已修复

---

## #010 · Answer Key 未另起一页
**症状** Answer Key 紧接正文，无分页。
**根因** `new PageBreak()` 在某些 docx.js 版本里效果不稳定。
**修复** 改用 `pageBreakBefore: true` 属性，加在 Answer Key 标题段落上。
**状态** ✅ 已修复（VideoPractice 仍用 PageBreak，因为已有效果）

---

## #011 · Part 2 乱码（双编号 + 星号）
**症状** `6.  ____  **6.**  ____  statement text`，编号和横线出现两次。
**根因** Claude 生成的 statement 字段包含 `**6.** _____ text` 前缀，build 代码又额外加了编号和横线。
**修复**
- `cleanStatement()` 函数去除所有前缀格式：`**6.**`、`*6.*`、`6.`、`6)`
- `prompt_listening.js` 加入明确禁止规则
**状态** ✅ 已修复

---

## #012 · 文档标题包含文章名
**症状** 标题显示 `PW4 RW U01 Sustainable Tourism`，包含文章描述。
**修复** server.js 覆盖 `data.title` 为纯代码格式：`PW4 LS U1A Listening Practice`。
**状态** ✅ 已修复

---

## #013 · prompt_listening.js 语法错误（文字写入文件开头）
**症状** 服务器启动报 `SyntaxError: Unexpected identifier 'FORMATTING'`。
**根因** 用 `node -e` 追加规则文字时，内容写到了 JS 代码之前（文件最开头），Node 将其当 JS 解析。
**修复** 将规则文字正确插入 prompt 模板字符串内部（backtick 之后）。
**预防** 以后修改 prompt 文件只在字符串内部操作，不要在文件头部插入内容。
**状态** ✅ 已修复

---

## #014 · build_video.js PageBreak 未导入
**症状** 服务器报 `PageBreak is not defined`。
**根因** 之前的自动化脚本把 `PageBreak` 从 import 里删掉了，但函数体里仍在使用。
**修复** 在 docx require 里补回 `PageBreak`。
**预防** 修改 import 时同时搜索所有使用点，确保一致。
**状态** ✅ 已修复

---

## #015 · 文件放错目录（src/ 文件放到根目录）
**症状** 服务器无法找到模块，`Cannot find module`。
**根因** 用户手动移动文件时，将应在 `src/` 的文件放到了根目录，同时把 `server.js` 也误移进 `src/`。
**修复** 手动将文件移回正确位置：
- 根目录：`server.js`, `setup_*.js`, `split*.js`, `cli.js`
- `src/`：所有 `build_*.js`, `generate_*.js`, `prompt_*.js`, `extract.js`, `*_data.js`, `*_reader.js`, `auto_loader.js`
**预防** 每次替换文件前确认目标路径。
**状态** ✅ 已修复

---

## #016 · IELTS 模块集成——JS代码暴露在页面上（未在 script 标签内）
**症状** 浏览器页面顶部显示一整段 JS 代码原文，所有按钮失效。
**根因** patch 脚本将 IELTS JS 代码插入到 HTML 模板字符串（const HTML = \`...\`）的 `<script>` 标签**外部**，Node.js 将其当普通 HTML 文本输出给浏览器。
**修复** 将 IELTS JS 块正确移入 `<script>...</script>` 标签内部。
**预防** 向 HTML 模板字符串中插入 JS 时，必须确认插入位置在 `<script>` 之后、`</script>` 之前。
**状态** ✅ 已修复

---

## #017 · IELTS 集成后 PW4/LS 所有按钮全部失效
**症状** 页面能显示，但 Reading/Listening 所有生成按钮点击无反应。Console 报：`SyntaxError: Unexpected end of input`，`switchModule is not defined`。
**根因** IELTS poll 代码块被插入到 `pollJob()` 函数的闭合 `}` **外部**，导致整个 `<script>` 块语法错误，所有 JS 函数无法加载。
**修复** 将 IELTS 检查改为 `pollJob()` 函数内部的 early-return 模式：在函数开头加 `if(sect==='ielts'){ ... return; }`，完全不改动原有 rw/ls 结构。
**预防** 向已有函数内部插入分支时，必须用 `node --check` 验证 JS 语法，并单独提取 `<script>` 内容再次 `node --check`。
**状态** ✅ 已修复

---

## #018 · IELTS 标签切换后仍为灰色
**症状** 点击 IELTS 标签后，标签背景仍为灰色，视觉上看不出已激活。
**根因** `.module-tag.active` CSS 固定为红色（`#C00000`），`switchModule` 虽然给 tag-ielts 加了 `active` 类，但颜色与 PW4 红色相同且视觉上不够明显；更根本的是 `active` 类本来就是红色，不适合 IELTS 蓝色主题。
**修复** 新增 `.module-tag.ielts-active { background:#1F4E79!important; border-color:#1F4E79!important }` CSS 类，切换时同时添加 `active` 和 `ielts-active` 两个类。
**状态** ✅ 已修复

---

## #019 · IELTS 模块文件上传无法点击
**症状** 切换到 IELTS 后，点击上传区域没有文件选择弹窗。
**根因** 上传区域用 `onclick` 触发内部隐藏 `<input type="file">` 的 `.click()`，但该 input 的父元素 `ielts-card` 初始为 `display:none`，部分浏览器（尤其 Safari）对隐藏父元素内的 input 调用 `.click()` 有安全限制。
**修复** 将 `<input type="file">` 改为 `position:absolute` 全覆盖在上传区域上的透明叠加层（`opacity:0; width:100%; height:100%; z-index:10`），用户直接点击区域即触发原生文件选择，不再依赖 JS `.click()`。
**状态** ✅ 已修复

---

## #020 · PW4/LS card 没有 id，switchModule 无法控制显示/隐藏
**症状** 切换到 IELTS 后，PW4 和 LS 两个卡片没有被隐藏，仍然显示在页面上。
**根因** `switchModule` 通过 `getElementById('pw4-card')` 和 `getElementById('ls-card')` 控制显示，但原始 HTML 中这两个 div 没有 id。
**修复** 给 RW card 加 `id="pw4-card"`，给 LS card 加 `id="ls-card"`。
**状态** ✅ 已修复

---

## #021 · IELTS 文件上传选择后无反应（文件名不显示）
**症状** 点击上传区域可以选文件，但选完后文件名不显示，区域没有变绿，goIELTS 按钮仍报"请上传文件"。
**根因** `setupZone('f-ielts', 'z-ielts', 'n-ielts')` 在页面加载时执行，此时 `ielts-card` 为 `display:none`，`getElementById('f-ielts')` 返回 null（元素在隐藏容器内无法被找到），`if(!inp)return` 直接退出，change 事件监听器从未绑定。
**修复** 将 setupZone 调用改为懒初始化：在 `switchModule('ielts')` 把卡片设为 `display:block` 之后，用 `window._ieltsZoneReady` 标志确保只绑定一次 change 监听器。
**预防** 对 `display:none` 容器内的 DOM 元素，不在页面加载时绑定事件；改为在容器变为可见后再初始化。
**状态** ✅ 已修复


---

## #022 · IELTS Passage 拆分失败——正则不匹配 OCR 间距文字
**症状** Passage 1 找到后生成失败（❌1），Passage 2/3 完全找不到（"未找到匹配的 Passage"）。
**根因** Cambridge IELTS PDF 的 OCR 字体在 "READING PASSAGE" 各字母之间插入空格：`R E A D I N G  P A S S A G E  1`，原正则 `READING\s+PASSAGE\s+([123])` 无法匹配。
**修复** 将 PASSAGE_RE 改为逐字符允许空白：`R\s*E\s*A\s*D\s*I\s*N\s*G\s+P\s*A\s*S\s*S\s*A\s*G\s*E\s+([123])`。
**状态** ✅ 已修复（ielts_splitter.js v2/v3）

---

## #023 · IELTS Passage 拆分中途中断——"Test N" 运行页眉触发 flush
**症状** 只有个别 Passage 被提取，其余缺失。
**根因** Cambridge 书籍每个奇数页都有 "Test 2" 等运行页眉（Running Header）。拆分器将其当作新 Test 开始，执行 `flush + collecting=false`，导致正在收集的 Passage 文本被截断。
**修复** 遇到 "Test N" 时**只更新 `currentTest` 标签，不停止收集**。改为仅在遇到 WRITING/LISTENING/SPEAKING/GENERAL TRAINING 或下一个 READING PASSAGE 头部时才停止。
**状态** ✅ 已修复（ielts_splitter.js v3）

---

## #024 · IELTS Passage 重复提取——同一篇出现两次
**症状** 同一 Test/Passage 出现两次（wordCount 不同）。
**根因** Cambridge 格式中，每篇 Passage 有两页：① 含题目指令的头部页（仅少量正文）；② 实际文章页（完整正文）。两页都触发了 PASSAGE_RE，各自产生一条记录。
**修复** 改用字典去重：同 (test, passage) 键只保留 wordCount 最高的版本。
**状态** ✅ 已修复（ielts_splitter.js v3）

---

## #025 · IELTS 生成错误信息未暴露到 UI
**症状** 生成完成显示 ❌1，但 UI 只显示"0个文件"，无法知道具体错误原因。
**修复** `runIELTSPipeline` catch 块中将 `err.message` 写入 `job.lastError`，在 `/status` 路由返回给前端。错误信息现在显示在进度框中。
**状态** ✅ 已修复


---

## #026 · IELTS 生成报 404 not_found_error
**症状** `[IELTS] ❌ 404 {"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}`
**根因** `src/generate_ielts.js` 中模型名写成了 `claude-sonnet-4-20250514`，该模型 ID 不存在。
**修复** 改为 `claude-sonnet-4-5`（与项目其他 generate_*.js 文件保持一致）。
**预防** 新建 generate_*.js 文件时，直接从现有文件复制 model 字段，不要手写模型 ID。
**状态** ✅ 已修复


---

## #027 · EADDRINUSE 端口冲突——pm2 与手动 node 同时运行
**症状** 每次手动 `node server.js` 报 `EADDRINUSE :::3000`。
**根因** pm2 已在后台持有端口 3000，手动再启动第二个实例必然冲突。
**正确工作流** 不要手动 `node server.js`，始终用 `pm2 restart server`。
**初次注册** `pm2 start server.js --name server`，之后每次更新文件只需 `pm2 restart server`。
**状态** ✅ 已确认（非代码bug，操作问题）


---

## #028 · IELTS JSON 截断——max_tokens 不足
**症状** `JSON parse error: Unterminated string in JSON at position 15085`，生成报 ❌。
**根因** `generate_ielts.js` 的 `max_tokens: 4000` 不足以容纳完整的6任务 JSON 输出（实际需要 ~6000–8000 tokens）。
**修复** 改为 `max_tokens: 16000`。
**状态** ✅ 已修复


---

## #029 · IELTS 文档全面重新设计（格式 + PDF 生成）
**改动内容**
- 字体：全部改为 Times New Roman
- 字号：正文 12pt，副标题 14pt，标题 16pt
- 行间距：1.15（docx `LineRuleType.AUTO` × 276）
- 标题格式：`IELTS C8 Test 1 Reading 1`（bookCode 从 PDF 文件名自动提取）
- Task 5 流程图：三层结构（Tier1 篇章主旨 → Tier2 段落主旨 → Tier3 重要细节），保留流程图视觉风格，简化内容
- PDF 生成：通过 `soffice --headless --convert-to pdf` 将 DOCX 转换为 PDF；输出 Student.docx + Student.pdf + Teacher.docx + Teacher.pdf 共 4 个文件打包进 ZIP
- 设计：采用颜色色块标题栏（学生版蓝色 #2E75B6，教师版红色 #C00000），更整洁的表格布局
**状态** ✅ 已完成


---

## #030 · IELTS 文档格式 v3（5项修复）
**修复清单**
1. **字号层级**：主标题仅 16pt；Task 色块标题 13pt；所有正文 12pt（副标题不再单独加大）
2. **Task 1 打乱**：右栏（同义改写）使用 Fisher-Yates 算法随机排序，教师版附打乱后的右栏参考对照表
3. **去掉多余加粗**：表格内容统一 `bold:false`，仅标题栏和教师版答案保留加粗
4. **书号正则修复**：`/C(\d{1,2})/i` 直接匹配 `C8.pdf` → `C8`（原正则 `Cambridge...` 可选组导致匹配失败）
5. **设计升级**：仿 PW4 样式——深色色块标题栏配 emoji 图标（🔄✂️🔍⚖️🗺️🏷️）、Name/Class/Date 行、干净 1.15 行距
**状态** ✅ 已修复


---

## #031 · Task 1 & Task 5 题型逻辑重构
**Task 1 修改**
- 左栏（A–F）：题干表达（IELTS 考题中的 paraphrase 表达，字段 `questionExpression`）
- 右栏（1–6）：原文表达（passage 中的原句，字段 `originalExpression`，学生版打乱顺序）
- 教师版附带：左栏←→右栏对照表 + 打乱后的右栏参考顺序

**Task 5 修改**（参考图片格式）
- 按文章意思划分 Section I/II/III/IV，每 Section 标注覆盖段落（如 Para A & B）
- 每 Section 列出 2–4 条重要细节（带填空，≤3词，原文提取）
- 相关细节之间插入逻辑连接词框（如 "VS.", "Geographic Contrast", "Cause→Effect", "Limitation"）
- **不写各 Section 的主旨**（主旨移至 Task 6 匹配题）

**Task 6 对应更新**
- 匹配对象改为 Section I/II/III/IV 的主旨（heading）
- 学生版答题格表按 sectionLabel 显示

**状态** ✅ 已完成


---

## 文件位置速查表

```
worksheet-server/          ← 根目录
├── server.js
├── cli.js
├── setup_scripts.js
├── setup_ls_scripts.js
├── setup_ls_wordlist.js
├── split.js
├── split_script.js
├── BUG_REPORT.md
├── PW4 LS script/         ← 听力脚本文件夹（.txt/.rtf）
└── src/
    ├── auto_loader.js
    ├── build.js
    ├── build_listening.js
    ├── build_video.js
    ├── build_vocab.js
    ├── extract.js
    ├── generate.js
    ├── generate_listening.js
    ├── generate_video.js
    ├── generate_vocab.js
    ├── ielts_splitter.js       ← 新增 v3：剑桥雅思PDF自动拆分（支持间距OCR、去重、排除GT）
    ├── generate_ielts.js       ← 新增：IELTS深度练习册生成
    ├── build_ielts.js          ← 新增：IELTS学生版+教师版docx构建
    ├── ls_script_data.js
    ├── ls_script_reader.js
    ├── ls_wordlist_data.js
    ├── parse_wordlist.js
    ├── prompt.js
    ├── prompt_listening.js
    ├── prompt_video.js
    ├── prompt_vocab.js
    ├── script_data.js
    └── wordlist_data.js
```

## 操作规范（预防未来 bug）

1. **每次修改 server.js 后必须运行** `node --check server.js`
2. **涉及 HTML 模板字符串内的 `<script>` 修改时**，额外提取 script 内容单独 `node --check`
3. **向函数内插入分支时**，用括号计数器确认闭合
4. **替换文件前确认路径**：根目录文件 vs `src/` 文件不可混淆
5. **每次修改完成后更新本文件**，追加新的 bug 记录
