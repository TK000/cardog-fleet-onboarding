// app/components/SourceTag.tsx
//
// Source and date for every fact on the results page

export type DisplaySource = "cardog" | "vpic-fallback" | "driver-reported";
 
const LABELS: Record<DisplaySource, string> = {
  cardog: "Cardog",
  "vpic-fallback": "NHTSA (fallback)",
  "driver-reported": "you reported this",
};
 
export function formatDate(iso: string): string {
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
