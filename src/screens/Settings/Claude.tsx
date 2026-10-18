import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { saveAndConnect } from "@/claude/connect";
import { checkApiKey } from "@/claude/keyCheck";
import { TASK_IDS, TASKS, type TaskId } from "@/claude/models";
import { availableModelIds, disconnectClaude } from "@/claude/runtime";
import { DEFAULT_SETTINGS } from "@/domain/schemas";
import { API_KEY_ACCOUNT, secretDelete, secretGet } from "@/lib/secrets";
import { useSettings } from "@/stores/settings";
import { Row, Select, Toggle, useWarn } from "./parts";

const D = DEFAULT_SETTINGS;
const mask = (k: string) => `sk-ant-…${k.slice(-4)}`;

function ApiKey() {
  const { t } = useTranslation();
  const [key, setKey] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => secretGet(API_KEY_ACCOUNT).then(setKey, () => setKey(null));
  useEffect(() => {
    void load();
  }, []);

  async function check(k: string) {
    setBusy(true);
    const err = await checkApiKey(k);
    setMsg(err ? { ok: false, text: t(err) } : { ok: true, text: t("settings.claude.keyOk") });
    setBusy(false);
    return !err;
  }
  async function save() {
    if (!(await check(draft))) return;
    try {
      await saveAndConnect(draft);
    } catch {
      setMsg({ ok: false, text: t("api.failed") });
      return;
    }
    setReplacing(false);
    setDraft("");
    await load();
  }
  async function remove() {
    await secretDelete(API_KEY_ACCOUNT).catch(() => undefined);
    disconnectClaude();
    setKey(null);
    setMsg(null);
    toast({ message: t("settings.claude.removed") });
  }

  return (
    <div className="border-b border-border py-3">
      <Row label={t("settings.claude.apiKey")} hint={key ? <code dir="ltr">{mask(key)}</code> : t("settings.claude.noKey")} className="border-b-0 py-0">
        {key && (
          <Button variant="outline" disabled={busy} onClick={() => void check(key)}>
            {t("settings.claude.check")}
          </Button>
        )}
        <Button variant="outline" onClick={() => setReplacing(true)}>
          {t("settings.claude.replace")}
        </Button>
        {key && (
          <Button variant="danger" onClick={() => void remove()}>
            {t("settings.claude.remove")}
          </Button>
        )}
      </Row>
      {replacing && (
        <div className="mt-3 flex gap-2">
          <Input type="password" dir="ltr" autoComplete="off" aria-label={t("settings.claude.newKey")} placeholder={t("settings.claude.newKey")} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button disabled={!draft.trim() || busy} onClick={() => void save()}>
            {t("settings.claude.save")}
          </Button>
          <Button variant="ghost" onClick={() => setReplacing(false)}>
            {t("settings.claude.cancel")}
          </Button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "mt-2 text-sm text-success" : "mt-2 text-sm text-danger"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

export function Claude() {
  const { t } = useTranslation();
  const { models, grading, retrieval } = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const { warn, dialog } = useWarn();
  const [ids, setIds] = useState<string[]>([]);
  const [budget, setBudget] = useState<number | null>(null); // local while dragging

  useEffect(() => {
    void availableModelIds().then(setIds);
  }, []);

  const setModel = (task: TaskId, id: string | undefined) => {
    const rest = Object.fromEntries(Object.entries(models).filter(([k]) => k !== task));
    update({ models: id === undefined || id === TASKS[task].model ? rest : { ...rest, [task]: id } });
  };
  const commitBudget = (v: number) => {
    setBudget(null);
    if (v === grading.thinkingBudget) return;
    warn(v < 8000 && v < grading.thinkingBudget, () => update({ grading: { ...grading, thinkingBudget: v } }));
  };

  return (
    <div>
      <ApiKey />
      <h2 className="mt-4 text-base font-semibold">{t("settings.claude.models")}</h2>
      {TASK_IDS.map((task) => {
        const def = TASKS[task].model;
        const value = models[task] ?? def;
        const options = [...new Set([def, ...ids, value])];
        return (
          <Row key={task} label={t(`settings.claude.tasks.${task}`)}>
            {models[task] && (
              <>
                <span className="rounded-full bg-border px-2 py-0.5 text-xs">{t("settings.claude.changed")}</span>
                <Button variant="ghost" size="icon" aria-label={t("settings.claude.reset")} onClick={() => setModel(task, undefined)}>
                  <Undo2 className="size-4" />
                </Button>
              </>
            )}
            <Select
              dir="ltr"
              aria-label={t(`settings.claude.tasks.${task}`)}
              value={value}
              onChange={(e) => {
                const id = e.target.value;
                warn(id !== def, () => setModel(task, id));
              }}
            >
              {options.map((id) => (
                <option key={id} value={id}>
                  {id === def ? `${id} ${t("settings.claude.recommended")}` : id}
                </option>
              ))}
            </Select>
          </Row>
        );
      })}

      <h2 className="mt-6 text-base font-semibold">{t("settings.claude.gradingTitle")}</h2>
      <Row label={t("settings.claude.thinking")}>
        <Toggle
          label={t("settings.claude.thinking")}
          checked={grading.thinking}
          onChange={(v) => warn(!v, () => update({ grading: { ...grading, thinking: v } }))}
        />
      </Row>
      <Row label={t("settings.claude.budget", { n: budget ?? grading.thinkingBudget })}>
        <input
          type="range"
          dir="ltr"
          className="w-56 accent-primary"
          aria-label={t("settings.claude.gradingTitle")}
          min={2000}
          max={32000}
          step={1000}
          disabled={!grading.thinking}
          value={budget ?? grading.thinkingBudget}
          onChange={(e) => setBudget(e.target.valueAsNumber)}
          onPointerUp={(e) => commitBudget(e.currentTarget.valueAsNumber)}
          onKeyUp={(e) => commitBudget(e.currentTarget.valueAsNumber)}
          onBlur={(e) => commitBudget(e.currentTarget.valueAsNumber)}
        />
      </Row>
      <Row label={t("settings.claude.webLookup")}>
        <Toggle label={t("settings.claude.webLookup")} checked={retrieval.webSearch} onChange={(v) => warn(!v, () => update({ retrieval: { webSearch: v } }))} />
      </Row>

      <Button variant="outline" className="mt-4" onClick={() => update({ models: {}, grading: D.grading, retrieval: D.retrieval })}>
        {t("settings.claude.restoreAll")}
      </Button>
      {dialog}
    </div>
  );
}
