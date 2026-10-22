# Course conventions: learned from example solutions and the teacher's notes

## Context
Today a course convention ("cite the statute and section", "label the axes") enters the student's knowledge graph only after a grader takes points off for it. Graders see example solutions only in the solving loop. Generic `EXAM_CONVENTIONS` (`prompts/shared.ts:13`) is the same for every course.

The user wants:
- **Conventions from example solutions:** learned when files are scanned, aware that a test mixes question types, multi-part questions and answer forms (graph, drawing, multi-part solution, written/verbal answer, code…).
- **A teacher-notes upload:** the student's real university teacher's notes and comments. They are analyzed and weigh most, and can add new conventions or update existing ones.
- **Removal:** a convention is removed only when **all files containing it are deleted AND a new repeating convention contradicts it**.
- **Conflicts:** when a convention rightly stays and a new one contradicts it, the analysis decides in which cases each one applies. **The teacher's convention wins.**

The user decided:
- **Teacher files contain** graded homework/exams with comments, rubrics/grading guides, and lecture/TA remarks.
- **Graded work** is also the strongest evidence on the student's graph.
- **A teacher convention** is removed only by a newer contradicting **teacher** convention, after all its files are gone.
- **"Repeating"** = seen in ≥ 3 example solutions from ≥ 2 files.
- **The upload** is a third zone in the course files.
- **The course card list:** read-only, collapsed by default. Teacher conventions sit on top with a colored tag. It shows 10 rows and scrolls like the files list.

Facts found:
- Roles come only from the folder (`ingest/import.ts:36`, two roles).
- Scanning runs only in Build/Update plan (`courseTools.ts:47-90`).
- Deleting a file drops its index on the next `scanCourse` (`import.ts:149-163`), but derived data is not cleaned up.
- Parts of a question are linked only by the label text (`test.ts:17` `burnKey`).
- No answer-form field exists, and no web-file marker.
- Graph nodes are add-only: no retire event.
- A node with no evidence lowers stars at once (`control.ts` `rawStars`, the `examReady` line in `knowledge.ts`).

## Design

### 1. What a convention is: a per-course registry, mirrored in the graph
`<course>/.shalav/conventions.json`: synced with the course and derived from the scanned files plus the reconcile history.
```
Convention {
  id                       // graph node id: nodeId(null | stage, "convention", first rule text)
  rule                     // ≤160 chars, student's language; what the answer must do. Wording may be refined, the id stays
  source: "teacher" | "solutions"
  useCase: {               // WHEN the rule applies: the convention is defined by its use case, not by a question category
    trigger: string        // ≤240, the situation in words, e.g.
                           //  "the answer refers to a case through a law, or states that something is based on a law"
                           //  "solving needs a backtracking trace of the code, or the question explicitly asks for a trace table"
    on: "question" | "answer" | "both"   // what to check the trigger against: what the question demands, what the answer does, or either
    notWhen: string[]      // explicit non-cases learned from the sources, e.g. "a definition question that names no law"
    examples: { quote: string, applies: boolean }[]   // ≤4 short cases from the sources: one where it applied, one where it clearly did not
    verify: string         // ≤200, the observable check that it was met, e.g. "every statute named is followed by its section number"
    distinguishes?: { from: id, difference: string }[]   // a similar use case with another convention, and the context that tells them apart
    level: "whole" | "part" | "any"   // a whole multi-part question (e.g. "answer the parts in order, label each") vs each part
    stageIds: string[]     // [] = whole course
    hints: { answerForms: AForm[], questionTypes: QType[] }   // a coarse PREFILTER only, to keep prompts short; never decides applicability
  }
  sources: { sha, fileName, kind: "solution" | "graded" | "rubric" | "remark", refs: string[], quote: string }[]
  status: "active" | "retired"
  conflicts: { with: id, resolution: string }[]   // split by use case: which trigger selects which rule; teacher wins where both still trigger
  addedAt, updatedAt, retiredAt?, retiredBy?
}
```
- **Graph mirror:** each active convention is a graph node.
  - It is written with `node_added`, origin `"index"` (solutions) or a new origin `"teacher"`.
  - A new event, `node_retired {nodeId, why}`, makes `graphOf` drop the node. Its answers stay in the log.
  - So graders, tutor tags, control and stars work through the M62–M65 machinery.
