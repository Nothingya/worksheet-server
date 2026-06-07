# IELTS Listening 模块集成清单

## 新增文件（放入 worksheet-server/src/）
| 文件 | 作用 |
|------|------|
| `build_listening_ielts.js` | 数据驱动 docx 生成器（JSON → Word） |
| `extract_listening_script.js` | 从任意剑桥 .docx 自动定位 Audioscript + Answer Key |
| `generate_listening_ielts.js` | Claude API：原始脚本 → task JSON（含多层兜底+jsonrepair） |
| `prompt_listening_ielts.js` | system prompt |
| `listening_cache.js` | 编排：解析一次→缓存→按需生成 |

## 新增文件夹（worksheet-server/ 根目录，自动创建）
- `ielts_listening_input/`  ← 把 .docx 丢这里
- `ielts_listening_cache/`  ← 自动写入 <book>.json（即"记忆"）

## 改动现有文件
- `server.js` ← 见 SERVER_PATCH.md（3 个路由 + require）
- 前端 HTML ← 见 UI_PATCH.md（IELTS 阅读下方新增子区块）

## 依赖
```bash
npm i mammoth jsonrepair archiver
```

## 数据流（兼容后续任何 IELTS 文档）
```
.docx → extract（定位脚本+答案，支持 C8–C20+，TEST/PART regex 兜底）
      → generate（每个 Test 调一次 Claude → task JSON）
      → cache（写 <book>.json，只跑一次）
      → build（选 Test 1/2/3/4 或全部 → docx；全部=zip）
```

## 关键设计
1. **读取一次**：`ingestBook()` 检查缓存，已存在则跳过 AI 调用
2. **保存记忆**：解析结果写 `ielts_listening_cache/<book>.json`
3. **按需生成**：`generateDocx(bookKey, testSel)` 从缓存即时构建，无需再调 AI
4. **可选 Test**：UI 下拉「全部 / Test 1 / 2 / 3 / 4」
5. **格式锁定**：TNR 12pt / 1.15 行距 / A4 / 封面无分页 / AK 另起页（与现有 PW 文档规范一致）

## 部署
```bash
git add . && git commit -m "feat: IELTS Listening review module (auto-extract + cache + batch)"
git push -f origin main
pm2 restart server
```
