/**
 * src/generate_ielts.js
 * ──────────────────────
 * Calls Claude API to produce a structured IELTS deep-reading worksheet.
 *
 * Pedagogical rules enforced in prompt:
 *   Task 1 — BOTH columns paraphrased from passage (not just right column)
 *   Task 3 — Answers cite verbatim original text, format: "QUOTE: ... || 解释: ..."
 *   Task 5 — 3-tier: passage theme → paragraph gist → major details
 */

'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Cached system prompt ──────────────────────────────────────────────────────
const SYS = `You are a senior IELTS academic reading specialist. You design worksheets for B1–C1 learners targeting band 7–7.5.

Return ONLY valid JSON — no markdown fences, no preamble, no extra text.

━━ TASK 1: Paraphrasing Matrix ━━
Simulates the IELTS Academic Reading matching-headings / sentence-completion paraphrase skill.

STEP 1 — RIGHT column (1–6) — "originalExpression":
  • First, identify 6 key phrases or short sentences directly from the passage.
  • COPY them VERBATIM — character-for-character, zero changes.
  • Example: passage contains "the disappearance of an intelligent, majestic animal" → write EXACTLY that.

STEP 2 — LEFT column (A–F) — "questionExpression":
  • After fixing the right column, READ the passage meaning and the right column phrase.
  • Generate a paraphrase that captures the SAME MEANING using different words/structure.
  • Write as a Cambridge IELTS exam setter would — formal, concise, natural exam English.
  • Each of the 6 pairs must use a DIFFERENT paraphrase technique:
      A → synonym substitution  (e.g. "disappearance" → "extinction")
      B → word class change     (noun → verb phrase, or vice versa)
      C → active → passive      (or passive → active)
      D → concrete → abstract   (or specific → general)
      E → clause → noun phrase  (compression)
      F → plain English rewrite (formal → accessible)
  • The LEFT column expression must be a genuine paraphrase of the RIGHT column — no new information added.

In JSON: "questionExpression" = LEFT (paraphrase), "originalExpression" = RIGHT (verbatim from passage).

━━ TASK 3: Reference Tracking ━━
"sentenceWithTarget": Include 2–4 CONSECUTIVE SENTENCES from the passage so that BOTH the pronoun AND its antecedent (what it refers to) appear in the same text block. Students must see the referent to understand the tracking. Mark the target pronoun with 【】. Example: "The Romans organised their empire around the solar year. As it expanded northward, 【it】 reorganised activity charts accordingly."
The "answer" field MUST contain the EXACT verbatim phrase from the passage (what the pronoun refers to).
Format: "QUOTE: [exact original text]  ||  解释: [plain explanation]"
Never paraphrase the answer.

━━ TASK 5: Section Outline with Details ━━
Divide the passage into 3–4 logical SECTIONS based on meaning clusters (not 1 para per section).
For each section:
  - Label: "Section I", "Section II", etc. + which paragraphs it covers (e.g., "Para A & B")
  - DO NOT write the section main idea/gist — that is reserved for Task 6
  - List 2–4 KEY DETAILS as fill-in-the-blank sentences (≤3 words per blank, from original text)
  - Between details that have a logical relationship, add a "connector" label describing the relationship:
    examples: "Geographic Contrast", "VS.", "Cause → Effect", "Limitation", "Solution", "Evolution", "Result"
  - Connectors appear BETWEEN detail items (not after every item, only where a logical link exists)
All blanks numbered continuously from 31.
In JSON: use "sections" array, each with "sectionLabel", "paragraphs", "details" array.
Each detail: { "id": 31, "text": "sentence with (31)___ blank", "answer": "word(s)", "connectorAfter": "VS." or null }

━━ JSON SCHEMA ━━
{
  "passageInfo": { "test": "", "passage": "", "title": "", "wordCount": 0 },

  "task1": {
    "instruction_zh": "将左栏题干表达（A–F）与右栏原文表达（1–6）连线匹配，每项只用一次。",
    "pairs": [
      {
        "id": "A",
        "questionExpression": "paraphrased expression — as it would appear in an IELTS exam question (LEFT column, student reads this)",
        "originalExpression": "exact or near-exact phrase from the passage (RIGHT column, shuffled in student version)",
        "strategy": "e.g. noun→verb phrase / synonym swap",
        "teacherNote": "what paraphrase skill is being tested"
      }
    ]
  },

  "task2": {
    "instruction_zh": "划去括号内修饰成分，在横线上写出核心主干（主＋谓＋宾/表）。",
    "sentences": [
      {
        "id": 1,
        "original": "full sentence from passage",
        "coreSkeleton": "Subject + Verb + Object",
        "modifiersToRemove": ["phrase 1", "phrase 2"],
        "teacherNote": "grammatical focus"
      }
    ]
  },

  "task3": {
    "instruction_zh": "找出以下句子中【加粗词】的指代内容，须引用原文完整描述。",
    "items": [
      {
        "id": 1,
        "sentenceWithTarget": "sentence — mark target with 【】 e.g. 【this】",
        "targetWord": "this",
        "answer": "QUOTE: [verbatim from passage]  ||  解释: [plain explanation]",
        "referenceType": "macro/micro/cataphoric",
        "teacherNote": "common student error"
      }
    ]
  },

  "task4": {
    "truthSentences": [
      {
        "id": 1,
        "originalTruth": "verbatim sentence(s) from passage",
        "statements": [
          {
            "label": "a",
            "text": "False statement text",
            "answer": "FALSE",
            "trapType": "absolute word / scope expansion / causal inversion",
            "errorPoint": "which word is wrong and why",
            "teacherNote": "teaching point"
          },
          {
            "label": "b",
            "text": "NG statement text",
            "answer": "NOT GIVEN",
            "trapType": "invented detail / unwarranted inference",
            "errorPoint": "what is fabricated",
            "teacherNote": "teaching point"
          }
        ]
      }
    ]
  },

  "task5": {
    "instruction_zh": "根据文章意思划分层次，在每个层次中填写重要细节（≤3词，来自原文）。段落主旨留至 Task 6。",
    "sections": [
      {
        "sectionLabel": "Section I",
        "paragraphs": "Para A & B",
        "details": [
          {
            "id": 31,
            "text": "Babylonians: Used natural cycles to regulate (31)_______ and harvesting.",
            "answer": "planting",
            "connectorAfter": "Geographic Contrast"
          },
          {
            "id": 32,
            "text": "Lower latitudes: Influenced more by the (32)_______.",
            "answer": "lunar cycle",
            "connectorAfter": null
          }
        ]
      }
    ]
  },

  "task6": {
    "instruction_zh": "将以下标题（A–E）与 Task 5 的各 Section 匹配，写出每个 Section 的主旨。有一个干扰项。",
    "headings": [
      { "label": "A", "text": "section main idea / heading text" }
    ],
    "sections": [
      {
        "sectionLabel": "Section I",
        "correctHeading": "C",
        "matchingLogic": "keyword overlap explanation"
      }
    ],
    "distractorLabel": "D",
    "distractorExplanation": "why D is FALSE (contradicts passage) not just absent"
  }
}`;

