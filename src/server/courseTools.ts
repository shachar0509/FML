import { COURSE_ID_RE, isCustom, university } from "@/core/universities";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { BuildStatus, CourseData, FileCounts, LookupResult } from "@/cards/types";
import { type CatalogSource } from "@/core/domain/catalog/catalog";
import { addCourse, buildPlan, courseExists, loadCourse, type ManualEntry } from "@/core/domain/courses/courses";
import { newStageIds, refinePlan } from "@/core/domain/plan/refine";
import { removeFromPlan } from "@/core/domain/plan/remove";
import { gatherWeb } from "@/core/domain/ingest/web";
import { localize, translateCourse } from "@/core/domain/plan/translate";
import { claude, setClaude } from "@/core/claude/runtime";
import { useSettings } from "@/stores/settings";
import type { BridgeGateway } from "./bridge";
import { CARDS_URI } from "./resources";
import { nodeCatalog } from "./platform";

const both = { ui: { resourceUri: CARDS_URI, visibility: ["model" as const, "app" as const] } }; // also usable as plain tools in hosts without cards (Claude Code)
const lookupIn = z.object({ number: z.string() });
const numIn = z.object({ number: z.string().regex(COURSE_ID_RE) });
const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
type Build = { state: "running" | "done" | "failed"; progress: { step: "plan" | "index" | "cover"; unit?: { k: number; n: number }; files?: FileCounts } | null; error: string | null };
const out = (text: string, structuredContent: object) => ({ content: [{ type: "text" as const, text }], structuredContent: structuredContent as Record<string, unknown> });

