// app/components/FactRow.tsx
//
// Renders one Fact<T> as a labeled row: a real value with its source tag
// when known, or an explicit "cannot verify" state with a specific reason
// when not. There is no third rendering path — a Fact is never silently
// treated as passing, and it's never left blank.

import type { Fact, UnknownReason } from "@/lib/facts";
import { SourceTag } from "./SourceTag";

export function FactRow<T>({
  label,
  fact,
  format,
  unknownReason,
  checkedAt,
}: {
  label: string;
  fact: Fact<T>;
  format: (value: T) => string;
  // Optional per-field messaging for *why* it's unknown (e.g. seating
  // capacity's five-state explanation from eligibility.ts). Falls back to
  // a generic message for facts that only ever have one unknown reason
  // in practice (year, vehicle type — both are identity-sourced, not
  // spec-sourced, so they never hit trimDependent/partial/unservable).
  unknownReason?: (reason: UnknownReason, detail?: string) => string;
  // When this specific check ran (VehicleFacts.checkedAt). Cardog doesn't
  // give us a per-field "last updated" date for identity/specs facts, so
  // this is the most honest date available — labeled "checked", not
  // "as of", on the SourceTag itself.
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
              {unknownReason
                ? unknownReason(fact.reason, fact.detail)
                : "We couldn't confirm this from the VIN provided."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
