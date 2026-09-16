// app/components/SourceTag.tsx
//
// The one visual device that carries the brief's central requirement:
// "what came from Cardog, what came from elsewhere, and what is your own
// inference must be visibly different things on the page." Every fact on
// the results page wears one of these.

export type DisplaySource = "cardog" | "vpic-fallback" | "driver-reported";

const LABELS: Record<DisplaySource, string> = {
  cardog: "Cardog",
  "vpic-fallback": "NHTSA (fallback)",
  "driver-reported": "you reported this",
};

export function SourceTag({ source, method }: { source: DisplaySource; method?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-[#D8D6CE] bg-[#F3F4F0] px-2 py-0.5 text-xs text-[#5B5A52]">
      {LABELS[source]}
      {method ? <span className="text-[#8A8A80]">· {method}</span> : null}
    </span>
  );
}