- **Stars stay fair:** a convention node with origin index/teacher that has no evidence (`k.seen === 0`) is skipped by:
  - `rawStars`;
  - the `examReady` line;
  - `meanControl`;
  - the digest's weakest list.
  
  Scanning never lowers stars. The first answer where the convention applies counts.

### 2. Question structure and answer forms (index time)
- Add to `IndexedExerciseSchema` and `submitExercises`, with defaults so old indexes stay valid:
  - `answerForms: AForm[]`;
  - `question: string` ("2") and `part: string | null` ("a"), set by the indexer. Today these are parsed from the label (`burnKey`), so `burnKey` can reuse them.
- The prompt says: a multi-part question is still split per part, with the same `question` on each part. Name every answer form the part asks for (sketch the graph, compute, justify in words…).
- Exam origin: `isExam(fileName)` (`test.ts:14`) is passed along as source weight. No schema change.
- **Per-batch solution observations: raw occurrences, not generalized rules.** `submitExercises` also returns `occurrences: {label, useCase, practice}[]`, one row per answer-writing practice seen in a printed solution, recorded with **that solution's own situation**:
  - `useCase`: what this question demanded and what this answer was doing at that point, concretely. E.g. "the answer bases the duty of care on a statute"; "the question gives numeric data and asks for a value".
  - `practice`: what the solution did there. E.g. "cites the statute and section"; "rounds to 2 decimals with units".
  - Each answer part also lists the situations it contains where a known practice was **absent** (`absences`).
  
  Only batches with printed solutions return any. Generalizing happens later, across all files, in reconcile (§4), where all the occurrences can be compared.
  - They are stored on the file's index as `FileIndex.patterns`.
  - So a deleted or edited file takes its evidence with it, via `dropIndex`.
- **Web files never count:** `gatherWeb` records the shas it writes in `.shalav/web-files.json`, and `register()` sets `FileIndex.origin = "web"`. Their patterns are ignored. Those solutions were written by Shalav's own prompt.

### 3. Teacher notes: a third file role
- **Folder:** `הערות המרצה` / "Teacher's notes" (`constants.ts`, `paths.ts`, and `conflicts.ts` SKIP).
- **Role:** `"teacher"`, widened wherever the role enum appears: `dataSchemas.ts:206`, `fileTools.ts:26`, `web.ts:18`, `ingest/types.ts:12`, `import.ts:9`.
- **Card:** a third `zone("teacher", …)` in `Files.tsx`, with the same chunked upload and scan states; `FilesData.teacher`. Moodle import never puts files here.
- **The student's own solutions are never truth.** Graded homework and exams in this zone contain the **student's** answers. Only what the **teacher** wrote counts: the marks, comments, deductions, points and corrections. The same goes for rubrics and remarks (what the teacher wrote or said).
  - The student's handwriting on a graded page is read only to understand what a comment refers to.
  - It never becomes a reference solution, an example solution, an exam-pool question, a solution pattern, or lesson material.
  - The teacher-notes prompt says this explicitly. Every extracted item must quote the teacher's mark or comment, not the student's text.
  - The pipeline enforces it in code:
    - `indexTeacher` never runs exercise extraction;
    - teacher files are excluded from `nearestExercises` / `examples()` / `examPool` / `patterns`;
    - only teacher-written text goes to `materialPages`, so lessons and graders never see the student's solution as course material.
  - A correction the teacher wrote (e.g. "the correct value is 5") is a teacher comment. It may be used as the right answer **for that one point only**, quoted as the teacher's.
