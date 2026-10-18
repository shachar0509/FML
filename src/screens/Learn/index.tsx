import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { claude } from "@/claude/runtime";
import { loadCourse, type CourseSummary } from "@/domain/courses/courses";
import { Lesson } from "@/domain/learn/engine";
import { loadImageB64 } from "@/lib/attachments";
import { LessonView } from "./LessonView";

function Msg({ n, k }: { n: string; k: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3 p-8">
      <p className="text-muted">{t(k)}</p>
      <Link to={`/course/${n}`} className="text-primary underline">{t("learn.back")}</Link>
    </div>
  );
}

function Session({ n, stageId }: { n: string; stageId: string }) {
  const { t } = useTranslation();
  const [lesson] = useState(() => new Lesson(n, stageId, { gw: claude(), loadImage: loadImageB64(n) }));
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    lesson.open().catch(() => setFailed(true));
  }, [lesson]);
  return failed ? <p className="p-8 text-danger">{t("learn.loadFailed")}</p> : <LessonView lesson={lesson} />;
}

export function Learn() {
  const { number = "", stageId = "" } = useParams();
  const [s, setS] = useState<CourseSummary | null | undefined>(undefined);
  useEffect(() => void loadCourse(number).then(setS), [number]);
  if (s === undefined) return null;
  const st = s?.plan?.stages.find((x) => x.id === stageId);
  if (!s || !st) return <Msg n={number} k="learn.notFound" />;
  if (s.progress?.stages[stageId]?.status === "locked") return <Msg n={number} k="learn.locked" />;
  return <Session key={`${number}/${stageId}`} n={number} stageId={stageId} />;
}
