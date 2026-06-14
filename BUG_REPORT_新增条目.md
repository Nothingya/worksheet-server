<!-- 追加到本地 BUG_REPORT.md 末尾；若本地最新编号不是 #052，请相应顺延 -->

---

## #053 · 新增：PW4 模板修复工具（🧰 PW4模板 标签）
**需求** 旧版 PW4 docx 内容不变，按新模板规则重排。
**实现** 新文件 `src/fix_pw4_template.js`，外科式 XML 修补（zlib+archiver，无新依赖）。
自动识别 4 类文档（reading / video / vocab / listening），上传最多 12 份，输出 `_新模板.docx`。
**新模板规则**
- Reading：删 Name/Date；P3 T/F/NG 空 18→10 下划线；P2→P3、P5→P6 取消分页；
  P7 去 `[ ]`，按原句相邻 1–3 词分组、组间 `/` 分隔；Q5 改托福 Prose Summary 六选三
  （Introductory Sentence 由 Claude API 生成，6 选项与答案字母不变；无 API key 时用回退句并在日志标注）
- Video：补题号（P1: 1–5，P2: 6–10，答案键同步）；P2 句前加答题空；Dictation 1.5 行距（兼容旧版 240 行距）
- 词汇笔记：Part 1 后分页；中文 10pt→12pt；P2/P4 题序重排去字母序（题目与答案键同一置换，配对不变）；
  P3 匹配答案若呈 A,B,C… 顺序则重排定义文本（答案键同步）
- 通用：文件名与标题 U0X → UX
**验证** 5 份样本全部通过；词汇笔记 P2 配对 15/15、P3 词-定义语义配对人工抽查正确；XML well-formed。
**状态** ✅ 完成

---

## #054 · build_video.js md() 误删题号与答题空（根因修复）
**症状** Video Practice 的 Part 1/2 无题号、Part 2 无答题横线。
**根因** `md()` 清洗函数含 `.replace(/^\d+\.\s+/,'')` 与 `.replace(/^[_\s]+/,'')`，
而题号 run `R(q.number+'.  ')` 和答题空 run `R('____________')` 都经过 `md()`，整段被剥成空字符串。
**修复** `md()` 仅清除 markdown 星号并折叠词间多余空格（保留行首缩进）；
行首数字清理只保留在 `cleanStatement()` 中。Part 2 题号固定 6–10 接续 Part 1，答案键同步。
**状态** ✅ 已修复

---

## #055 · 生成端同步新模板（build/prompt 全面更新）
**变更**
- `src/build.js`：删 Name/Date（作业版+黑板版）；P3 空缩短；P2→P3、P5→P6 取消分页；
  P7 按 `answer` 原句 1–3 词分组渲染（不再依赖单词 chunks）；Q5 渲染托福 Prose Summary 格式（`q.intro` 字段）
- `src/build_video.js`：md() 修复 + P2 答题空 + Dictation `line:360`
- `src/build_vocab.js`：Part 1 后 `PageBreak`；中文 run 12pt；新增并默认调用 `desequenceVocabData()`
  （P2/P4 字母序检测后洗牌，P3 顺序 key 检测后重排定义），已导出供复用
- `src/build_listening.js`：Dictation `line:360`
- `src/prompt.js`：Q5 规范改为 TOEFL Prose Summary（新增 `intro` 字段，6 选项=3 主旨+3 干扰）
- `server.js`：RW 文件名/标题 `U01`→`U1`（去 padStart）；新增 🧰 PW4模板 标签页 + `/fix-pw4-template` 路由
**状态** ✅ 完成

---

## #056 · PW4 Reading 排版微调（间隔 + T/F/NG 空）
**需求** P4↔P5、P6↔P7 间隔太大（实为单独分页）；T/F/NG 答题空再缩短到原长 1/4。
**修复**
- `src/build.js`：删除 P4→P5、P6→P7 的 `PageBreak`，改为普通间隔段（`sp(240,0)` 空行）。
  现保留分页仅 2 处：P1→P2、答案键前。P2–P7 连续排版。
