<!-- Approved plan for M61–M69 (2026-10-22 14:47), recovered from the session transcript in M75; never committed before. Gaps closed in M75–M77. -->
# Student knowledge graph via tutor-mcp: adaptive tutor, practice and star levels (academic + custom)

## Context
Today the student is modeled by loose heuristics, and none of them knows *which concepts* the student controls:
- `skill()` = 2 + 3 × mean of the last 10 practice scores (select.ts:73)
- `targetDifficulty` = rounded skill
- stage `mastery` = 0.4 × the tutor's guess + 0.6 × an EMA of scores (reduce.ts:156)
- `weak()` / `focusStage()`
- mistake tags counted per stage
- the custom course `level` (1-5), set once and never updated

The user wants an **already implemented, maintained knowledge-graph engine** that tracks each concept, misconception and edge case for each student.

**The graph is not predetermined. The tutor writes it as it studies the student.** The plan only seeds the obvious concepts. When the tutor or grader checks an answer against the conventions, example answers and materials in the course's source files, it adds what it finds.
- *Example:* a law student who doesn't cite statute section numbers gets a new skill node, "cites the statute and section number", with its own mastery from then on.
- Likewise: units in physics answers, stating the theorem's conditions before using it, a code style, a habit misconception. The tutor, practice and material gathering adapt to it **in academic and custom courses alike**. The goal is always full proficiency, i.e. 100/100 on the real test; for a custom course, from the self-rated level up to 5★.
- **Stars are a visualization:**
  - *student stars* = how much of the whole graph the student controls, out of 5;
  - *question stars* = how hard a question is **for this student** (concepts they control make it easy).
- **Adaptation is gentle:** 1-2 misses don't lower the level.
- **Custom courses get two practice options:** Normal, and **Customized**. Customized: pick a plan unit (all listed; ones with nothing learned are disabled) → a loop of generated exercises with the solving loop, covering only stages learned up to that unit.
- **Find materials online** gathers at the current level and the next one.
- **Migration:** existing logic moves onto the engine wherever the engine is more accurate.

