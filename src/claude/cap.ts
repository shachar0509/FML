import { capState } from "@/domain/usage/usage";
import { ClaudeError } from "./errors";

type Deps = {
  /** Month-to-date USD at the time of the first call (usage.jsonl); later calls add `record`ed costs. */
  loadSpent: () => Promise<number>;
  capUsd: () => number | null;
  warn: () => void;
  /** true = Continue anyway, false = Stop. */
  confirm: () => Promise<boolean>;
};

/** Monthly-cap gate (9.7): toast once at 80 %, dialog before each new request at 100 % until "Continue anyway". */
export function makeCapGate(d: Deps) {
  let spent: number | undefined;
  let warned = false;
  let overridden = false;
  let pending: Promise<boolean> | undefined;
  return {
    record: (usd: number) => void (spent !== undefined && (spent += usd)),
    async beforeRequest() {
      spent ??= await d.loadSpent();
      const s = capState(spent, d.capUsd());
      if (s === "warn" && !warned) {
        warned = true;
        d.warn();
      }
      if (s !== "stop" || overridden) return;
      pending ??= d.confirm().finally(() => (pending = undefined)); // parallel requests share one dialog
      if (await pending) overridden = true;
      else throw new ClaudeError("cap_stopped", "Monthly limit reached");
    },
  };
}