- **Indexing:** a new `indexTeacher` runs in the queue on role teacher. Page batches go to a new `submit_teacher_notes`:
  ```
  { pages: [{ page, kind: graded_work | rubric | remark, text, summary }],
    items: [{ type: requirement | deduction | praise, rule, quote, points?, exercise?: label/text,
              questionTypes, answerForms, level, stageIds, when,
              nodeResults?: {n, score}[], newNodes? }] }
  ```
  - `text` is **only the teacher's writing** on the page: comments, marks, rubric lines.
  - Requirements and rubric lines are convention candidates.
  - Deductions and praise on the student's own work are both convention candidates and evidence. The prompt gets the numbered graph candidates (`candidates` / `listText`, `tag.ts`).
  - That teacher-only text goes into `materialPages`, so `consult_materials` and the lesson brief can find the teacher's words, never the student's answers.
- **Graded work is the strongest evidence:**
  - Each scored node gets a `node_observed` with the new context `"teacher"`. In `control.ts` it weighs 2, against 1 for an AI grade.
  - Deductions also write `mistake_observed`, so they join the "watch out" list.
  - **Concepts the student fails repeatedly:** the same deduction (by meaning) across two or more graded works, or across a graded work and later answers, becomes a `misconception` node. It is linked (`misconception_of`) to the concept it concerns. Its control falls with each repeat, so the tutor, practice focus and the "watch out" list keep returning to it until later answers fix it.
  - `refId` = file sha. Evidence from a file sha already in the log is never written again.
  - An edited file is a new sha; its old evidence events stay. The note in `DECISIONS.md` says why: the log is append-only.

### 4. Reconcile: a build step after scanning
In `build(n)` (`courseTools.ts`), after `indexPending` and before `refinePlan`:
1. **Inputs:**
   - the registry;
   - all candidates from the current indexes (solution patterns + teacher items, each with sha, kind and refs);
   - the set of current shas.
2. **Prune:** sources whose sha is gone are removed from every convention.
3. **AI job `submit_conventions`:** given the registry and the candidates, it:
   - **first clusters the occurrences by use case.** Occurrences belong together only if their situations are **fundamentally the same**: same demand, same kind of reasoning. Similar wording isn't enough. Each cluster gets a use-case description, and every occurrence id is listed in exactly one cluster;
   - **then, inside each use-case cluster, groups by practice.** A convention is a **(use case, practice) pair**. "Cites the section" seen 6 times across 3 fundamentally different use cases is three pairs with 2 occurrences each, **not** one convention seen 6 times;
   - **a rule may span several use cases** only if it qualifies in each of them on its own. Its trigger is then the union of those use cases. A use case where it doesn't qualify stays outside its trigger;
   - **similar use cases with different practices:** when two clusters look alike but follow different practices (exact form vs 2 decimals), the job must find the **context that tells them apart**. E.g. "the data is symbolic, or the question says 'exactly'" vs "the data is measured numbers". It writes each convention's trigger around that difference and labels every occurrence of both clusters with which trigger it satisfies.
     - If it finds no difference, the variation is **inconsistent**: neither becomes a convention (logged with its examples), unless a teacher source settles it;
   - **refines a use case by its absences.** When a practice is missing in solutions that seem to fall under its use case, the job compares the followed occurrences with the absent ones and finds the context that differs. Example: the statute is cited where the answer **relies** on it, but not where it is only **mentioned** as background. It then narrows the trigger to fit the followed cases. The absent cases become `notWhen` with their examples.
     - The narrowed use case is counted again from scratch and must still qualify (≥ 3 occurrences, ≥ 2 files).
     - A difference may also turn out to be a separate use case with its own practice. Then it's the "similar use cases, different practices" case above.
     - Only when no difference can be found at all are the absences treated as slips: ≤ 1 in 4 allowed, otherwise inconsistent;
   - matches the results to existing conventions by meaning (`sameAs` an id);
   - writes each convention's `useCase` (trigger, `on`, `notWhen`, examples) as the narrowest description that covers its own cluster's occurrences and excludes the others;
   - writes or refines the rule;
   - lists contradictions. Two rules contradict only if **both triggers can hold for the same answer** and the rules demand incompatible things;
   - for each contradiction, splits the use cases ("when the question asks for an exact value → exact form, teacher's rule; when it asks for an estimate → 2 decimals");
   - proposes retirements.
