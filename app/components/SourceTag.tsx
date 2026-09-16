// app/components/SourceTag.tsx
//
// The one visual device that carries the brief's central requirement:
// "Every number carries a source and a date... what came from Cardog,
// what came from elsewhere, and what is your own inference must be
// visibly different things on the page." Every known fact on the results
// page wears one of these, with a date attached.
//
// dateLabel matters: "as of" and "checked" are different claims. Recalls
// carry a real "last updated" date from Cardog itself (recalls.asOf), so
// that one honestly says "as of". Everything else (year, vehicle type,
// seating) has no per-field update date in Cardog's schema at all — the
// most honest thing we can say is when OUR app made the request, which is
// "checked", not "as of". Conflating the two would overstate what Cardog
// actually tells us.

export type DisplaySource = "cardog" | "vpic-fallback" | "driver-reported";

const LABELS: Record<DisplaySource, string> = {
  cardog: "Cardog",
  "vpic-fallback": "NHTSA (fallback)",
  "driver-reported": "you reported this",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SourceTag({
  source,
  method,
  date,
  dateLabel = "checked",
}: {
  source: DisplaySource;
  method?: string;
  date?: string; // ISO timestamp
  dateLabel?: "checked" | "as of" | "reported";
}) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-[#D8D6CE] bg-[#F3F4F0] px-2 py-0.5 text-xs text-[#5B5A52]"
      title={date ? new Date(date).toISOString() : undefined}
    >
      {LABELS[source]}
      {method ? <span className="text-[#8A8A80]">· {method}</span> : null}
      {date ? (
        <span className="text-[#8A8A80]">
          · {dateLabel} {formatDate(date)}
        </span>
      ) : null}
    </span>
  );
}
