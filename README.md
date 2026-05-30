# 📚 作业生成器 Worksheet Generator

自动将 EFL/ESL 阅读文章生成完整七部分作业（作业版 + 板书版），基于 Claude API。

---

## 架构图

```
PDF 文章（单篇 / 多篇 / 整本教材）
         │
         ▼
① 文字提取（pdf-parse / pdf2json 两级）
         │
         ▼
② Claude API（claude-sonnet-4-5，含 Prompt Caching）
         │ ← 返回结构化 JSON
         ▼
③ Word 文档生成（docx 库）
         │
         ├── 作业版_Homework.docx   ← 完整 7 个 Part + 答案解析
         └── 板书版_Blackboard.docx ← Part 1 思维导图 2×2 格
```

---

## 生成的作业内容（7 Part）

| Part | 题型 | 说明 |
|------|------|------|
| 1 | Mind Map 思维导图 | 10–15 空，大纲列表 + Emoji，每空 ≤ 3 词 |
| 2 | Reading Comprehension | 5 题：细节题、指代题、推断题 + 主旨题（6选3）|
| 3 | True / False / Not Given | 5 题，题号后留横线填写答案 |
| 4 | Summary Completion | 5–8 空，Word Bank 表格 |
| 5 | Fill in Missing Letters | 同主题新文章，8–10 空，首字母 + 下划线提示 |
| 6 | Sentence Imitation | 5 句原文 + 中文翻译 + 5 句仿写练习（汉译英）|
| 7 | Unscramble | 5 句逐词拆散排序（含冠词、介词、连接词）|

板书版只包含 Part 1（2×2 四格，10 空，答案列于底部）。

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY=sk-ant-...
```

### 3. 选择运行方式

---

## 方式 A：网页界面（推荐）

```bash
node server.js
# 或后台运行（开机自启）：
pm2 start /完整路径/server.js --cwd /完整路径
pm2 save
```

浏览器访问 `http://localhost:3000`

**网页支持三种模式（自动识别）：**

| 上传内容 | 自动处理方式 |
|----------|--------------|
| 1 个整本教材 PDF（含 "PREPARING TO READ" 边界）| 自动拆分 → 逐篇生成 |
| 1 个单篇文章 PDF | 直接生成 |
| 多个 PDF（已拆好的单篇）| 逐篇批量生成 |
| 教材 PDF + Script PDF | 同时处理 Reading 和 VideoReading |

下载结果为 ZIP，每篇文章包含 `_Homework.docx` + `_Blackboard.docx`。

---

## 方式 B：命令行批处理

```bash
# 处理整个文件夹
node cli.js ./input ./output

# 处理单个文件
node cli.js ./articles/chapter1.pdf ./output
```

支持 `.pdf` 和 `.txt` 文件。

---

## 整本教材拆分工具

### 拆分 Reading 文章

```bash
node split.js "./PW3E L4 RW SB.pdf" ./input
```

自动用关键字定位边界：
- **开始页**：包含 "PREPARING TO READ"
- **结束页**：包含 "UNDERSTANDING THE READING"（含）

生成文件如：`Ch01_Reading_The_Robot_Revolution.pdf`

### 拆分 Video Script

```bash
node split_script.js "./script.pdf" ./input
```

按 `UNIT X:` 标记拆分，每段保存为 `.txt`。

### 完整流程示例

```bash
# Step 1: 拆分教材
node split.js "./PW4整本.pdf" ./input

# Step 2: 拆分视频脚本（可选）
node split_script.js "./PW4_script.pdf" ./input

# Step 3: 批量生成全套作业
node cli.js ./input ./output
```

---

## 文件结构

```
worksheet-server/
├── server.js           ← 网页服务器（推荐入口）
├── cli.js              ← 命令行批处理入口
├── split.js            ← 整本书按 Reading 拆分
├── split_script.js     ← Video Script 按 Unit 拆分
├── src/
│   ├── prompt.js       ← Claude 出题规范（核心，可调整）
│   ├── generate.js     ← Claude API 调用（含 Prompt Caching）
│   ├── build.js        ← Word 文档生成（7 Part 排版）
│   └── extract.js      ← PDF 文字提取（两级备选）
├── package.json
├── .env.example
└── README.md
```

---

## Prompt Caching 说明

每次调用 Claude 生成作业时，约 1880 token 的系统 Prompt 会被缓存：

- 第 1 篇：写入缓存（MISS）
- 第 2 篇起：✅ 命中缓存，节省约 **90%** 的系统 Prompt 费用

日志示例：
```
[cache] 📝 cache MISS (wrote 2369 tokens to cache)
[cache] ✅ cache HIT  (saved 2369 tokens @ 10% price)
```

---

## 费用估算（Claude API）

| 场景 | 约 tokens | 约费用/篇 |
|------|-----------|-----------|
| 第 1 篇（无缓存）| input ~5000 + output ~10000 | ~$0.18 |
| 第 2 篇起（有缓存）| input ~2700 + output ~10000 | ~$0.16 |
| 批量 10 篇 | — | ~$1.6 |

*基于 claude-sonnet-4-5：$3/$15 per million input/output tokens*

---

## 注意事项

### PDF 类型
- ✅ 文字型 PDF（教材、Word 转 PDF）— 完全支持
- ❌ 纯扫描图片 PDF — 需先用 Adobe Acrobat 或 ilovepdf.com 做 OCR

### 自定义出题规范
编辑 `src/prompt.js` 的 `SYSTEM_PROMPT` 可以调整：
- 各 Part 的题目数量
- 空格选词规则
- 仿写句子数量
- Part 7 拆分粒度

### 修改后重启
```bash
pm2 restart server
```