- `src/build.js` + `src/fix_pw4_template.js`：T/F/NG 答题空 10→5 下划线（原始 ~18 的约 1/4）。
- 修复工具同步删除 P5/P6/P7 前残留分页。
**验证** 生成端与修复工具两端输出一致：分页仅 P1→P2 与答案键前；P3 空 5 下划线。
**状态** ✅ 完成

---

## #057 · 修复工具：Video 答案页 P3/P4 缺题号
**症状** 修复工具处理旧 Video Practice 时，答案页 Part 3（Table Summary）与 Part 4（Dictation）
答案为无题号纯列表（旧文件本就如此），与题目区填空编号 (11)–(35) 对应不上。
**修复** `fixVideo()` 答案键补题号逻辑从 P1/P2 扩展到 P3/P4；
各部分起始号按前一部分实际答案行数累加（P1=1 起，P2/P3/P4 接续），不写死。
**验证** 答案键编号 P1(1–5)/P2(6–10)/P3(11–18)/P4(19–35) 与题目区填空 (11)–(35) 完全对应。
**状态** ✅ 完成

---

## #058 · 修复工具：中文文件名乱码（multer latin1 误读）
**症状** PW4模板工具输出的「词汇笔记」文件名在 macOS 显示为乱码 `è¯æ±ç¬è®°`。
**根因** multer 默认按 latin1 解析 multipart 文件名，上传含中文的 docx 时 `f.originalname`
已是被误读的字节序列；修复工具据此派生 `newName`，乱码被继承。
（ZIP 容器本身正常：archiver 7 已设 UTF-8 标志位 bit 11；生成端文件名为源码 UTF-8 字面量，不受影响。）
**修复** `fix_pw4_template.js` 入口新增 `fixMojibakeName()`：将 latin1 误读的名字按字节还原后以
UTF-8 重新解码；仅当还原结果无 U+FFFD 且原名含高位字节时采用，对纯 ASCII / 已正确中文名幂等。
**验证** 乱码名 `PW4 LS U3A è¯æ±ç¬è®°.docx` → 还原为 `PW4 LS U3A 词汇笔记_新模板.docx`；
英文名与已正确中文名均保持不变。
**状态** ✅ 完成

---

## #059 · 文档内标题统一为「PW4 RW U1 词汇笔记」格式
**症状** RW 词汇笔记文档内主标题显示为文章名（如 The Moving Assembly Line Revolution），
而非 PW4 命名格式；Reading 文档内标题为 Reading Practice 与文件名 Reading Homework 不一致。
**根因** 生成端 RW 词汇笔记分支未覆盖 `vdata.title`，沿用了 Claude 生成的文章标题
（LS 词汇笔记分支有覆盖，故正常）；Reading 主标题用 Reading Practice 与文件名不统一。
**修复**
- 修复工具 `fix_pw4_template.js`：新增 `setDocTitle()` + `titleFromName()`，
  将文档首个非空标题段替换为文件名主体（去 .docx/_新模板，U0X→UX），保留原样式与副标题。幂等。
- 生成端 `server.js`：RW 词汇笔记分支补 `d.title='PW4 RW U'+ch+' 词汇笔记'`；
  Reading 主标题 `Reading Practice`→`Reading Homework`（与文件名统一；副标题小字保持 Reading Practice）。
**验证** 修复工具：词汇笔记标题 The Moving... → PW4 RW U1 词汇笔记；Reading → PW4 RW U1 Reading Homework；
已正确者幂等不动。生成端两端一致。
**状态** ✅ 完成

---

## #060 · 新增：板书完整版工具（📋 板书完整版 标签）
**需求** Reading Blackboard（板书版）改造：① 挖空大纲 → 完整版参考答案大纲（不挖空、去答案键）；
② 文末追加 200 字中文文章内容总结（调 API 生成）。独立工具，上传旧板书 docx → 改造。
**实现** 新文件 `src/fix_blackboard.js`：
- 解析末尾 Answer Key 的 `(N) answer` 配对映射；
- `rebuildBlankPara()` 用全文本重组挖空段（对多 run 拆分免疫），把 `(N) ____` 替换为答案
  （蓝色加粗），删除下划线与编号；删除整个答案键区块；