### Research: which engine
| | ★ / activity | Learner model | Runtime |
|---|---|---|---|
| [Graphiti](https://github.com/getzep/graphiti) | ~29K | none (temporal fact graph) | Python + Neo4j/FalkorDB + OpenAI key |
| [Mem0](https://github.com/mem0ai/mem0) | ~62K | none | hosted MCP |
| [Cognee](https://github.com/topoteretes/cognee) | ~12K | none | Docker/Python |
| Official MCP memory server | official | none (entities/relations) | Node, JSONL |
| **[tutor-mcp](https://github.com/ArnaudGuiovanna/tutor-mcp)** | 53★, 467 commits, release roughly monthly (v0.6.1, 19 Sep), MIT, "Alpha" | **BKT** (`algorithms/bkt.go`: observe → transition with learn/forget), **FSRS** reviews, KST prerequisite graph, IRT/PFA, misconceptions (active/resolved), estimated/retained/demonstrated mastery, transfer and Feynman (explanation) probes, `get_next_activity` with a difficulty target, thresholds 0.85 / 0.70 | **One Go binary** (macOS/Linux/Windows, amd64/arm64), `--local` = local SQLite |
| [knowledge-graph-mcp](https://github.com/zcsabbagh/knowledge-graph-mcp) | 1★, 8 commits | SM-2 + recall/application/explanation (0.3/0.4/0.3) | Python |

Star counts are approximate (GitHub pages and third-party write-ups, 2026). The generic graphs are far more popular, but they store facts, not mastery, so we would still have to write the learner model ourselves. **tutor-mcp is the only maintained, already-implemented learner engine.** The caller supplies the concept graph (`init_domain`, `add_concepts`), so Shalav's plan becomes its graph. Its "Alpha" status is the main risk; it's handled by pinning a version, keeping Shalav's event log as the source of truth, and the fallback below.

## Spike results (tutor-mcp v0.6.1, run locally on macOS arm64)
- **Binary:** the release assets for all 6 platforms carry SHA256SUMS. darwin_arm64 = `5efbfa59…608b`, verified. One ~32 MB Go binary.
- **Running:** `--local --data-dir PATH` works, which gives **one graph per course**. Offline stdio MCP. It starts background jobs (OLM, consolidation, motivation, recap, cleanup) only while connected.
- **Graph:**
  - `init_domain(name, concepts[], prerequisites{})` returns a `domain_id`;
  - `add_concepts(domain_id, expected_version, concepts, prerequisites, details, provenance)` works at any time, so the **dynamic graph is supported**;
  - a concept's **name is its display label** (`details.label must equal the graph concept name`), so names must be unique within a course.
- **Evidence:** `record_interaction(concept, activity_type ∈ {DIAGNOSTIC_ASSESSMENT, RECALL_EXERCISE, PRACTICE, FEYNMAN_PROMPT, DEBUG_MISCONCEPTION, MASTERY_CHALLENGE, TRANSFER_PROBE…}, success: bool, response_time_seconds, confidence 0..1, error_type?, misconception_type?, misconception_detail?, hints_requested?)`.
  - Without the frozen-rubric attempt protocol, an answer is an "unverified observation". It updates BKT and FSRS but never the retained/demonstrated stages. We use the estimate, and FSRS `retention_estimate` / `next_review_in_hours`.
- **Reads:**
  - `get_olm_snapshot`: per concept `{mastery_estimate, retention_estimate, stage, evidence_quality}`, plus `focus_concept`;
  - `get_next_activity`: `{activity: {type, concept, difficulty_target 0..1}, active_misconceptions[]}`;
  - `get_misconceptions`, `check_mastery` (threshold 0.85).
- **Behaviour:** BKT keeps no history. These results hold after 8 or after 30 correct answers alike:

  | Answers | Estimate |
  |---|---|
  | correct streak | caps at 0.94 |
  | then 2 misses | 0.51 → 0.27 |
  | then 2 correct | 0.74 → 0.91 |
  | a steady 80% student | swings 0.60 ↔ 0.94 |

  It's good for "what to review right now", but **not usable as a level or star rating.** Hence the gentle layer.
- **No API to seed a starting mastery.** The custom course's self-rated level becomes a Shalav-side prior.

## Design

### 0. Gentle layer: *control* per concept, computed by Shalav (user-approved)
Shalav computes **control** per graph node from the node-tagged evidence in its own event log, as a pure function (`src/core/domain/knowledge/control.ts`). It drives the **student level, stars, question stars and target difficulty**. The engine's fast BKT estimate drives only **what to work on next** (focus, reviews, misconceptions).
- `control = (k·prior + Σ wᵢ·sᵢ) / (k + Σ wᵢ)`, where:
  - `sᵢ` = the answer's score on that node (0..1, partial credit). Hints cost 0.1 each, and a revealed solution caps it at 0.6, as in reduce.ts today;
  - `wᵢ = 0.5^(age_in_answers/12)`: recent answers weigh more, but each counts for only a fraction of the whole history;
  - `k = 3` pseudo-answers at the prior: custom level 1→0.05, 2→0.25, 3→0.45, 4→0.65, 5→0.85; academic 0.1.
- **Retention** from the engine's FSRS: `effective = control × retention_estimate`. Forgetting lowers it over time, and a review restores it. If the engine is unavailable, `effective = control`, so the stars still work.
- **Hysteresis on the student level:**
  - the shown stars rise as soon as the value crosses the next half star;
  - they drop only when it falls 0.35★ below the shown value.
  
  Stored per course in `<course>/.shalav/knowledge/level.json`.
- **Required behaviour, written as tests:**
  - 30 correct + 2 misses → control drops ≤ 0.08;
  - a steady 80% student stays within ±0.05 of 0.8;
  - 8 misses out of the last 10 → below 0.5 within those 10;
  - shown stars never drop after just 1-2 misses.

### 1. Engine integration: `src/server/knowledge/` (new)
- **Binary:**
  - pinned tutor-mcp release (v0.6.1), downloaded on first use for the current OS/arch from GitHub Releases;
  - sha256 checked against hashes recorded in the code;
  - stored under the Shalav data root (`bin/tutor-mcp-<ver>`);
  - the progress is shown in the card the way the PDF browser install is today.
- **One graph per course, in the course folder:**
  - the engine's data lives at `<course>/.shalav/knowledge/`, next to that course's event log;
  - deleting or moving a course takes its graph along, and a reset affects only that course and is rebuilt from its log;
  - no skill or misconception crosses between courses.
- **Client:** Shalav talks to the engine as an **MCP client** over stdio (`@modelcontextprotocol/client`, already in devDeps → moved to deps). It starts **one engine process per active course** with `--local` and that course's data directory:
  - started on first use;
  - closed after 10 idle minutes;
  - at most 2 running at once;
  - all of them closed when Shalav exits.
  
  The per-process data-dir flag or env var is confirmed in the M61 spike. knowledge-graph-mcp has a confirmed `KNOWLEDGE_GRAPH_DB_PATH`, which is part of the fallback criteria.
- **Shalav's event log stays the source of truth.** The engine DB is derived:
  - on first use, and after any engine reset or upgrade, Shalav **replays** past events into it (stage-level evidence for old events);
  - if the engine can't run (download failed, unsupported platform), Shalav falls back to today's heuristics. The cards then show no stars, and nothing breaks.
- **A thin adapter, `knowledge.ts`,** exposes typed calls. Only these engine tools are used:
  - `init_domain`, `add_concepts`, `publish_curriculum_revision`
  - `set_goal_relevance`, `mark_domain_high_stakes`
  - `record_interaction`, `get_learner_context`, `get_olm_snapshot`
  - `get_next_activity`, `check_mastery`, `get_misconceptions`
  
  The exact input/output schemas are checked in the spike.

### 2. Course plan → engine domain
- **One domain per course**, in that course's own engine data directory.
- **Concepts** come from the plan's stages: one per `newConcepts`, `theorems`, `techniques` and `edgeCases` item.
  - Shalav's node id = `${stageId}/${kind}/${fnv1a(normalized label)}`. A hash works for any language: a slug would collapse Hebrew labels to an empty id.
  - The **engine concept name = the display label**, which the engine requires. Duplicate labels get the stage title appended ("הגדרה · סדרות"), capped at 80 chars. The id ↔ name map is kept in `<course>/.shalav/knowledge/map.json`, so the name and the dynamic nodes survive across sessions.
  - Labels are stable: I checked that Translate writes `translations.<lang>.json` and never rewrites plan.json, and that refine only adds labels.
  - Prerequisites = the nodes of the stage's `prerequisites` stages. Inside a stage, theorem/technique/edge concepts require its concepts.
- **Goal relevance** from `examRelevance` (core/common/occasional). Academic courses are marked high-stakes (an exam is coming).
- **Plan updates** (Build/Update plan, delete from plan) → `add_concepts` + `publish_curriculum_revision`. `plan_replaced` id maps remap the stage prefix of the concept ids, in `mapEvents` (reduce.ts:13).

### 2b. The tutor and grader grow the graph (dynamic nodes)
- **Node kinds:**
  - seeded: `concept | theorem | technique | edge`;
  - tutor-written:
    - `skill`: an answer-writing ability, e.g. "cites statute + section", "states units", "justifies every step";
    - `convention`: a course-specific way answers must look, learned from the example solutions;
    - `misconception`: a recurring wrong idea or habit.
  
  Every node carries `origin: plan | tutor | grader`, a short `why`, and evidence refs (attempt/check ids).
- **Where new nodes come from:**
  1. **The grader** (`submit_grade`, `record_check_result`) already sees the course's conventions and example answers: `examples(ctx, ex)` and `digest(...)` from the course files, used by the solving loop's grading.
     - It now also returns `newNodes: {kind, label, why, stageNumbers[], requires?: numbers[]}[]` for any requirement it graded down that the graph doesn't cover yet;
     - and `sameAs`, pointing to an existing node number when it's the same thing (so nothing is duplicated).
  2. **The tutor** during a lesson gets a new tool, **`update_knowledge_graph`**. It can:
     - add or rename a node;
     - link nodes (`requires` / `part_of` / `misconception_of`);
     - record an observation on a node with a short reason.
     
     The tool's prompt rule: when the student's answers keep missing something the course's example answers always include, add a node for it and track it.
  3. **Indexing** of course files: example solutions are scanned for conventions (e.g. the law book's citation style). A course gets a few `convention` nodes before the student even answers.
- **Server validation (trust boundary):**
  - labels are capped and deduped: normalized label + the model's `sameAs`;
  - a node needs a `why` and at least one evidence ref;
  - per-course cap (e.g. 300 nodes);
  - links only between existing nodes.
  
  Accepted nodes go to the engine (`add_concepts` + `publish_curriculum_revision`, or the engine's equivalent) and are stored as a `node_added` / `node_linked` event in Shalav's log. **Replay** rebuilds the dynamic graph too.
- **The digest the tutor and grader receive** lists the student's tutor-written nodes with their mastery, e.g. "cites statute + section: 30% ★★". The next answers are checked against them, and the tutor keeps working on them until they're mastered.
- **Stars and exam-ready include the dynamic nodes.** Learning that the student is missing a skill lowers the stars honestly until it's practiced.

### 3. Every graded answer becomes engine evidence (node-tagged)
- Events `check_answered` and `attempt_graded` get an optional `nodes?: {id, score 0..1, kind: recall|practice|explanation}[]` (`dataSchemas.ts`). Older events have none: they replay as stage-level evidence.
- **Prompts list the candidate concepts as short local numbers.** The grader returns `nodeResults` by number (`submit_grade` in `src/core/claude/practiceTools.ts`, `prompts/practice.ts`). The server maps numbers to ids and **drops any that don't match**. That's the trust boundary, and it saves tokens.
  - The same applies to the tutor's `present_mcq`, `ask_open_question` and `record_check_result` (`tutorTools.ts`, `learnTools.ts`), and to generation and indexing (`generate.ts`, `prompts/index.ts`).
  - `edgeCasesMissed` maps to edge concepts. Mistake tags → `record_interaction` with a misconception.
- After an event is saved, Shalav sends `record_interaction` for each node:
  - `success = score ≥ 0.7`;
  - `confidence = score`;
  - `hints_requested`;
  - `error_type`: LOGIC_ERROR when the grader listed mistakes, else KNOWLEDGE_GAP;
  - `misconception_type` = the mistake tag;
  - activity: MCQ = RECALL_EXERCISE; exercise = PRACTICE; open / written justification = FEYNMAN_PROMPT (explanation).
  
  The same per-node scores feed *control* (section 0) directly from the event.
  - **This makes "fully elaborated answers" count.**
  - **It is gentle by construction:** BKT's slip term means 1-2 misses barely move a well-known concept.

### 4. Values the app reads from the engine
- **From the engine:**
  - `retention_estimate` per concept (from `get_olm_snapshot`);
  - the next focus concept and activity type (`get_next_activity`);
  - due reviews;
  - active misconceptions.
- **Student stars** = 5 × the relevance-weighted mean of *effective control* over all nodes (section 0, with hysteresis). Shown as half stars. A custom course starts at its self-rated level through the prior.
- **Question stars (for this student)** = `clamp(1..5, round(d + 2·(0.5 − m̄)))`. `d` is the question's intrinsic difficulty (1-5); `m̄` is the mean effective control of the nodes it tests. **Frozen when the question is served** (stored in the item/run state), so they don't change mid-answer.
- **Target difficulty:**
  - choose `d` so the question stars come to about 3;
  - after 3 good answers in a row on the focus nodes, about 4 (a stretch);
  - the engine's `difficulty_target` breaks ties.
- **Exam-ready** = the share of core/common nodes with effective control ≥ 0.9, shown as a percentage. The tutor's target is 100%.

### 5. Migration onto the engine (no regression)
- `reduceProgress`: stage `mastery` = the mean effective control of its nodes. While a stage has little node evidence, use max(that, old formula), so current students never drop.
  - **Completion rules (`criteria.ts`) and statuses are unchanged.** A completed stage stays completed.
  - Exam-ready is a goal the tutor pursues, **not a new gate**.
- `select.ts`:
  - `skill()` / `targetDifficulty()` → the engine's difficulty target;
  - `itemKind` takes the student-stars level;
  - `scoreExercise` / `focusStage` / `weak()` rank by the engine's next-activity concepts, due reviews and active misconceptions.
- `assessment_updated` (the tutor's own guess): only its `gaps` go to the engine. Its `mastery` isn't sent, because the lesson's checks are already counted.
- Mistake summaries in the UI read the engine's misconceptions (`get_misconceptions`).
- **Acceptance:** replay a recorded event history through old and new code. No stage status regresses, and the mastery change stays bounded. Also replay a read-only copy of the real data root.

### 6. Tutor (Learn): academic and custom
`prompts/tutor.ts` gets a short digest from the engine:
- the weakest concepts and active misconceptions;
- due reviews;
- the next-activity suggestion;
- the target question stars;
- "now at N★" for custom courses;
- the rule: "Bring every concept to full proficiency (100/100 exam answers). Ask at the target level; step up after success; one or two misses are not a reason to step down."

`assign_exercise` difficulty defaults to the engine's target.

### 7. Practice
- **Normal** (both course types): same UI; selection and difficulty come from the engine.
- **Customized** (custom courses only):
  - scope `{ kind: "upto", unitId }` (`select.ts`, `scopeSchema` in practiceTools.ts:28), following the test-practice pattern (M59);
  - eligible = stages learned in units up to and including the chosen one;
  - E items only, generated at the engine's target for its next-activity concepts within that scope, with the solving loop (`bindRun` already passes `loop: true`);
  - engine `produce()` branch + `title()`.
- **Card** (`Practice.tsx`):
  - when `custom`, the grid shows only Normal and Customized;
  - Customized lists **all** plan units, disabled where nothing is learned;
  - `PracticeData` gains `custom` and `allUnits: {id, title, ready}[]`.

### 8. Stars in the cards
- A shared `Stars` component (extracted from `CustomCourse.tsx` into `src/cards/ui.tsx`).
- On the Exercise badge (replacing "Difficulty n/5"), and on MCQ and Open questions in lessons and practice. Aria: "difficulty N of 5 for you".
- On the course card: student stars and, for academic courses, exam-ready %.

### 9. Find materials online
`web.ts`: about half at the current level (rounded student stars) and half at the next level. Topics are weighted to the engine's weak/next concepts. This replaces the static `course.level`.

## Milestones (each ships green, each its own commit)
- **M60.9** (user-approved): commit the current working tree on `dev`. Delete the e2e PNGs this session wrote under `e2e/tests_output/`, then any folders left empty.
- **M61 Engine adapter + gentle layer.** The spike is done (results above). Build:
  - `install.ts`: download per OS/arch, check against SHA256SUMS hashes recorded in the code, show install progress;
  - `engine.ts`: per-course process pool, idle shutdown, MCP client;
  - `knowledge.ts`: typed calls and the map.json naming;
  - `control.ts` + hysteresis, with the required-behaviour tests from section 0;
  - real-binary integration tests (skipped when it is missing) and a fake engine.
  
  Original spike notes: download, verify and start tutor-mcp v0.6.1 on macOS arm64. Confirm the schemas of the tools above, the data-dir flag, initial-mastery seeding and offline `--local`. **Also confirm that concepts can be added at any time** (`add_concepts` + revision) with free-form kinds (skill/convention) and links. If the curriculum model is too rigid for a graph the tutor writes, switch the engine to [knowledge-graph-mcp](https://github.com/zcsabbagh/knowledge-graph-mcp), whose `add_node`/`add_edge`/`update_node` are built for an LLM-written graph. The adapter interface stays the same. Adapter + tests against the real binary (skipped when it is missing), plus a fake engine for unit tests. **If the spike shows a blocker** (no data-dir control, no way to seed, the binary unusable offline), stop and report before M62.
- **M62** Plan → domain seed + node-tagged evidence (event `nodes`, grader/tutor/generator/indexer fields, `record_interaction`) + history replay.
- **M62b** Dynamic graph:
  - grader `newNodes`/`sameAs`;
  - the tutor's `update_knowledge_graph` tool;
  - conventions from example solutions at indexing;
  - `node_added` / `node_linked` events;
  - server validation and dedupe;
  - the digest of tutor-written nodes;
  - a test where a law-style answer without section numbers creates the "cites statute + section" skill once, never twice, and later answers raise its mastery.
- **M63** Migration (progress mastery, selection, target difficulty, misconceptions) + the replay acceptance check.
- **M64** Customized practice (custom: two options) + the tutor digest.
- **M65** Stars UI, web gathering at current/next level, i18n, e2e.

## Critical files
- New:
  - `src/server/knowledge/{engine,install,knowledge}.ts` (+ tests)
  - `src/core/domain/knowledge/graph.ts`: plan → concepts/ids, pure (+ tests)
- Domain:
  - `src/core/domain/dataSchemas.ts`
  - `src/core/domain/progress/{reduce,render}.ts`
  - `src/core/domain/practice/{select,engine,generate,grade}.ts`
- Claude tools and prompts:
  - `src/core/claude/{practiceTools,tutorTools}.ts`
  - `src/core/claude/prompts/{practice,tutor,index}.ts`
  - `src/core/domain/ingest/web.ts`
- Server: `src/server/{practiceTools,learnTools,courseTools,server}.ts`
- Cards and i18n:
  - `src/cards/views/{Practice,Exercise,Question,Course}.tsx`
  - `src/cards/ui.tsx`, `src/cards/types.ts`
  - i18n en/he
- Reuse:
  - `mapEvents` / `normalizeTag` (reduce.ts)
  - the test-practice scope pattern (`test.ts`, `testData`)
  - the `ExerciseRun` loop
  - the PDF browser install flow (`htmlToPdf` install progress) for the binary download
  - `CustomCourse` `Stars`

## Verification
- **Unit (fake engine):**
  - plan → concepts (Hebrew labels give distinct ids, stable across translate/refine);
  - number→id mapping drops unknown numbers;
  - evidence → `record_interaction` calls;
  - question-stars formula, frozen at serve time;
  - the `upto` scope;
  - fallback with no engine;
  - progress no-regression on a replay.
- **Integration (real binary, M61+):** 2 misses after 8 good answers on a concept → mastery stays high; sustained misses → it drops; FSRS makes a review due after time passes; `get_next_activity` returns a frontier concept.
- **e2e (relevant specs only):** practice (custom: two options, disabled units, start → exercise with stars), exercise and lesson stars, course card stars. Then the screenshot review per memory.
- **Manual in Claude Desktop:**
  - a custom course at 2★: learn two stages, then Customized practice to unit 2;
  - good answers raise the stars gradually, and one miss doesn't;
  - Find materials online asks for 2★ and 3★;
  - an academic course: the tutor's digest names weak concepts and due reviews.

Sources: [tutor-mcp](https://github.com/ArnaudGuiovanna/tutor-mcp), [tutor-mcp releases](https://github.com/ArnaudGuiovanna/tutor-mcp/releases), [knowledge-graph-mcp](https://github.com/zcsabbagh/knowledge-graph-mcp), [Graphiti MCP](https://docs.falkordb.com/agentic-memory/graphiti-mcp-server.html), [memory server comparison](https://coworker.ai/blog/best-mcp-memory-servers), [Graphiti vs Mem0](https://renezander.com/guides/graphiti-vs-mem0/), [star counts](https://andrew.ooo/answers/best-ai-agent-memory-systems-2026-hindsight-mem0-zep-letta-cognee/).