4. **Server rules (deterministic; the model only proposes):**
   - **New solutions convention, counted per (use case, practice) pair.** The server counts from the occurrence ids the job assigned to that cluster, never from the job's own numbers:
     - followed in ≥ 3 occurrences **of that one use case**, from ≥ 2 distinct non-web shas;
     - after the job's refinement by absences, every remaining absence inside the use case is one the job couldn't explain. They're allowed only up to 1 in 4. An explained absence was moved out of the trigger, into `notWhen`, and the server checks it is listed there;
     - occurrences in other use cases never count for it or against it;
     - a rule spanning several use cases must pass this in each one it claims.
   - **Clear, with no room to pick the wrong one.** Every active convention has a concrete trigger, `notWhen` and `verify`. Any two active conventions whose practices conflict must be **separable**:
     - The job labels every occurrence of both with the trigger(s) it satisfies. The server rejects the pair if one occurrence satisfies both triggers and the practices differ.
     - The only exception is an explicit teacher-wins order: one is a teacher convention, and the overlap is written into the resolution as "both trigger → the teacher's".
     - A rejected pair goes back to the job once for a sharper difference. If it fails again, the solutions-only side is dropped (logged as inconsistent).
   - Before writing, the job also re-checks each convention's own examples against its trigger: each `applies: true` example must satisfy it, and each `applies: false` must not.
     
     A **teacher** convention needs 1 teacher source, and its use case comes from the comment's context: the part it was written on, and what that part asked.
   - **Retire X only if:**
     - every source sha of X is gone; **and**
     - an active convention Y contradicting X exists and is repeating (solutions threshold, or teacher); **and**
     - if X is a teacher convention, Y is a teacher convention added after X.
     
     Otherwise X stays active.
   - **Both stay:** a resolution splitting the use cases is required. Where both triggers still hold for one answer, the teacher one wins (stored order; the prompts say so). A solutions convention can never override a teacher one.
   - **An active convention with zero sources** (files gone, nothing contradicts it) stays active. That's the user's rule.
5. **Writes:**
   - the registry file;
   - `node_added` for new conventions;
   - `node_retired` for retired ones;
   - a short build-log line ("3 new conventions, 1 refined, 1 conflict resolved").
6. **Without any example solutions or teacher files**, the step is skipped (no AI job).

### 5. Applying conventions everywhere
**Applicability is decided per case, by the use case, at the moment of use. Never by category.**
- A pure `candidatesFor(registry, {stageIds, level})` only narrows the list: stage, part/whole, and the coarse `hints` used loosely to drop the obviously irrelevant when the list is long. Teacher ones come first. Each is rendered with its trigger, `notWhen`, one applies / doesn't-apply example, and any resolution.
- The model then decides, for this question and this answer, whether each trigger holds:
  - **On the question:** does solving it require X, or does the question ask for X? E.g. a backtracking trace table, only when the code needs tracing to solve it or the question asks for one.
  - **On the answer:** does the answer do Y? E.g. it relies on a law, so the section must be cited.
  - A convention whose trigger doesn't hold is ignored: no deduction, no praise, no evidence.
- **Graders report it:** `submit_grade` / `submit_check_grade` get `conventions: {n, triggered: boolean, why: string, met?: boolean}[]`.
  - Only triggered ones may affect the score, and only they write evidence on the convention's node (met → 1, unmet → 0, partial allowed).
  - Not triggered → nothing is recorded, so control is never lowered by questions where the rule never applied.
  - `why` names the trigger in this answer ("cites the duty of care under the Torts Ordinance → section required").
- Part-level conventions are judged part by part; whole-level ones only when the answer covers a multi-part question.