- 指令行 `Complete the mind map...` 改写为「完整版大纲（参考答案）」；
- 收集全部大纲要点喂 Claude API（sonnet-4-5）生成 180–220 字中文总结，作为「📖 文章内容总结」
  追加到 `<w:sectPr>` 之前（文末）；无 API key 时跳过并在日志标注；
- 含 `fixMojibakeName` 修正中文文件名；输出 `_完整版.docx`，U0X→UX。
- `server.js`：新增 📋 板书完整版 标签页 + `/fix-blackboard` 路由。
**验证** 6 个挖空全部填答案；含 `&`、无 before、plain 混合等边界正确；答案键/下划线/编号清除；
中文总结追加成功；XML well-formed。
**状态** ✅ 完成（生成端板书仍为挖空版，如需同步生成端可后续处理）

---

## #061 · 板书工具：总结基于按 Unit 匹配的真实原文
**需求** 板书 200 字总结应基于真实文章原文，而非板书大纲碎片；原文按 Unit 从已有教材匹配，
不重新生成 Reading Homework。
**实现**
- `fix_blackboard.js`：`defaultSummaryGen` 改为接收 `{articleText, outlineText, title}`；
  `articleText` 长度 >200 时基于原文（截断 8000 字）生成，否则回退大纲要点。`fixBlackboardDoc`
  新增 `opts.articleText` 入参，notes 标注「基于原文 / 基于大纲」。
- `server.js` `/fix-blackboard` 路由：从板书文件名提取 Unit 号（U1/U01/U3A→数字），
  调 `rwBookLoader.getArticle(unit)` 取 `input/Ch##_Reading_*.pdf`，经 `extractText()` 转文本传入。
  Unit 无 PDF 或提取失败时回退大纲总结，不阻断。
**三层逻辑** ① 有原文→基于原文（最准）② 无原文→基于大纲 ③ 无 API key→跳过总结、仍出完整版大纲。
**验证** U1 板书 → 匹配 Unit 1 教材 PDF（15265 字符）→ 总结标注「基于原文」；
无原文场景正确回退「基于大纲」；10 个 Unit PDF 均可索引。
**状态** ✅ 完成

---

## #062 · 新增：PW3 模板工具（📒 PW3模板 标签，独立于 PW4）
**背景** PW3 与 PW4 是两套不同渲染模板（Reading 用「数字+emoji」无 Part 字样；Video/LS 用 Part X:
冒号分隔；T/F 空在行首；编号方案不同）。为避免改坏 PW4 模板，**独立**新建 PW3 处理器，
现有 PW4/板书工具完全不动。
**实现** 新文件 `src/fix_pw3_template.js`，只做 PW3 实测需要项，已正确处一律不碰：
- **Video**：补题号（P1 1–5、P2 6–10，答案键同步）+ Dictation 1.5 行距。
  ⚠️ P1 题干识别改用「粗体结构」而非疑问词——否则会漏 "According to..." 类题干导致编号错位
  （这正是先前误判 P1=4、看似"漏 10"的根因；实际 P1=5+P2=5=10，P3 从 11 连续）。
- **Listening**：仅 Dictation 1.5 行距（题号/答题空 PW3 已正确）。
- **Reading**：T/F/NG 行首空 _______(7)→(5)。Q5 已 Prose Summary、无 Name/Date、P7 已 /分隔、分页已对，均不动。
- **词汇笔记**：仅清 \xa0（P3 已打乱、中文已 12pt、已分页，均不动）。
- **通用**：标题规范化（保留 U1A/U2B/U3A/B/U4B/U9B 后缀）；清 \xa0 不间断空格；
  文件名双下划线→单。`detectType` 优先用文件名区分 Video/Listening（PW3 文档内标题为文章名，
  内容结构相同易误判）。
- `server.js`：新增 📒 PW3模板 标签页 + `/fix-pw3-template` 路由。
**验证** 11 份 PW3 样本（U1/U2A/U2B/U3/U4B/U6/U8A/U9B 等）全部通过：Video 编号 1–10 连续含 10；
标题后缀全保留；\xa0 全清；已正确文件（如 U2B 词汇笔记）零改动；XML 全部 well-formed。
**状态** ✅ 完成

---

