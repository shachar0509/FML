import { COURSE_ID_RE, university } from "@/core/universities";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { BuildStatus, CourseData, LookupResult } from "@/cards/types";
import { setClaude } from "@/core/claude/runtime";
import { type CatalogSource } from "@/core/domain/catalog/catalog";
import { buildPlan, courseExists, createCourse, loadCourse, type CreateProgress, type ManualEntry } from "@/core/domain/courses/courses";
import { useSettings } from "@/stores/settings";
import type { BridgeGateway } from "./bridge";
import { CARDS_URI } from "./resources";
import { nodeCatalog } from "./platform";

const both = { ui: { resourceUri: CARDS_URI, visibility: ["model" as const, "app" as const] } }; // also usable as plain tools in hosts without cards (Claude Code)
const lookupIn = z.object({ number: z.string() });
const numIn = z.object({ number: z.string().regex(COURSE_ID_RE) });
type Build = { state: "running" | "done" | "failed"; progress: CreateProgress | null; error: string | null };
const out = (text: string, structuredContent: object) => ({ content: [{ type: "text" as const, text }], structuredContent: structuredContent as Record<string, unknown> });

/** Courses and plan (plan v2 §6.2): lookup, create/retry as bridge operations, status polling, Course Home data. */
export function registerCourseTools(server: McpServer, bridge: BridgeGateway, source?: CatalogSource) {
  const catalog = () => source ?? nodeCatalog();
  setClaude(bridge); // domain code (createCourse/buildPlan) talks to the host model through the bridge
  const builds = new Map<string, Build>();
  const look = () => useSettings.getState().settings;

  function start(n: string, label: string, run: (on: (p: CreateProgress) => void) => Promise<{ planError: string | null }>) {
    const b: Build = { state: "running", progress: null, error: null };
    builds.set(n, b);
    bridge.run(
      `${label} ${n}`,
      async () => {
        try {
          const r = await run((p) => (b.progress = p));
          b.state = r.planError ? "failed" : "done";
          b.error = r.planError;
          return r;
        } catch (e) {
          b.state = "failed";
          b.error = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
      (r) => [{ type: "text", text: r.planError ? `The plan for ${n} failed: ${r.planError}. Tell the student they can press Try again in the card.` : `The plan for ${n} is ready. Call shalav_course with number ${n} to show it.` }],
    ).done.catch(() => undefined); // errors are reported to the model by the bridge and to the card by status
  }

  const status = (n: string): BuildStatus => {
    const b = builds.get(n);
    if (!b) return { state: "none" };
    return { state: b.state, step: b.progress?.step, unit: b.progress?.unit, error: b.error, pending: bridge.pending() };
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
      description: "create the course and start building its plan (an AI job; the model must then call shalav_next_job).",
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
      start(n, "Building the study plan for", (on) => createCourse(entry, on));
      return out(`Started building the plan for ${n}. Call shalav_next_job now.`, { ok: true, number: n, next: "Call shalav_next_job now." });
    },
  );

  registerAppTool(server, "plan_retry_request", { title: "Retry the plan", description: "rebuild a failed plan (an AI job).", inputSchema: numIn, _meta: both }, async ({ number }) => {
    if (!(await courseExists(number))) return { ...out("No such course.", { ok: false }), isError: true };
    if (builds.get(number)?.state === "running") return out("Already building.", { ok: true });
    start(number, "Rebuilding the study plan for", (on) => buildPlan(number, on));
    return out(`Started rebuilding the plan for ${number}. Call shalav_next_job now.`, { ok: true, next: "Call shalav_next_job now." });
  });

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
      const stages = (plan?.stages ?? []).map((s) => {
        const p = progress?.stages[s.id];
        return { id: s.id, title: s.title, summary: s.summary, status: p?.status ?? "locked", mastery: Math.round((p?.mastery ?? 0) * 100) };
      });
      const byId = new Map(stages.map((s) => [s.id, s]));
      const b = status(number);
      const data: CourseData = {
        view: "course",
        language,
        theme,
        number,
        name: course.nameHe,
        credits: course.credits,
        stagesDone: t?.stagesCompleted ?? 0,
        stagesTotal: t?.stagesTotal ?? 0,
        pct: t && t.stagesTotal ? Math.round((100 * t.stagesCompleted) / t.stagesTotal) : 0,
        current: progress?.currentStageId ?? null,
        hasPlan: !!plan,
        build: plan ? null : b.state === "none" ? { state: "failed", error: null } : b,
        canPractice: stages.some((s) => s.status === "completed" || s.status === "completed_override"),
        watch: (progress?.mistakes ?? []).filter((m) => !m.resolved).slice(0, 5).map((m) => ({ label: language === "he" ? m.labelHe : m.labelEn, count: m.count, stageIds: m.stageIds })),
        units: (plan?.units ?? []).map((u) => ({ id: u.id, title: u.title, stages: u.stageIds.flatMap((id) => byId.get(id) ?? []) })),
      };
      const cur = data.current && byId.get(data.current);
      const text = `${course.courseNumber} — ${course.nameHe}\n${plan ? `${data.stagesDone}/${data.stagesTotal} stages done${cur ? `; next: ${cur.id} · ${cur.title}` : ""}` : "No study plan yet — offer plan_retry_request."}\nOptions: 1) learn the next stage (shalav_start_lesson); 2) practice (shalav_practice); 3) add or index files (files_list, files_start_indexing); 4) improve the plan (plan_improve_request).`;
      return out(text, data);
    },
  );
}
