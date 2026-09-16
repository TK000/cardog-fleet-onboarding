// app/components/VerdictResult.tsx

import type { VehicleFacts, CanonicalVehicleType } from "@/lib/facts";
import type { Verdict } from "@/lib/eligibility";
import { describeUnknownSeats } from "@/lib/eligibility";
import { FactRow } from "./Factrow";
import { SourceTag } from "./SourceTag";

const STATUS_COPY: Record<Verdict["status"], { label: string; color: string; bg: string }> = {
  eligible: { label: "Eligible", color: "#2F6E4F", bg: "#EAF2ED" },
  "not-eligible": { label: "Not eligible", color: "#A23B2E", bg: "#F6EAE8" },
  "cannot-say": { label: "Cannot say", color: "#B8863B", bg: "#F7F0E4" },
};

const VEHICLE_TYPE_LABELS: Record<CanonicalVehicleType, string> = {
  "passenger-car": "Passenger car",
  mpv: "Multipurpose passenger vehicle",
  truck: "Truck",
  motorcycle: "Motorcycle",
  trailer: "Trailer",
  bus: "Bus",
  "low-speed-vehicle": "Low speed vehicle",
  "off-road-vehicle": "Off-road vehicle",
  "incomplete-vehicle": "Incomplete vehicle",
  other: "Other",
};

export function VerdictResult({
  facts,
  verdict,
  onReset,
}: {
  facts: VehicleFacts;
  verdict: Verdict;
  onReset: () => void;
}) {
  const status = STATUS_COPY[verdict.status];

  return (
    <div className="w-full max-w-xl">
      {/* Status banner */}
      <div
        className="border px-6 py-5"
        style={{ borderColor: status.color, backgroundColor: status.bg }}
      >
        <div
          className="font-[family-name:var(--font-serif)] text-2xl font-semibold"
          style={{ color: status.color }}
        >
          {status.label}
        </div>
        <div className="mt-1 font-[family-name:var(--font-mono)] text-sm text-[#5B5A52]">
          {facts.vin}
        </div>
        <ul className="mt-4 space-y-2">
          {verdict.reasons.map((reason, i) => (
            <li key={i} className="text-sm leading-snug text-[#14171F]">
              {reason}
            </li>
          ))}
        </ul>
      </div>

      {/* Facts panel */}
      <div className="mt-6 border border-[#D8D6CE] bg-white px-6 py-2">
        <div className="border-b border-[#E4E2D8] py-3 text-sm font-medium text-[#5B5A52]">
          What we found
        </div>

        <FactRow
          label="Model year"
          fact={facts.year}
          format={(v) => String(v)}
          checkedAt={facts.checkedAt}
        />
        <FactRow
          label="Vehicle type"
          fact={facts.vehicleType}
          format={(v) => VEHICLE_TYPE_LABELS[v]}
          checkedAt={facts.checkedAt}
        />
        <FactRow
          label="Seats"
          fact={facts.seatingCapacity}
          format={(v) => `${v} seats`}
          unknownReason={describeUnknownSeats}
          checkedAt={facts.checkedAt}
        />

        {/* Recalls: not a Fact<T> — its own shape, rendered directly.
            Uses recalls.asOf (Cardog's own field) with dateLabel="as of",
            NOT facts.checkedAt — this is the one fact where Cardog tells us
            its own data-currency date directly, so we cite that instead of
            our own request time. */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E4E2D8] py-3">
          <div className="pt-0.5 text-sm text-[#14171F]">Recalls</div>
          <div className="flex flex-col items-end gap-1 text-right">
            {!facts.recalls.checked ? (
              <>
                <div className="text-sm italic text-[#8A8A80]">cannot verify</div>
                <div className="max-w-[240px] text-xs leading-snug text-[#8A8A80]">
                  We couldn't check recall status for this vehicle.
                </div>
              </>
            ) : facts.recalls.openCampaigns.length === 0 ? (
              <>
                <div className="text-sm text-[#14171F]">None open</div>
                <SourceTag
                  source="cardog"
                  method="checked"
                  date={facts.recalls.asOf ?? undefined}
                  dateLabel="as of"
                />
                {facts.recalls.excludedInconsequentialCount > 0 && (
                  <div className="text-xs text-[#8A8A80]">
                    +{facts.recalls.excludedInconsequentialCount} non-safety notice
                    {facts.recalls.excludedInconsequentialCount > 1 ? "s" : ""} on file
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-[#A23B2E]">
                  {facts.recalls.openCampaigns.length} open
                </div>
                <SourceTag
                  source="cardog"
                  method="checked"
                  date={facts.recalls.asOf ?? undefined}
                  dateLabel="as of"
                />
              </>
            )}
          </div>
        </div>

        {/* Recall detail — only rendered when there's something to show */}
        {facts.recalls.checked && facts.recalls.openCampaigns.length > 0 && (
          <div className="space-y-3 border-b border-[#E4E2D8] py-3">
            {facts.recalls.openCampaigns.map((c) => (
              <div key={c.campaignNumber} className="border-l-2 border-[#A23B2E] pl-3">
                <div className="font-[family-name:var(--font-mono)] text-xs text-[#5B5A52]">
                  {c.campaignNumber} · {c.authorityLabel}
                </div>
                {c.component && (
                  <div className="mt-0.5 text-sm text-[#14171F]">{c.component}</div>
                )}
                {c.correctiveAction && (
                  <div className="mt-1 text-xs leading-snug text-[#5B5A52]">
                    {c.correctiveAction}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="pt-0.5 text-sm text-[#14171F]">Mileage</div>
          <div className="flex flex-col items-end gap-1 text-right">
            {facts.mileage != null ? (
              <>
                <div className="font-[family-name:var(--font-mono)] text-sm text-[#14171F]">
                  {facts.mileage.toLocaleString()} mi
                </div>
                <SourceTag source="driver-reported" date={facts.checkedAt} dateLabel="reported" />
              </>
            ) : (
              <div className="text-sm italic text-[#8A8A80]">not provided</div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={onReset}
        className="mt-6 border border-[#D8D6CE] px-4 py-2 text-sm text-[#14171F] transition-colors hover:bg-[#EAE8E0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14171F]"
      >
        Check another vehicle
      </button>
    </div>
  );
}