Injected as "Course conventions (each applies only when its trigger holds; teacher first; where they differ from the general standards, these win)" into:
- **Grading** (`gradingPrompt`, every exercise, not only the solving loop) and `checkGradingPrompt`, as above.
- **Every solution the AI writes, anywhere in the app,** follows each convention whose use case occurs in that solution, and none whose use case doesn't. Before submitting, the writer checks itself against each triggered convention's `verify` line. Every path that writes a solution:
  - `solvePrompt`: "Show solution" on any exercise (`assist.getSolution`), the AI homework solving (`homework.ts:94`) and so the downloaded solutions PDF (`pdf.ts`), test-practice questions;
  - generated exercises' reference solutions (`generationPrompt`), checked by `verificationPrompt`;
  - the grader's corrected step (`correctedKeyStepMd`), and the TA-style walkthrough after a graded exercise;
  - the tutor's worked examples in `teach_step`, its `answer_question` replies, and a reference solution it writes for `assign_exercise` (source "new");
  - clues and hints (`clueBase`, `hintPrompt`): a clue mentions a convention only when the student's work has reached its use case;
  - "Find materials online" worked solutions (`web.ts`, custom courses), once conventions exist.
- **Generation** (`generationPrompt` + `verificationPrompt`): a generated question may be built so a weak convention's trigger occurs. The verifier rejects a reference solution that misses a triggered convention, or applies one that isn't triggered. Also `checksPrompt`.
- **Tutor** `[STATUS]`: the stage's conventions with their triggers and the student's control. It teaches each one with its use case ("whenever you rely on a law…") and checks it only in answers where it is triggered.

### 5b. Parallelism and performance
The host answers several jobs at once: the bridge parks jobs, and the instructions already say "answer them with parallel `shalav_submit_job` calls". The pipeline is shaped to use that:
- **Extraction adds no calls.** Solution occurrences come out of the existing `submitExercises` call. `extract()` already runs 3 batches in parallel (`ingest/index.ts:82`).
  - Teacher files use the same batched, parallel extractor, and they are queued alongside the other files in `indexPending`, not after them.
- **Reconcile is map → merge → map, not one huge job:**
  1. **Map: local use-case clustering, in parallel.** Occurrences and teacher items are split into chunks (≤ 60 each, grouped by unit, so related cases stay together). Each chunk becomes one job, all running at once. Each returns local clusters: a use-case description, the occurrence ids, and the practices seen.
  2. **Merge: one job, over the cluster summaries only (small).** It joins local clusters that are the same use case across chunks and files. It flags pairs of similar use cases with different practices. It also flags clusters with absences to refine.
  3. **Map: per use case, in parallel.** One job per global use case (practice grouping, refinement by absences, trigger / `notWhen` / `verify` / examples), and one job per flagged similar pair (the difference that separates them, and labelling every occurrence of both).
  4. **Server checks, deterministic and instant:** counting, separability, the removal rule, teacher-wins. A rejected pair is retried as a single job, in parallel with the other retries.
- **Incremental:** a use case whose occurrence ids, sources and teacher items are unchanged since the last reconcile is not sent again. A hash of its inputs is kept in the registry. A typical Update plan, which adds a few files, re-runs only the use cases those files touch, plus the merge.
- **Reconcile runs in parallel with `refinePlan`** in `build(n)` (`Promise.all`; both only read the fresh indexes). Conventions name stages only through `stageIds`, filtered against the plan when used, so a stage refine adds later just isn't referenced yet.
- **Teacher evidence needs no extra calls.** Concept scores (`nodeResults`) come from the teacher-notes extraction. Each teacher item's convention is known from the reconcile's clustering (its item ids), so convention evidence is written by the server right after reconcile. All of a course's events go in one append.
- **No extra calls at use time.** Grading, solving, clues, generation and the tutor get the conventions inside the call they already make. The trigger judgement and the solution's self-check against `verify` are part of the same answer. `candidatesFor` keeps the injected list short: stage + level + hints, at most 12, teacher first.
- **Eval:** case rows and their 3 stability runs run in parallel, at most 4 `claude -p` processes at once.

### 6. Course card list
- A collapsed section, "How answers are written in this course" (`CourseData.conventions`).
- Teacher conventions on top with a colored "Teacher" tag; the others are tagged "Example solutions".
- Each row shows:
  - the rule;
  - **when it applies** (the trigger, plus "not when …" if any);
  - a part / whole chip;
  - the student's control (★ or %);
  - a conflict note with how the use cases are split.
