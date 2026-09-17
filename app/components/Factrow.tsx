// app/components/FactRow.tsx
//
// Renders one Fact<T> as a labeled row: a real value with its source tag
// when known, or an explicit "cannot verify" message when not

import type { Fact } from "@/lib/facts";
import { SourceTag } from "./SourceTag";

export function FactRow<T>({
  label,
  fact,
  format,
  unknownMessage,
  checkedAt,
}: {
  label: string;
  fact: Fact<T>;
  format: (value: T) => string;
  unknownMessage?: string;
  checkedAt: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#E4E2D8] py-3 last:border-b-0">
      <div className="pt-0.5 text-sm text-[#14171F]">{label}</div>
      <div className="flex flex-col items-end gap-1 text-right">
        {fact.status === "known" ? (
          <>
            <div className="font-[family-name:var(--font-mono)] text-sm text-[#14171F]">
              {format(fact.value)}
            </div>
            <SourceTag source={fact.source} method="decoded" date={checkedAt} dateLabel="checked" />
          </>
        ) : (
          <>
            <div className="text-sm italic text-[#8A8A80]">cannot verify</div>
            <div className="max-w-[240px] text-xs leading-snug text-[#8A8A80]">
              {unknownMessage ?? "We couldn't confirm this from the VIN provided."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
