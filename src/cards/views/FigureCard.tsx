import { Figure } from "@/core/render/Figure";
import { Markdown } from "@/core/render/Markdown";
import type { FigureData } from "../types";
import { panel } from "../ui";

export function FigureCard({ data }: { data: FigureData }) {
  return (
    <figure className={`${panel} flex flex-col gap-2 p-4`}>
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
