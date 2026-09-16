// lib/facts.ts
//
// Maps raw Cardog/vPIC responses into normalized, source-tagged facts.
// Touches Cardog/vPIC types freely, but makes no network calls itself —
// those already happened in route.ts before this runs. This is the only
// file in the app allowed to know both "what Cardog's response looks like"
// and "what a fact means to the rule engine."
//
// The core discipline carried into every fact: known with a source, or
// explicitly unknown with a reason — never silently treated as a pass.

import type {
  VinIdentity,
  VinRecalls,
  SpecSheet,
  SpecSheetBuild,
  VpicFallbackResult,
} from "./cardog";
import { readSpecAttribute } from "./cardog";

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export type FactSource = "cardog" | "vpic-fallback";

// Why a fact is unknown — mirrors the five spec-sheet states from cardog.ts
// (minus "value", which becomes a known Fact instead) plus "not-decoded" for
// when we never had any identity to read from in the first place.
export type UnknownReason =
  | "trimDependent" // trims disagree; Cardog refused to average or pick
  | "partial" // only some trims report this attribute
  | "unservable" // Cardog checked and explicitly withheld it
  | "absent" // never appears anywhere in the spec sheet
  | "not-decoded"; // no identity/spec source resolved at all

export type Fact<T> =
  | { status: "known"; value: T; source: FactSource }
  | { status: "unknown"; reason: UnknownReason; detail?: string };

function known<T>(value: T, source: FactSource): Fact<T> {
  return { status: "known", value, source };
}

function unknown<T>(reason: UnknownReason, detail?: string): Fact<T> {
  return { status: "unknown", reason, detail };
}

// Canonical vehicle-type buckets, collapsing both Cardog's ref format
// ("vehicle-type:passenger-car") and vPIC's string format ("PASSENGER CAR")
// into one small set the rule engine can check against directly.
export type CanonicalVehicleType =
  | "passenger-car"
  | "mpv"
  | "truck"
  | "motorcycle"
  | "trailer"
  | "bus"
  | "low-speed-vehicle"
  | "off-road-vehicle"
  | "incomplete-vehicle"
  | "other";

function normalizeVehicleType(raw: string | null): CanonicalVehicleType | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("passenger-car") || s === "passenger car") return "passenger-car";
  if (s.includes("multipurpose-passenger-vehicle-mpv") || s.includes("multipurpose passenger vehicle")) return "mpv";
  if (s.includes("truck")) return "truck";
  if (s.includes("motorcycle")) return "motorcycle";
  if (s.includes("trailer")) return "trailer";
  if (s.includes("bus")) return "bus";
  if (s.includes("low-speed-vehicle") || s.includes("low speed vehicle") || s.includes("neighborhood electric")) return "low-speed-vehicle";
  if (s.includes("off-road-vehicle") || s.includes("off road vehicle")) return "off-road-vehicle";
  if (s.includes("incomplete")) return "incomplete-vehicle";
  return "other";
}

export interface OpenRecallSummary {
  campaignNumber: string;
  authorityLabel: string;
  component: string | null;
  correctiveAction: string | null;
}

export interface RecallFacts {
  checked: boolean; // Cardog's `resolved` — false means "could not check," never "clean"
  // Pre-filtered: campaigns with notificationType "Inconsequential" are
  // excluded here (Transport Canada's own text on these says they carry no
  // safety risk — e.g. a French-translation label typo). Still worth
  // surfacing on the results page, just not as an eligibility blocker.
  openCampaigns: OpenRecallSummary[];
  excludedInconsequentialCount: number; // so the UI can say "+1 non-safety notice on file" without re-deriving it
  asOf: string | null; // Cardog's own field: when the recall data was last updated. Real currency
  // date from the source, not our own request time — null when recalls couldn't be checked at all.
}

