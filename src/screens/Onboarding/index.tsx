import { useState } from "react";
import { useNavigate } from "react-router";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkApiKey, type KeyCheckError } from "@/claude/keyCheck";
import { saveAndConnect } from "@/claude/connect";
import { ensureDataRoot } from "@/lib/firstRun";
import { useSettings } from "@/stores/settings";

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";
const TOTAL = 4;
const inTauri = () => "__TAURI_INTERNALS__" in window;

// Spec 12.2: 4-step wizard. Steps 1 and 4 are plain; 2 verifies the key, 3 picks the data folder.
export function Onboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { language, dataRoot } = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [step, setStep] = useState(1);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyOk, setKeyOk] = useState(false);
  const [error, setError] = useState<KeyCheckError | null>(null);

  const next = () => setStep((s) => s + 1);
  const back = step > 1 && (
    <Button variant="ghost" onClick={() => setStep(step - 1)}>
      {t("onboarding.back")}
    </Button>
  );

  async function check() {
    setBusy(true);
    setError(null);
    const err = await checkApiKey(key);
    if (err) setError(err);
    else {
      // The key reaches the credential store only after a successful check.
      try {
        if (inTauri()) await saveAndConnect(key);
        setKeyOk(true);
      } catch {
        setError("api.failed");
      }
    }
    setBusy(false);
  }

  async function openConsole() {
    if (inTauri()) (await import("@tauri-apps/plugin-opener")).openUrl(CONSOLE_URL);
    else window.open(CONSOLE_URL, "_blank");
  }

  async function changeFolder() {
    if (!inTauri()) return;
    const dir = await (await import("@tauri-apps/plugin-dialog")).open({ directory: true });
    if (typeof dir !== "string") return;
    await ensureDataRoot(dir);
    update({ dataRoot: dir });
  }

  function finish() {
    update({ onboardingCompleted: true });
    void navigate("/", { replace: true });
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <p className="text-sm text-muted">{t("onboarding.step", { n: step, total: TOTAL })}</p>

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-primary">Shalav · שלב</h1>
          <p>{t("onboarding.welcomeText")}</p>
          <div className="flex gap-2" role="group">
            {(["he", "en"] as const).map((l) => (
              <Button key={l} variant={language === l ? "default" : "outline"} onClick={() => update({ language: l })}>
                {l === "he" ? "עברית" : "English"}
              </Button>
            ))}
          </div>
          <Button className="self-start" onClick={next}>
            {t("onboarding.start")}
          </Button>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">{t("onboarding.connectTitle")}</h1>
          <p>{t("onboarding.connectText")}</p>
          <ol className="list-decimal ps-5">
            {(["s1", "s2", "s3", "s4"] as const).map((k) => (
              <li key={k}>{t(`onboarding.${k}`)}</li>
            ))}
          </ol>
          <Button variant="outline" className="self-start" onClick={() => void openConsole()}>
            {t("onboarding.openConsole")}
          </Button>
          <label className="flex flex-col gap-1 text-sm">
            {t("onboarding.keyLabel")}
            <Input
              type="password"
              dir="ltr"
              autoComplete="off"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyOk(false);
              }}
            />
          </label>
          <div className="flex items-center gap-3">
            <Button disabled={!key.trim() || busy} onClick={() => void check()}>
              {t("onboarding.check")}
            </Button>
            {keyOk && (
              <span className="flex items-center gap-1 text-success">
                <Check className="size-4" /> {t("onboarding.keyOk")}
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="text-danger">
              {t(error)}
            </p>
          )}
          <div className="flex gap-2">
            {back}
            <Button disabled={!keyOk} onClick={next}>
              {t("onboarding.next")}
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">{t("onboarding.whereTitle")}</h1>
          <p>{t("onboarding.whereText")}</p>
          <code dir="ltr" className="rounded-lg border border-border bg-card p-3 text-sm break-all">
            {dataRoot}
          </code>
          <Button variant="outline" className="self-start" onClick={() => void changeFolder()}>
            {t("onboarding.change")}
          </Button>
          <div className="flex gap-2">
            {back}
            <Button onClick={next}>{t("onboarding.next")}</Button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">{t("onboarding.syncTitle")}</h1>
          <p>{t("onboarding.syncText")}</p>
          {/* Google Drive connect lands with Step 12. */}
          <Button variant="outline" className="self-start" disabled title={t("onboarding.driveLater")}>
            {t("onboarding.connectDrive")}
          </Button>
          <div className="flex gap-2">
            {back}
            <Button onClick={finish}>{t("onboarding.skip")}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