/** Courses and plan (plan v2 §6.2): lookup, create/retry as bridge operations, status polling, Course Home data. */
type Files = { indexPending: (n: string, on: (c: FileCounts) => void) => Promise<number>; claim: (n: string) => Promise<void>; release: (n: string) => void };
export function registerCourseTools(server: McpServer, bridge: BridgeGateway, files: Files, source?: CatalogSource) {
  const catalog = () => source ?? nodeCatalog();
  setClaude(bridge); // domain code (createCourse/buildPlan) talks to the host model through the bridge
  const builds = new Map<string, Build>();
  const translating = new Set<string>(); // courses whose plan is being translated to the settings language
  const gathering = new Set<string>(); // custom courses whose materials are being gathered from the web
  const look = () => useSettings.getState().settings;

  /**
   * "Build plan" (one button, any time): no plan yet → generate it from the syllabus; then index the pending files
   * against the plan (indexing needs stage ids), then refine it so every topic of the materials and example exercises
   * has a stage. Card-only screens stay usable meanwhile; the AI parts run while Claude works through shalav_next_job.
   */
  function build(n: string) {
    const b: Build = { state: "running", progress: null, error: null };
    builds.set(n, b);
    bridge.run(
      `Building the study plan for ${n}`,
      async () => {
        try {
          await files.claim(n); // the files there when Build is pressed; one added meanwhile waits for the next build
          let had = (await loadCourse(n))?.plan ?? null;
          const fresh = !had;
          if (!had) {
            b.progress = { step: "plan" };
            const r = await buildPlan(n, (p) => (b.progress = { step: "plan", unit: p.unit }));
            if (r.planError) throw new Error(r.planError);
            had = (await loadCourse(n))?.plan ?? null;
          }
          const indexed = await files.indexPending(n, (files) => (b.progress = { step: "index", files: files.total ? files : undefined }));
          let added = 0;
          // Serial by design: refine starts only after every file of this course is read (indexPending waits for them), and one build per course runs at a time.
          const c = await loadCourse(n);
          if (indexed && c?.plan && had) {
            b.progress = { step: "cover" };
            added = newStageIds(had, await refinePlan({ gw: claude(), course: c.course, lang: look().language })).size;
          }
          b.state = "done";
          return { fresh, indexed, added };
        } catch (e) {
          b.state = "failed";
          b.error = e instanceof Error ? e.message : String(e);
          throw e;
        } finally {
          files.release(n);
        }
      },
      (r) => [{ type: "text", text: `The study plan for ${n} is ${r.fresh ? "built" : "updated"}${r.indexed ? ` from ${r.indexed} course file(s)` : ""}${r.added ? `; ${r.added} stage(s) were added so every topic in the files is covered` : r.indexed ? "; it already covered every topic in the files" : ""}. Tell the student in one sentence; the card shows the plan.` }],
      "build",
    ).done.catch(() => undefined); // errors are reported to the model by the bridge and to the card by status
  }

  const status = (n: string): BuildStatus => {
    const b = builds.get(n);
    if (!b) return { state: "none" };
    return { state: b.state, step: b.progress?.step, unit: b.progress?.unit, files: b.progress?.files, error: b.error, pending: bridge.pending() };
  };

  registerAppTool(server, "course_lookup", { title: "Look up a course", description: "look a course number up in the university catalog (Technion only; other universities need manual entry).", inputSchema: lookupIn, _meta: both }, async ({ number }) => {
    const uni = university();
    if (!uni) return { ...out("Choose a university first (shalav_choose_university).", { status: "invalid" }), isError: true };
    const n = uni.normalize(number);
    let r: LookupResult;
    if (!n) r = { status: "invalid" };
    else if (!uni.catalog) r = (await courseExists(n)) ? { status: "exists", number: n } : { status: "manual", number: n }; // no online catalog: manual entry
    else if (await courseExists(n)) r = { status: "exists", number: n };
    else {
      try {
        const e = await catalog().lookup(n);
        r = e ? { status: "found", entry: { courseNumber: e.courseNumber, nameHe: e.nameHe, credits: e.credits, faculty: e.faculty, syllabusHe: e.syllabusHe } } : { status: "notfound", number: n };
      } catch {
        r = { status: "offline", number: n };
      }
    }
    return out(r.status, r);
  });

  registerAppTool(
    server,
    "course_create_request",
    {
      title: "Add a course",
      description: "create the course (folders and course info only; the study plan is built later with plan_build_request).",
      inputSchema: z.object({ number: z.string(), manual: z.object({ nameHe: z.string(), credits: z.number(), syllabusHe: z.string() }).optional() }),
      _meta: both,
    },
    async ({ number, manual }) => {
      const n = university()?.normalize(number);
      if (!n) return { ...out("Invalid course number.", { ok: false }), isError: true };
      if (await courseExists(n)) return { ...out("Course already exists.", { ok: false }), isError: true };
      const entry = manual
        ? ({ courseNumber: n, ...manual, faculty: "", prerequisitesRaw: "" } satisfies ManualEntry)
        : await catalog().lookup(n).catch(() => null);
      if (!entry) return { ...out("Course not found in the catalog.", { ok: false }), isError: true };
      await addCourse(entry);
      return out(`Course ${n} added. Next the student adds course files (materials, example exercises, Moodle import) and presses Build plan when ready; without cards call plan_build_request.`, { ok: true, number: n });
    },
  );

  registerAppTool(
    server,
    "course_custom_create",
    {
      title: "Create a custom course",
      description: "create a course on any subject the student wants to learn (no university): its name, a description, the desired outcome (optional) and the current level 1-5. The study plan is built later with plan_build_request.",
      inputSchema: z.object({ name: z.string().min(1), description: z.string().min(1), goal: z.string().optional(), level: z.number().int().min(1).max(5) }),
      _meta: both,
    },
    async ({ name, description, goal, level }) => {
      const n = `C${Date.now().toString(36)}`; // a folder name; never shown
      await addCourse({ type: "customCourse", courseNumber: n, nameHe: name.trim(), credits: 0, faculty: "", syllabusHe: description.trim(), prerequisitesRaw: "", goal: goal?.trim() || undefined, level });
      return out(`Custom course "${name}" added. Next the student can add files and presses Build plan when ready; without cards call plan_build_request with number ${n}.`, { ok: true, number: n });
    },
  );

  registerAppTool(
    server,
    "plan_build_request",
    {
      title: "Build or update the plan",
      description: "Build the study plan (or update it): reads the course files the student added and makes sure every topic in them and in the example exercises has a stage (AI jobs: then call shalav_next_job with build: true, unless the result says another chat is already building).",
      inputSchema: numIn,
      _meta: both,
    },
    async ({ number }) => {
      if (!(await courseExists(number))) return { ...out("No such course.", { ok: false }), isError: true };
      if (builds.get(number)?.state === "running") return out("Already building.", { ok: true });
      const joined = bridge.buildChatActive(); // a chat is already working through builds: it continues with this one
      build(number);
      return joined
        ? out(`Queued the plan build for ${number}: the chat that is building now continues with it. Do not call shalav_next_job here.`, { ok: true, joined: true })
        : out(`Started building the plan for ${number}. Call shalav_next_job with build: true now.`, { ok: true, joined: false, next: "Call shalav_next_job with build: true now." });
    },
  );

  registerAppTool(server, "course_status", { title: "Plan build status", description: "progress of a plan build.", inputSchema: numIn, _meta: both }, async ({ number }) => {
    const s = status(number);
    return out(s.state, s);
  });

  registerAppTool(
    server,
    "shalav_course",
    { title: "Course", description: "Show one course: study plan, progress and what to watch out for. `number` is the 8-digit course number.", inputSchema: numIn, _meta: { ui: { resourceUri: CARDS_URI } } },
    async ({ number }) => {
      const c = await loadCourse(number);
      if (!c) return { ...out(`No course ${number}. Use shalav_home to list the courses.`, { error: "missing" }), isError: true };
      const { language, theme } = look();
      const { course, plan, progress } = c;
      const t = progress?.totals;
      const { tr, missing } = await localize(course, plan, language);
      const stages = (plan?.stages ?? []).map((s) => {
        const p = progress?.stages[s.id];
        return { id: s.id, title: tr(s.title), summary: tr(s.summary), status: p?.status ?? "locked", mastery: Math.round((p?.mastery ?? 0) * 100) };
      });
      const byId = new Map(stages.map((s) => [s.id, s]));
      const b = status(number);
      const data: CourseData = {
        view: "course",
        language,
        theme,
        number,
        name: tr(course.nameHe),
        credits: course.credits,
        custom: isCustom(course),
        stagesDone: t?.stagesCompleted ?? 0,
        stagesTotal: t?.stagesTotal ?? 0,
        pct: t && t.stagesTotal ? Math.round((100 * t.stagesCompleted) / t.stagesTotal) : 0,
        current: progress?.currentStageId ?? null,
        hasPlan: !!plan,
        build: b.state === "running" || b.state === "failed" ? b : null,
        canPractice: stages.some((s) => s.status === "completed" || s.status === "completed_override"),
        watch: (progress?.mistakes ?? []).filter((m) => !m.resolved).slice(0, 5).map((m) => ({ label: language === "he" ? m.labelHe : m.labelEn, count: m.count, stageIds: m.stageIds })),
        units: (plan?.units ?? []).map((u) => ({ id: u.id, title: tr(u.title), stages: u.stageIds.flatMap((id) => byId.get(id) ?? []) })),
        translate: { missing, running: translating.has(number) },
        web: isCustom(course) ? { running: gathering.has(number), level: course.level ?? 1 } : null,
      };
      const cur = data.current && byId.get(data.current);
      const text = `${course.courseNumber} — ${course.nameHe}\n${plan ? `${data.stagesDone}/${data.stagesTotal} stages done${cur ? `; next: ${cur.id} · ${cur.title}` : ""}` : "No study plan yet: the student adds course files, then presses Build plan."}\nOptions: 1) learn the next stage (shalav_start_lesson); 2) practice (shalav_practice); 3) add course files (files_list); 4) build or update the plan from the files (plan_build_request).`;
      return out(text, data);
    },
  );

  // M53: delete a whole unit or one stage from the plan (card-only, after the student confirms).
  registerAppTool(
    server,
    "plan_remove",
    { title: "Delete from the plan", description: "Card-only: delete a unit or a stage from the study plan.", inputSchema: numIn.extend({ unitId: z.string().optional(), stageId: z.string().optional() }), _meta: appOnly },
    async ({ number, unitId, stageId }) => {
      if (builds.get(number)?.state === "running") return { ...out("The plan is being built; try again when it is done.", { ok: false }), isError: true };
      const plan = (await loadCourse(number))?.plan;
      const ids = unitId ? (plan?.units.find((u) => u.id === unitId)?.stageIds ?? []) : stageId ? [stageId] : [];
      const next = await removeFromPlan(number, ids);
      if (!next) return { ...out("Nothing to delete (a plan keeps at least one stage).", { ok: false }), isError: true };
      return out(`Deleted ${ids.length} stage(s) from the ${number} plan.`, { ok: true });
    },
  );

  // M48: "Translate" on the course card (the student's choice: it spends the chat's turns). Study lane: the card sends "▶️ Continue".
  registerAppTool(server, "course_translate_request", { title: "Translate the plan", description: "Card-only: translate the course name and study plan to the settings language.", inputSchema: numIn, _meta: appOnly }, async ({ number }) => {
    const c = await loadCourse(number);
    if (!c) return { ...out(`No course ${number}.`, { error: "missing" }), isError: true };
    if (translating.has(number)) return out("Already translating.", { ok: true });
    const lang = look().language;
    translating.add(number);
    bridge.run(
      `Translating the study plan of ${number}`,
      (signal) => translateCourse(claude(), c.course, c.plan, lang, signal).finally(() => translating.delete(number)),
      (k) => [{ type: "text", text: `${k} text(s) of the ${number} plan were translated; the card shows them. Say nothing more than one short sentence.` }],
    ).done.catch(() => undefined);
    return out("Translating.", { ok: true });
  });

  // M54: "Find materials online" on a custom course card. Study lane: the card sends "▶️ Continue"; the files appear in the card as they are saved.
  registerAppTool(server, "course_web_request", { title: "Find materials online", description: "Card-only: gather study materials and exercises from the web for a custom course, at the student's level.", inputSchema: numIn, _meta: appOnly }, async ({ number }) => {
    const c = await loadCourse(number);
    if (!c || !isCustom(c.course)) return { ...out(`No custom course ${number}.`, { error: "missing" }), isError: true };
    if (gathering.has(number)) return out("Already gathering.", { ok: true });
    gathering.add(number);
    bridge.run(
      `Finding study materials online for "${c.course.nameHe}"`,
      (signal) => gatherWeb(claude(), c.course, look().language, signal).finally(() => gathering.delete(number)),
      (names) => [{ type: "text", text: `${names.length} file(s) were added to the course: ${names.join(", ")}. Tell the student in one short sentence that they are in the course files and that Build plan (or Update plan) reads them.` }],
    ).done.catch(() => undefined);
    return out("Gathering.", { ok: true });
  });

  return { building: (n: string) => builds.get(n)?.state === "running" };
}