export interface VehicleFacts {
  vin: string;
  decoded: boolean; // true if either Cardog or vPIC identified the vehicle at all
  year: Fact<number>;
  vehicleType: Fact<CanonicalVehicleType>;
  seatingCapacity: Fact<number>;
  recalls: RecallFacts;
  mileage: number | null; // driver-reported, unverified — null if not provided; never sourced from an API
  // ISO timestamp of when THIS check ran — i.e. when our server made the
  // Cardog/vPIC requests. This is NOT the same claim as recalls.asOf: we
  // don't have a per-field "last updated" date from Cardog for identity or
  // specs data (no such field exists in either schema), so "when we
  // checked" is the most honest date available for year/vehicleType/
  // seatingCapacity/mileage. Conflating the two would overstate what
  // Cardog actually tells us.
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// buildVehicleFacts — maps raw API data into the shape above
// ---------------------------------------------------------------------------

export interface BuildFactsInput {
  vin: string;
  identity: VinIdentity | null;
  vpic?: VpicFallbackResult | null; // present when Cardog's own decode failed (identity.valid === false)
  specs?: { sheet: SpecSheet | SpecSheetBuild; grain: "nano" | "model-year" } | null;
  recalls: VinRecalls;
  mileage: number | null;
  checkedAt: string; // ISO timestamp; pass new Date().toISOString() from route.ts at request time
}

export function buildVehicleFacts(input: BuildFactsInput): VehicleFacts {
  const { vin, identity, vpic, specs, recalls, mileage, checkedAt } = input;

  const cardogDecoded = identity?.valid === true;
  // "Decoded" means we got the two fields every rule depends on — not an
  // interpretation of NHTSA's numeric ErrorCode. We've seen codes 1, 3, 5,
  // 6, 8, and 1+5+14 across real testing, several on VINs that decoded
  // perfectly fine (e.g. a broken-checksum VIN still returned full make/
  // year/vehicleType with ErrorCode "1"), so the error code isn't a
  // reliable proxy for usability — checking the actual fields is.
  const vpicDecoded = vpic != null && vpic.make != null && vpic.year != null;
  const decoded = cardogDecoded || vpicDecoded;

  // --- year ---
  let year: Fact<number>;
  if (cardogDecoded && identity!.year != null) {
    year = known(identity!.year, "cardog");
  } else if (vpicDecoded && vpic!.year != null) {
    year = known(vpic!.year, "vpic-fallback");
  } else {
    year = unknown("not-decoded");
  }

  // --- vehicleType ---
  let vehicleType: Fact<CanonicalVehicleType>;
  const cardogType = cardogDecoded ? normalizeVehicleType(identity!.refs.vehicleType) : null;
  const vpicType = vpicDecoded ? normalizeVehicleType(vpic!.vehicleType) : null;
  if (cardogType) {
    vehicleType = known(cardogType, "cardog");
  } else if (vpicType) {
    vehicleType = known(vpicType, "vpic-fallback");
  } else {
    vehicleType = unknown("not-decoded");
  }

  // --- seatingCapacity ---
  let seatingCapacity: Fact<number>;
  if (specs) {
    const result = readSpecAttribute(specs.sheet, "seatingCapacity");
    const cardogValue = result.status === "value" && typeof result.value === "number" ? result.value : null;

    if (cardogValue != null) {
      seatingCapacity = known(cardogValue, "cardog");
    } else if (vpicDecoded && vpic!.seats != null) {
      // Cardog's result wasn't a clean, usable number — partial, trimDependent,
      // unservable, absent, or non-numeric all land here. Previously this
      // fallback only fired on "absent" specifically, which meant a
      // perfectly good vPIC seat count — already fetched, since route.ts's
      // seatingCapacityUsable check triggers the vPIC call on any of these
      // statuses, not just absent — was silently discarded whenever Cardog
      // said "partial" instead, which is the MORE common case in practice.
      // vPIC decodes one specific build, same as the nano grain would, so
      // using it here is no less principled than the doors precedent.
      seatingCapacity = known(vpic!.seats, "vpic-fallback");
    } else if (result.status === "value") {
      // value exists but isn't numeric — a real data-quality problem
      // vPIC can't help with either.
      seatingCapacity = unknown("unservable");
    } else if (result.status === "unservable") {
      // Carry the specific reason (e.g. "not-an-integer") through instead of
      // discarding it — distinguishes "data on file is malformed" from
      // "never reported" (absent), which are genuinely different facts.
      seatingCapacity = unknown("unservable", result.reason);
    } else {
      seatingCapacity = unknown(result.status);
    }
  } else if (vpicDecoded && vpic!.seats != null) {
    seatingCapacity = known(vpic!.seats, "vpic-fallback");
  } else {
    seatingCapacity = unknown("not-decoded");
  }

  // Doors was dropped as a rule: Cardog's specs endpoint never populates it
  // in practice (confirmed across every vehicle category tested — see
  // cardog.ts), so it would have been vPIC-sourced or "cannot verify" on
  // essentially every real vehicle. vehicleType + seatingCapacity already
  // cover the "is this a practical passenger vehicle" question without it.

  // --- recalls ---
  // notificationType "Inconsequential" is a real observed value (Transport
  // Canada) meaning the campaign's own text says it carries no safety risk
  // — e.g. a bilingual-label wording fix. Excluded from the eligibility
  // gate, but the count is kept so the UI can still disclose it.
  const inconsequential = recalls.recalls.filter((r) => r.notificationType === "Inconsequential");
  const openCampaigns: OpenRecallSummary[] = recalls.recalls
    .filter((r) => r.notificationType !== "Inconsequential")
    .map((r) => ({
      campaignNumber: r.campaignNumber,
      authorityLabel: r.authorityLabel,
      component: r.component,
      correctiveAction: r.correctiveAction,
    }));

  return {
    vin,
    decoded,
    year,
    vehicleType,
    seatingCapacity,
    recalls: {
      checked: recalls.resolved,
      openCampaigns,
      excludedInconsequentialCount: inconsequential.length,
      asOf: recalls.asOf ?? null,
    },
    mileage,
    checkedAt,
  };
}
