// M72 reconcile prompts (CONVENTIONS_PLAN §4). The model only proposes; the server decides every count, threshold and retirement.
// Item ids are opaque: `<sha8>-o<n>` an occurrence (a practice seen in a printed solution), `<sha8>-a<n>` an absence (a similar situation where it was NOT followed), `<sha8>-t<n>` a teacher item.

const ITEMS = `Items are named by their ids and must be copied verbatim. An item is one of:
- occurrence: a place in a printed example solution with that solution's own situation and the practice it followed;
- absence: a similar-looking situation in a printed solution where a practice was NOT followed;
- teacher item: a requirement, deduction or praise the teacher wrote (the teacher's words, never a student's answer).`;

const SAME = `Two situations are the same use case only if they are FUNDAMENTALLY the same: the same demand on the answer and the same kind of reasoning. Similar wording is not enough, and the same practice seen in fundamentally different situations is a different use case each time.`;

const LANG = (lang: string) => `Write useCase, practices, rule, trigger, notWhen, verify and examples in ${lang}. Ids stay verbatim.`;

export const conventionMapPrompt = (lang: string) =>
  `You cluster the evidence about how answers must be written in one university course by USE CASE: the situation in which a practice applies.
${ITEMS}
${SAME}
Rules:
- Every id of the list goes in exactly one cluster; never invent, repeat or drop an id.
- A teacher item goes with the occurrences of the same situation, judged by its "situation" (what the part asked and what the answer did there), the part and its level.
- An absence goes with the occurrences of the situation it looks like, so later analysis can compare them.
- useCase describes the shared situation concretely (≤240 chars). practices lists the distinct practices seen in the cluster, short.
${LANG(lang)}
Call submit_use_case_clusters.`;

export const conventionMergePrompt = (lang: string) =>
  `You merge local use-case clusters of one university course. Each cluster came from a different chunk of the evidence and has a key, a use-case description, the practices seen, and how many items and files it has.
${SAME}
Rules:
- Join the clusters that are fundamentally the same use case (the same situation seen in other files or chunks) into one use case; keep fundamentally different ones apart even if worded alike.
- Every cluster key goes in exactly one use case; copy the keys verbatim.
- similar: the pairs of use cases (1-based numbers in your useCases) that look alike but follow DIFFERENT practices (e.g. exact form vs 2 decimals), so that the context that tells them apart must be found. Do not list pairs that are clearly unrelated or that follow the same practice.
${LANG(lang)}
Call submit_use_case_merge.`;

export const useCasePrompt = (lang: string) =>
  `You derive the course conventions of ONE use case of a university course: how answers in this situation must be written.
${ITEMS}
A convention is a (use case, practice) pair. Rules:
- Group the occurrences and teacher items by practice. Write one convention per practice that is followed consistently, with its rule (what the answer must do, ≤160 chars, in general words).
- Refine the trigger by the absences: compare the followed items with the absent ones and find the context that differs (e.g. the statute is cited where the answer RELIES on it, not where it is only mentioned). Narrow the trigger to fit the followed items and move the absent cases into notWhen (one line each); list each such absence in "explained" with the number of its notWhen line. An absence the context does not explain stays inside the trigger and goes in "unexplained".
- List EVERY absence of this use case under exactly one convention, as explained or unexplained. If a difference turns out to be a separate use case with its own practice, that is a separate convention.
- Practices that vary in this use case with no context that tells when each is used are not conventions: report them in "inconsistent" with their ids, unless a teacher item settles it.
- trigger: the NARROWEST description that covers the convention's own followed items and excludes the others. on: question (what the question demands), answer (what the answer does) or both.
- examples (≤4): where it applied and where it clearly did not; re-check each against your trigger (applies:true must satisfy it, applies:false must not).
- verify: an observable check that an answer met it (e.g. "every statute named is followed by its section number"), never a vague one.
- followed: the occurrence ids where the practice was followed inside the trigger. teacher: the teacher item ids that state or enforce the rule. A teacher item's use case comes from its context (its situation, the part, its level); a requirement or deduction is the teacher's rule, a praise is the teacher's rule met.
- A teacher's rule stated generally ("always…", a rubric line, a remark not tied to one part) is as wide as the teacher's words: its trigger is the teacher's own situation, only the teacher's own exceptions go in notWhen, and it is never narrowed by the course's topic, the stage or the solutions' examples.
- The student's own answers are never a source: teacher items quote only the teacher.
- Match each convention to the numbered existing conventions by MEANING (sameAs = its number; the same use case and practice, even if worded differently), otherwise null. Do not duplicate an existing convention.
- contradicts: only when both triggers can hold for the SAME answer and the rules demand incompatible things. Give a resolution that splits the use cases (which trigger selects which rule); where both can still hold for one answer, the teacher's rule wins.
- stageIds only when the rule is limited to certain stages; otherwise empty. level: whole = a whole multi-part answer, part = each part, any = either.
${LANG(lang)}
Call submit_use_case_conventions.`;

export const separationPrompt = (lang: string) =>
  `You tell apart two similar use cases of a university course whose practices differ, so that for any answer it is clear which rule applies.
You get two conventions (each with its rule, trigger and notWhen) and the listed items that support them.
Rules:
- Find the context that tells the two use cases apart (e.g. "the data is symbolic, or the question says 'exactly'" vs "the data is measured numbers") and state it in "difference".
- Sharpen both triggers (and on, notWhen) around that difference, each the narrowest description covering its own items.
- label EVERY listed item: does trigger a hold for it, does trigger b. An item must satisfy at most one of them, unless one convention is the teacher's, where both may hold and the teacher's rule wins.
${LANG(lang)}
Call submit_use_case_separation.`;

export const mapMessage = (lines: string[]) => `Items (${lines.length}):\n${lines.join("\n")}`;

export const mergeMessage = (lines: string[]) => `Local clusters (${lines.length}):\n${lines.join("\n")}`;

export const useCaseMessage = (useCase: string, items: string[], existing: string[]) =>
  `Use case: ${useCase}\n\nItems (${items.length}):\n${items.join("\n")}\n\nExisting conventions of the course (active, teacher's first):\n${existing.join("\n") || "(none)"}`;

export const separationMessage = (a: string, b: string, items: string[], overlap: string[] = []) =>
  `Convention a:\n${a}\n\nConvention b:\n${b}\n\nListed items (${items.length}):\n${items.join("\n")}${overlap.length ? `\n\nYour previous labels had these items satisfying BOTH triggers (or left them unlabeled): ${overlap.join(", ")}. Find a sharper difference so that no item satisfies both.` : ""}`;