## #063 · PW3 工具改为「PW4 样式注入」（重写 #062）
**需求修正** 用户最终明确：要把 PW3 文档的样式/排版改成 PW4 外观，内容文字与位置不动
（非补题号那种小修，也非重新生成）。
**重写** `fix_pw3_template.js` 改为纯样式注入，不再补题号/缩短空/改结构：
- **全局**：页边距 1440→1080；行距 240→276(1.15)；东亚字体(楷体/宋体等)→Times New Roman；
  关闭 before/afterAutospacing；清 \xa0。
- **配色**：遍历段落，文档大标题→红 C00000 加粗；Part 标题(Part X / 数字+emoji)→蓝 1F4E79 加粗；
  Instructions 说明→灰 595959 斜体。用「替换 run 内已有 color」方式（PW3 run 多已带 000000）。
- 内容文字、题目顺序、表格结构、Part 标题文字一律不动。输出 `_PW4样式.docx`。
**已知局限（纯样式无法消除的结构差异）**：PW3 Part 标题文字仍是「3. ✅True/False」结构
（PW4 为「Part 3. … ✅」）；PW3 用 Word 自动编号(numPr)；表格边框/表头底色仍是 PW3 原样。
如需 100% 一致需重新生成（用户已否决，且会改动内容位置）。
**验证** 11 份 PW3 样本全部通过：行距/页边距/字体/配色对齐 PW4；大标题红、Part 蓝、说明灰斜体
正确落地；XML 全部 well-formed；内容零改动。
**状态** ✅ 完成

---

## #064 · 新增：PW3 内容提取 + PW4 重生成模块
**需求** 从 PW3 docx 提取内容，用 PW4 builder 重新生成（输出 100% PW4 样式）；内容取自 PW3
文档本身（不重新出题）；标题统一 "PW3 RW U1A 类型"（保留 U#A/B）。
**实现** 两个新文件：
- `src/pw3_extract.js`：ZIP 读 document.xml；解析顶层块（段落/表格保序）；Part 区域定位
  （兼容 "Part 1:" / "Part 1." / "1. emoji"）。
- `src/pw3_regen.js`：四类提取器 + 重生成主入口 `regenFromPW3()`：
  - **video/listening**：P1 题干+选项、P2 陈述、P3 三列表格、P4 听写 speaker:text；
    答案键 P1 字母/P2 TFNG/P3/P4，编号 P1:1-5 P2:6-10 P3:11+ P4 接续。
  - **vocab**：P1 词条（word/pos/中文/搭配/例句/派生词，兼容无编号与短语词如 "focus on"）；
    P2 Word Formation；P3 匹配表；P4 Quiz；答案键 P3 兼容纯字母列表(D G J…按序配题号)。
  - **reading**：7-part（Mind Map / MCQ+Prose Summary / TFNG / Summary / Cloze / Imitation /
    Unscramble）尽力提取，喂 PW4 homework builder。
  - 用文件名提 PW3/RW|LS/U#A/B 组装标题；mojibake 修正；输出 `_PW4重生成.docx`。
- `server.js`：PW3 标签页加第二按钮「♻️ 提取内容+重生成」+ `/regen-pw3` 路由。
**验证** 12 份样本全部生成：Video 5题+选项+表格+听写+答案键完整、PW4 格式正确；
Vocab 词条/搭配/派生词/P3匹配答案(1.D 2.G…)正确；标题含 RW/LS+U#A/B；XML 全部有效。
**已知局限** Reading 7-part 结构最复杂，提取可能不完整（尤其 Part1 mind map 答案、Part4/5），
标注为需重点核对；Video/Listening/Vocab 质量较高。
**状态** ✅ 完成（Reading 实验性）

---

## #065 · PW3 重生成多项提取修复（依用户反馈）
**修复项**
- **Video/Listening**：P4 听写吞并答案键 → `partRegion` 与 P4 边界均在 Answer Key 处截断
  （根因：无 Part 5，区域延伸到文末把答案键卷入听写）。
- **Vocab**：P2 Word Formation（15句）、P4 Quiz（10句）未生成 → 原要求 `^\d+.` 编号且末尾括号，
  PW3 实为无编号、base_word 在答案键；改为「含 ___ 的句子即题目」，跳过词库单词行。
