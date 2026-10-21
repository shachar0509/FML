import { Figure } from "@/core/render/Figure";
import { Markdown } from "@/core/render/Markdown";
import type { FigureData } from "../types";
import { panel } from "../ui";

export function FigureCard({ data, bare }: { data: FigureData; bare?: boolean }) {
  return (
    <figure className={`${bare ? "" : `${panel} p-4`} flex flex-col gap-2`}>
      <div dir="ltr">
        <Figure tag={data.kind} source={data.source} />
      </div>
      {data.captionMd && (
        <figcaption className="text-sm text-muted">
          <Markdown>{data.captionMd}</Markdown>
        </figcaption>
      )}
    </figure>
  );
}
