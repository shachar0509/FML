import { describe, expect, it } from "vitest";
import type { IndexedExercise } from "@/core/domain/dataSchemas";
import { after, burnKey, inScope, isExam, pickTest, poolOf, scopeOf, type Store } from "./test";

const ex = (id: string, label: string, stage: string, sol = false, req: string[] = [stage]) =>
  ({ id, label, primaryStageId: stage, requiredStageIds: req, referenceSolutionMd: sol ? "s" : null }) as unknown as IndexedExercise;
const empty: Store = { burned: [], concepts: {} };

describe("test practice", () => {
  it("tells exams from other files", () => {
    const yes = ["Spring2006MoedA.pdf", "Spring2025MoedAsol.pdf", "234114_w2223_final_B_sol.pdf", "MIDTERM_V2_2341147_SUMMER23.pdf", "midSemQuiz_A1_winter2223.pdf", "midterm_exam_A_Spring25_with_answers.pdf", "בחן שאלות לדוגמא.pdf", "מבחן מועד א.pdf"];
    const no = ["HW0_WINTER27.pdf", "234114_winter26-27_sylabus.pdf", "Code-Conventions_2023.pdf", "תרגילים לתרגול עצמי.pdf", "CLION_INSTRUCTIONS_023401147_WINTER27.pdf"];
    expect(yes.filter((f) => !isExam(f))).toEqual([]);
    expect(no.filter(isExam)).toEqual([]);
  });
  it("keys a question by file and number; a solution twin shares it, parts don't", () => {
    expect(burnKey("Spring2006MoedA.pdf", "1")).toBe(burnKey("Spring2006MoedA_sol.pdf", "שאלה 1 – סכום ספרות"));
    expect(burnKey("Spring2025MoedAsol.pdf", "Question 2")).toBe("spring2025moeda#2");
    expect(burnKey("final_B_sol.pdf", "שאלה 1 סעיף א")).toBe("final_b#1א");
    expect(burnKey("x.pdf", "1.ב")).toBe("x#1ב");
    expect(burnKey("x.pdf", "שאלה 4 (Backtracking)")).toBe("x#4");
    expect(burnKey("x.pdf", "1a")).toBe("x#1a");
  });
  it("pools exam questions once, the solved copy first", () => {
    const pool = poolOf([
      { fileName: "MoedA.pdf", status: "indexed", exercises: [ex("a1", "1", "S1"), ex("a2", "2", "S2")] },
      { fileName: "MoedA_sol.pdf", status: "indexed", exercises: [ex("s1", "שאלה 1", "S1", true)] },
      { fileName: "HW1.pdf", status: "indexed", exercises: [ex("h", "1", "S1")] },
      { fileName: "B.pdf", status: "pending", exercises: [] },
    ]);
    expect(pool.map((p) => p.ex.id).sort()).toEqual(["a2", "s1"]);
  });
  it("never serves a burned question; follows the chain; generates when out", () => {
    const pool = poolOf([{ fileName: "Moed.pdf", status: "indexed", exercises: [ex("a", "1", "S1"), ex("b", "2", "S1"), ex("c", "3", "S2"), ex("d", "4", "S3", false, ["S3", "S9"])] }]);
    const s: Store = { burned: [{ file: "Moed.pdf", question: "1", key: "moed#1", at: "" }], concepts: {} };
    for (let i = 0; i < 20; i++) {
      const r = pickTest(pool, s, null, null, [], () => i / 20);
      expect(r && "pick" in r && r.pick.ex.id).not.toBe("a");
    }
    expect(pickTest(pool, s, { stageId: "S1", missedId: "a", left: 2 }, null, [])).toEqual({ pick: pool[1] });
    const allS1 = { ...s, burned: [...s.burned, { file: "", question: "", key: "moed#2", at: "" }] };
    expect(pickTest(pool, allS1, { stageId: "S1", missedId: "a", left: 1 }, null, [])).toEqual({ generate: "S1" });
    // not the recent stages; a scope takes its own stages' questions, which may need earlier stages but not later ones
    expect(pickTest(pool, allS1, null, null, ["S3"], () => 0)).toEqual({ pick: pool[2] });
    const plan = ["S1", "S2", "S3", "S9"].map((id, order) => ({ id, order }));
    expect(pickTest(pool, allS1, null, scopeOf(plan, ["S3"]), [])).toEqual(null); // needs S9, later
    expect(pickTest(pool, allS1, null, scopeOf(plan, ["S9", "S3"]), [])).toEqual({ pick: pool[3] });
    expect(inScope(ex("e", "5", "S2", false, ["S1", "S2"]), scopeOf(plan, ["S2"]))).toBe(true); // S1 is earlier: fine
    const done = { ...allS1, burned: [...allS1.burned, { file: "", question: "", key: "moed#3", at: "" }], concepts: { S2: { status: "weak" as const, streak: 0 } } };
    expect(pickTest(pool, done, null, scopeOf(plan, ["S1", "S2"]), [])).toEqual({ generate: "S2" });
  });
  it("2 follow-ups at most, then weak; 4 perfect in a row = learned", () => {
    let r = after(empty, null, "S1", "a", false);
    expect([r.note, r.chain?.left]).toEqual(["stern", 2]);
    r = after(r.store, r.chain, "S1", "b", false);
    expect([r.note, r.chain?.left]).toEqual(["stern", 1]);
    r = after(r.store, r.chain, "S1", "c", false);
    expect([r.note, r.chain, r.store.concepts.S1?.status]).toEqual(["weak", null, "weak"]);
    for (let i = 0; i < 3; i++) r = after(r.store, null, "S1", "x", true);
    expect(r.store.concepts.S1).toEqual({ status: "weak", streak: 3 });
    r = after(r.store, null, "S1", "x", true);
    expect([r.note, r.store.concepts.S1?.status]).toEqual(["learned", "learned"]);
    // a follow-up done perfectly ends the chain
    const m = after(empty, null, "S2", "a", false);
    expect(after(m.store, m.chain, "S2", "b", true).chain).toBe(null);
  });
});