/**
 * generateIELTS(passageObj)
 * @param {{ test, passage, title, text, wordCount }} passageObj
 * @returns {object} parsed worksheet JSON
 */
async function generateIELTS(passageObj) {
  const userMsg = `Generate a complete deep-reading worksheet for the passage below.

TEST: ${passageObj.test}
PASSAGE: ${passageObj.passage}
TITLE: ${passageObj.title}
WORD COUNT: ~${passageObj.wordCount}

PASSAGE TEXT:
${passageObj.text}

REQUIREMENTS:
- Task 1: 6 pairs (A–F ↔ 1–6). LEFT = how an IELTS exam QUESTION expresses the idea (paraphrase). RIGHT = ORIGINAL passage phrase. Different strategy per pair. Use "questionExpression" and "originalExpression" fields.
- Task 2: 4 sentences for skeleton extraction. SELECTION CRITERIA (each sentence MUST meet at least TWO of the following):
    • Contains 2 or more subordinate clauses (定语从句/状语从句/名词从句)
    • Contains an absolute construction (独立主格结构, e.g. "the task completed, he...")
    • Contains a participial phrase as adverbial (分词短语做状语, e.g. "Having studied X, she...")
    • Contains heavy pre/post-nominal modification (复杂名词修饰, e.g. "the rate at which X occurs")
    • Contains inverted structure or fronted element
  Avoid simple sentences or sentences with only one embedded clause.
- Task 3: 4 reference items. Answers MUST use "QUOTE: [verbatim] || 解释: [explanation]" format. No paraphrasing.
- Task 4: 2 truth sentences. Each gets:
    • One FALSE statement: takes a REAL claim from the passage and distorts it with an absolute word / scope expansion / causal inversion. The distortion must be clearly contradicted by the passage.
    • One NOT GIVEN statement: MUST be topically related to the passage (same subject/event/concept) but adds or changes ONE specific detail that the passage neither confirms nor denies.
      GOOD NG example: passage says "researchers found polar bears hibernate" → NG says "American researchers found polar bears hibernate" (topic related; 'American' unverifiable)
      BAD NG example: passage says "researchers found polar bears hibernate" → NG says "polar bears are threatened by oil spills" (completely off-topic)
    The NOT GIVEN item must feel plausible — a real reader might think it could be true.
- Task 5: Divide passage into 3–4 meaning-based Sections. For each section:
    • "paragraphs": list the ACTUAL paragraph labels from the passage (A, B, C…). Count carefully — each paragraph letter appears only once across all sections. Do NOT assign the same paragraph to two sections.
    • "details": 2–4 key fact/data fill-in-the-blank sentences (numbered from 31, ≤3 words per blank, verbatim from passage).
    • "connectorAfter": null for all (connectors removed from student version).
    • DO NOT include the section main idea/gist — that is for Task 6.
    • Use "sections" array with "sectionLabel", "paragraphs", "details".
- Task 6: 5 headings (A–E) = main ideas of the 3–4 sections + 1 distractor. Match by sectionLabel. Distractor must CONTRADICT passage.

Return ONLY the JSON object.`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    system: [{ type: 'text', text: SYS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
  });

  const usage = resp.usage || {};
  console.log(`  [IELTS cache] ${usage.cache_read_input_tokens > 0 ? '✅ HIT' : '📝 MISS'}`);

  const raw = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('[generate_ielts] JSON parse error:', e.message);
    console.error('[generate_ielts] Raw (first 400):', clean.slice(0, 400));
    throw new Error('Claude returned invalid JSON for IELTS worksheet');
  }
}

module.exports = { generateIELTS };
