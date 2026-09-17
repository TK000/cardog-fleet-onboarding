// lib/facts.ts
//
// Maps raw Cardog/vPIC responses into normalized, source-tagged facts
// that can be fed into the eligibility engine in eligibility.ts.

import type {
  VinIdentity,
  VinRecalls,
  SpecSheet,
  VpicFallbackResult,
} from "./cardog";
import { readSpecAttribute } from "./cardog";

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export type FactSource = "cardog" | "vpic-fallback";

// A fact is either known (with its source) or unknown. No reason is
// tracked on the unknown branch: cardog.ts's readSpecAttribute() still
// distinguishes trimDependent/partial/unservable/absent internally, since
// that distinction determines whether a Cardog value is safe to trust as
// real — but once that's decided, nothing downstream (the rule engine, the
// UI) ever branched on *why* a fact was unknown, only that it was. Carrying
// the reason this far was unused plumbing.
export type Fact<T> =
  | { status: "known"; value: T; source: FactSource }
  | { status: "unknown" };

function known<T>(value: T, source: FactSource): Fact<T> {
  return { status: "known", value, source };
}

function unknown<T>(): Fact<T> {
  return { status: "unknown" };
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
  recallDate: string | null; // this campaign's own issue date — distinct from RecallFacts.asOf, which is when Cardog's overall recall data was last refreshed
}

export interface RecallFacts {
  checked: boolean; // Cardog's `resolved` — false means "could not check," never "clean"
  openCampaigns: OpenRecallSummary[];
  asOf: string | null; // Cardog's own field: when the recall data was last updated
}

export interface VehicleFacts {
  vin: string;
  decoded: boolean; // true if either Cardog or vPIC identified the vehicle at all
  year: Fact<number>;
  vehicleType: Fact<CanonicalVehicleType>;
  seatingCapacity: Fact<number>;
  recalls: RecallFacts;
  mileage: number | null; // driver-reported, unverified — null if not provided
  checkedAt: string; // ISO timestamp of when this check ran
}

// ---------------------------------------------------------------------------
// buildVehicleFacts — maps raw API data into the shape above
// ---------------------------------------------------------------------------

export interface BuildFactsInput {
  vin: string;
  identity: VinIdentity | null;
  vpic?: VpicFallbackResult | null;
  specs?: SpecSheet | null;
  recalls: VinRecalls;
  mileage: number | null;
  checkedAt: string; // ISO timestamp
}

export function buildVehicleFacts(input: BuildFactsInput): VehicleFacts {
  const { vin, identity, vpic, specs, recalls, mileage, checkedAt } = input;

  const cardogDecoded = identity?.valid === true;
  const vpicDecoded = vpic != null && vpic.make != null && vpic.year != null;
  const decoded = cardogDecoded || vpicDecoded;

  // --- year ---
  let year: Fact<number>;
  if (cardogDecoded && identity!.year != null) {
    year = known(identity!.year, "cardog");
  } else if (vpicDecoded && vpic!.year != null) {
    year = known(vpic!.year, "vpic-fallback");
  } else {
    year = unknown();
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
    vehicleType = unknown();
  }

  // --- seatingCapacity ---
  // readSpecAttribute still distinguishes trimDependent/partial/unservable/
  // absent internally (see cardog.ts) — that's needed to know whether
  // Cardog's value is safe to use at all. But once it isn't, we no longer
  // care which of those four reasons applied, only that it wasn't usable,
  // so we try vPIC and otherwise fall through to a flat unknown().
  let seatingCapacity: Fact<number>;
  const specResult = specs ? readSpecAttribute(specs, "seatingCapacity") : null;
  const cardogSeats =
    specResult?.status === "value" && typeof specResult.value === "number" ? specResult.value : null;

  if (cardogSeats != null) {
    seatingCapacity = known(cardogSeats, "cardog");
  } else if (vpicDecoded && vpic!.seats != null) {
    seatingCapacity = known(vpic!.seats, "vpic-fallback");
  } else {
    seatingCapacity = unknown();
  }

  // --- recalls ---
  const openCampaigns: OpenRecallSummary[] = recalls.recalls
    .map((r) => ({
      campaignNumber: r.campaignNumber,
      authorityLabel: r.authorityLabel,
      component: r.component,
      correctiveAction: r.correctiveAction,
      recallDate: r.recallDate,
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
      asOf: recalls.asOf ?? null,
    },
    mileage,
    checkedAt,
  };
}