- 10 rows visible, then it scrolls like the files list. Retired conventions are hidden. i18n he/en.

## Milestones (each: commit + tests + Progress.md)
- **M70** Teacher role and folder, third upload zone; web-file origin; index fields `answerForms`/`question`/`part` + per-batch `patterns`.
- **M71** Teacher-notes analysis (`indexTeacher`, `submit_teacher_notes`); graded-work evidence (context `"teacher"`, weight 2, once per sha); mistakes.
- **M72** Registry + reconcile build step (map → merge → map in parallel, incremental, alongside `refinePlan`) + server rules (per-use-case counting, refinement by absences, separability, removal, teacher superiority) + `node_retired` + the stars exclusion.
- **M73** `applicable()` and its injection into grading, checks, solve, clues/hints, generation/verification and the tutor.
  - Added by the user (2026-10-23): **course facts are the course's.** A grader never deducts for a name, section number, date, definition or notation only from its own knowledge; it lists the doubt with search phrasings (synonyms, both languages), Shalav searches every scanned course file (word search + the exercise's stage pages; never web files), and one small check reads only those pages: wrong → deducted; right / not said → nothing; files disagree → teacher, then a clearly newer file, else no deduction and a note. No embeddings.
- **M74** Course card list + i18n + e2e (course, files specs), then screenshot review.
- The semantic eval (Verification A) is built alongside: the `CliGateway` and fixtures in M70–M71, run and tuned at the end of M72 and M73.

## Critical files
- **Schemas:** `src/core/domain/dataSchemas.ts` (role, IndexedExercise fields, FileIndex patterns/origin, `node_retired`, context "teacher").
- **Ingest:**
  - `src/core/domain/ingest/{import,index,queue,web}.ts`
  - `src/core/claude/prompts/index.ts`
  - `src/core/claude/tools.ts`
- **New:**
  - `src/core/domain/knowledge/conventions.ts`: registry, `applicable`, server rules
  - `src/core/claude/prompts/conventions.ts`
- **Graph and stars:**
  - `src/core/domain/knowledge/{graph,control,tag}.ts`
  - `src/server/knowledge/knowledge.ts`
- **Applying them:**
  - `src/core/claude/prompts/{practice,tutor,shared}.ts`
  - `src/core/domain/practice/{grade,assist,generate,run,homework}.ts`
  - `src/core/domain/ingest/web.ts`
  - `src/server/learnTools.ts`
- **Server and cards:**
  - `src/server/{courseTools,fileTools}.ts`
  - `src/cards/views/{Files,Course}.tsx`
  - `src/cards/types.ts`
  - i18n
- **Reuse:**
  - `applyNodes` / `candidates` / `listText` (tag.ts) for teacher evidence;
  - `dropIndex` (deleted files take their candidates with them);
  - `isExam`, `burnKey`;
  - the `zone()` upload in Files.tsx;
  - the files-list scroll pattern.

## Verification

### A. Semantic evaluation with a real model (the core check)
The unit tests prove the rules. Only a real model shows whether the **meaning** comes out right: a repeated convention found in long solutions, with the use case in which it applies, and the student's wrong answers never taken as truth.

- **Runner:** `pnpm eval:conventions`. It is opt-in, never in `pnpm test`, and spends tokens.
  - It uses a `CliGateway` (`src/test/eval/cliGateway.ts`, implements `ClaudeGateway`) that sends each job to the local Claude Code CLI: `claude -p --system-prompt … --json-schema <the tool's schema> --output-format json --tools ""`. That is the same model family the host uses, on the user's own login. No key in any file.
  - It runs the **real** pipeline on fixture courses written into a temp data root: scan → teacher analysis → reconcile → `applicable()` → grading.
  - It writes a report (an expected-vs-found table per fixture) to the scratchpad.