- **Reading**：
  · P3 TFNG 把 ·TRUE/·FALSE/·NOT GIVEN 定义说明行标了序号 → 跳过定义行，只取 _____ 开头真题。
  · P4 Word Bank 未生成 → PW3 为 "A. Dome / B. Heat" 字母列表，改为逐项提取。
  · P6 Sentence Imitation 未生成 → PW3 为 Original:/(中文)/Your Task: 格式，重写解析。
  · 答案全部未生成 → 新增 `extractReadingAnswers`，按 "N. 节名" 分节收集（P1–P7）。
  · 答案键与正文混排+重复 → `sec()` 所有节在 Answer Key 处截断，P7 不再卷入答案键。
- **Listening emoji**：`build_listening.js` Part 标题加 emoji（🎯✅📊🖊️，对齐 video）；
  注意此改动同时令生成端 PW4 LS 显示 emoji（更统一）。
**验证** 12 份样本全部生成，XML 有效；Video 听写不混答案键；Vocab P2/P4 齐全；
Reading P3 无定义行、P4 word bank、P6、答案键 P1–P7 完整、答案键唯一；LS Part 带 emoji。
**状态** ✅ 完成

---

## #066 · PW3 重生成再修（依用户截图反馈）
- **LS Instructions 重复**：PW3 Part4 说明句是 "Listen to the passage..."（不以 Instructions 开头），
  被当听写内容提取，叠加 builder 自带灰字说明 → 两份。修复：P4 跳过含
  "NO MORE THAN / Complete the sentences / Listen to the passage" 等指令特征的行。
- **RW Reading Q5 Introductory Sentence 未识别**：PW3 中 "Introductory Sentence:" 为空行，
  引导句在下一行。修复：检测到该标签后读下一行（非选项/非题号）作为 intro。
- **Reading P4 Word Bank**：PW3 是表格（A.Dome|B.Heat…），原按段落字母列表提取失败且表格占位
  [[TABLE]] 混入 passage。修复：从表格单元格提词，passage 跳过表格行。
**验证** LS Part4 仅 1 处灰字说明 + 直接 Host 听写；Reading Q5 intro 正确（Yellowstone…）；
P4 word bank 8 词、passage 无占位；12 份 XML 有效。
**状态** ✅ 完成

---

## #067 · 新增：TOEFL 场景图生成模块（🎨 场景图 标签，OpenAI）
**需求** 输入 prompt 文本，调 OpenAI 图片 API 生成 TOEFL 口语词汇场景图。第一版直接输入 prompt，
预留后续「多选拼 prompt」扩展。
**实现** 新文件 `src/generate_image.js`：
- `buildPrompt(rawPrompt, options)`：第一版用 rawPrompt；预留 scene/style/elements/mood 多选拼接位；
  自动追加教学风格约束（清晰、教学用、无文字）。
- `generateImage()`：dall-e-3，response_format=b64_json 直接拿字节，返回 {buffer, prompt, revisedPrompt}。
- **懒加载** OpenAI client（`getClient()`）——避免无 OPENAI_API_KEY 时模块加载即崩溃。
- `server.js`：新增 🎨 场景图 标签页（prompt 输入框 + 尺寸/质量选择）+ `/gen-image` 路由
  （同步返回 base64，前端直接显示+下载）。导入重命名为 `generateSceneImage` 避免与已有
  RW 导览图的 `generateImage` 撞名。
**注意** server.js 早有 OpenAI 封装（RW 导览图用 getOpenAIClient），新模块独立并存不冲突；
未配 OPENAI_API_KEY 时服务器正常启动，仅该功能友好报错。
**状态** ✅ 完成（第一版，多选待扩展）

---

## ⚠️ 部署提醒（针对 #062 后的 MODULE_NOT_FOUND 崩溃）
server.js 第 35 行 require 新 src 模块；部署时若漏拷新文件 → 启动崩溃。
本对话新增 6 个 src 文件（fix_pw4_template / fix_blackboard / fix_pw3_template /
pw3_extract / pw3_regen / generate_image），修改 6 个文件（server.js + build*.js + prompt.js）。
**务必全部上传，建议用 git pull 而非手动 cp 以防遗漏。详见「部署清单.md」。**