- **Fixtures** (`src/test/eval/fixtures/`, Markdown and PDF files written like real course files; long multi-page solutions, not one-liners):
  1. **Law (long answers):** 3 files with ~8 full model answers, each 1–2 pages, that always structure issue → rule → application → conclusion and cite statute + section **wherever they rely on a law**. Some answers rely on no law (a definition, a precedent only) and cite nothing: the boundary of the use case.
  1b. **Programming:** solutions where recursion/backtracking questions always include a trace table, and complexity-only questions never do.
     - Distractors:
       - One file by a single TA always opens with a summary paragraph. That's 4 solutions in 1 file: it **must not** become a convention.
       - A habit seen in only 2 solutions **must not** become one either.
  2. **Calculus/physics exam with mixed types:**
     - A multi-part question: (a) sketch the graph, (b) prove, (c) compute.
     - MCQs and true/false items.
     - The expected conventions and their use cases are checked by the case table below.
  3. **Teacher files:**
     - Two graded homeworks where the **student's answers are wrong**. The teacher's comments include "missing section number" in both, and a correction "the result is 5".
     - A rubric that contradicts a solutions convention: it demands exact form, while the solutions round to decimals.
     - Expected:
       - no student text appears in any convention, example, exam pool or lesson brief;
       - "cite section" becomes a **teacher** convention;
       - one misconception node for the repeated deduction;
       - the exact-form vs decimals conflict is split by use case, with the teacher's rule winning where both trigger.
  4. **Lifecycle:**
     - Delete the law solution files → the conventions stay.
     - Add a teacher remark contradicting one of them → it is retired.
     - Add only example solutions contradicting a teacher convention → it is **not** retired; the conflict is resolved by scope.
- **No percentage scoring. Every expected convention is checked by its use cases.** Each fixture carries a **case table**: real questions and answers, written for the eval and absent from the training files. For each expected convention, each row says whether the trigger holds and whether the rule is met. Each row is run through the real grading prompt with the learned registry, and the outcome must equal the table, **every row**:
  - **Law: "cite statute + section"**
    - The answer argues negligence under a named ordinance without the section → triggered, **unmet** (deducted, evidence 0 on its node).
    - The same with the section → triggered, met.
    - A question defining "consideration", whose answer relies on no law → **not triggered**: no deduction, no evidence. The rule must not fire just because it's a law course.
    - An answer that rests on a precedent and no statute → not triggered, if the sources showed precedent-only answers without citations (learned `notWhen`).
  - **Code: "backtracking trace table"**
    - A question that explicitly asks to trace → triggered.
    - A recursion question that can't be solved without tracing the calls → triggered, even though the table isn't asked for.
    - A question asking only for the time complexity → **not triggered**.
    - An answer with a correct trace table where none was needed → not triggered: no credit, no penalty.
  - **Calculus/physics:**
    - "label axes / mark asymptotes": triggered only where a graph is asked for or drawn; not by a computation part.
    - "check the theorem's conditions": triggered when the answer uses a theorem; not when it computes directly.
    - "units + 2 decimals": triggered by a numeric physical result; not by an exact symbolic one.
    - "number the parts and answer in order": triggered only by a whole multi-part answer, never by a single part.
    - "justify each step": not triggered by an MCQ or true/false answer.
  - **Teacher superiority:** a case where both the teacher's "exact form" and the solutions' "2 decimals" trigger → only the teacher's rule is applied. A case triggering only the solutions' rule ("give an estimate") → the solutions' rule applies.
- **Use-case counting fixtures (extraction):**
  - **Spread thin:** "underline the final answer" appears 6 times, 2 each in 3 fundamentally different use cases (a proof's conclusion, a numeric result, a definition). → **No convention.** Not even when the 6 are spread over 3 files.
  - **Similar use cases, different practices, with a real difference:** exact form where the data is symbolic or the question says "exactly"; 2 decimals with units where the data is measured. 4 solutions each, in 2 files. → **Two conventions**, each with a trigger built around the difference. The case table includes near-miss rows (symbolic data but the question asks to "estimate"…), and each row must apply exactly one, the right one.
  - **Refinement by absences:** law solutions cite the section in the 5 answers that rely on a statute, and not in 3 that only mention a statute as background. → One convention whose trigger says "relies on", with "only mentions" in `notWhen`. The case rows include an answer that only mentions a law: no deduction there, and its absence is not counted as a slip.
  - **Similar use cases, random variation:** the same kind of question, sometimes rounded and sometimes not, with nothing in the context to explain it. → **Neither** becomes a convention, and it is logged as inconsistent.
  - **The teacher settles a variation:** add a teacher remark ("always exact unless asked to estimate") to the random-variation fixture → one teacher convention with that trigger.
- **The AI's own solutions follow the conventions (case table, real prompts):** for each solution path (Show solution, AI homework solving, a generated exercise's reference solution, the tutor's worked example in `teach_step`, the grader's corrected step), the case rows hold:
  - a law question whose solution relies on a statute → the written solution cites the section;
  - a law question that relies on no statute → no forced citation;
  - a recursion question that needs tracing → a trace table;
  - a complexity-only question → none;
  - a graph part → labelled axes and asymptotes;
  - a symbolic-data part → exact form; a measured-data part → 2 decimals and units;
  - teacher superiority wherever both triggers occur.
  
  The judge checks each written solution against each convention's `verify` line, for every triggered convention and no untriggered one.
- **Extraction checks, also case-based:** for each learned convention, its use case is tested on held-out triggered and non-triggered questions (the same rows). Two things count as failures:
  - a convention that never triggers where it should;
  - one that triggers on rows marked "not triggered", i.e. it was learned too broadly, as "every law answer".

  These hard checks hold on the learned registry:
  - **forbidden conventions** must not exist: the TA's single-file habit, the 2-solution habit, anything quoting the student's own answers;
  - the lifecycle outcomes must be exact (stays / retired / split by use case).
- **Stability:** each case table runs 3 times. A row must give the same outcome all 3 times. A flip is a failure, and the prompt is tuned until it is stable.
- **Report:** per fixture, a table of each convention → its learned trigger → each case row with expected vs got (triggered / met) and the grader's `why`. It is saved to the scratchpad, with a summary in Progress.md.
- Run at the end of M72 (extraction + reconcile) and M73 (applying). The milestone is done only when every row passes.

### B. Unit (fake gateway): the deterministic rules
- **Unit (fake gateway):**
  - **Threshold:** 3 solutions in 1 file → no convention; 3 in 2 files → convention.
  - **Removal truth table:** files gone + no contradictor → stays; contradictor but a file remains → stays; both → retired. A teacher convention is retired only by a newer teacher one.
  - **Conflicts:** teacher vs solutions → both kept with scopes, and `applicable` puts the teacher one first.
  - **Scope filter:** a graph-only convention is applied to a graph answer, not to a computation; part vs whole.
  - **Stars** unchanged after a scan and moved by the first answer.
  - **Graded work:** weight 2, never twice per sha.
  - **Web files** ignored.
  - **The student's own answers never leak:** a graded homework whose student-written answer is wrong never reaches grading, solving, clues, generation, the lesson brief or the exam pool. Only the teacher's comments do, and a deduction repeated across 2 graded works creates one misconception node, linked to its concept.
  - Old indexes and registries still parse.
- **e2e:** the files spec (third zone, upload) and the course spec (list collapsed, teacher tag on top, scroll after 10). Then ask the user to review the screenshots.
- **No manual tests.** The whole Claude Desktop flow is automated as an MCP-level end-to-end eval: `pnpm eval:conventions --e2e`, part of Verification A. It drives the real MCP server over an in-memory transport, with the `CliGateway` answering the host jobs (`shalav_next_job` → `shalav_submit_job`, as Claude Desktop does):
  1. `file_upload_chunk` puts the law solutions in the exercises zone → `plan_build_request` → the jobs are answered → `shalav_course` shows the convention in `CourseData.conventions`.
  2. A graded homework uploaded to the teacher zone → Update plan → a teacher-tagged convention on top, the misconception node, and the stars move only through the teacher's evidence.
  3. `file_remove` of the solution files → Update plan → the convention stays.
  4. A contradicting teacher rubric → Update plan → resolved by scope, or retired per the rule.
  
  Then a lesson (`shalav_start_lesson`): `[STATUS]` lists the stage's conventions, teacher first. Practice grading tags them.
