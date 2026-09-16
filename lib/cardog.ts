// lib/cardog.ts
//
// All Cardog + vPIC network calls live in this file: every function calls an
// endpoint and returns a typed result. No business logic here

// everything here was verified against https://api.cardog.app/v2/openapi.json
// and https://vpic.nhtsa.dot.gov/api/


const CARDOG_BASE = "https://api.cardog.app/v2";
const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

function cardogHeaders(): HeadersInit {
  const key = process.env.CARDOG_API_KEY;
  if (!key) {
    throw new Error("CARDOG_API_KEY is not set");
  }
  return { "x-api-key": key };
}

// ---------------------------------------------------------------------------
// VIN identity
// ---------------------------------------------------------------------------

export type AuthorityTier = "authoritative" | "commercial" | "derived" | "observed";

export interface VinIdentityRefs {
  make: string | null;
  model: string | null;
  modelYear: string | null;
  bodyStyle: string | null;
  fuelType: string | null;
  driveType: string | null;
  transmission: string | null;
  electrificationLevel: string | null;
  vehicleType: string | null;
  gvwr?: string | null;
  country: string | null;
}

export interface ObservedTrim {
  value: string;
  authorityTier: "observed"; // always "observed" per schema
  asOf: string | null;
}

export interface VinIdentity {
  vin: string;
  valid: boolean; // when false, every other field and every ref is null
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  trimAuthorityTier?: AuthorityTier | null;
  observedTrim?: ObservedTrim | null;
  refs: VinIdentityRefs;
  nano: string | null;
  squish: string | null;
  authorityTier?: AuthorityTier;
  links: Record<string, string>;
}

// decode a VIN via Cardog 
export async function getVinIdentity(vin: string): Promise<VinIdentity> {
  const res = await fetch(`${CARDOG_BASE}/vin/${encodeURIComponent(vin)}`, {
    headers: cardogHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Cardog VIN identity lookup failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Recalls
// ---------------------------------------------------------------------------

export interface RecallAffectedYear {
  modelYearRef: string;
  year: number;
  unitsAffected: number | null;
}

export interface RecallCampaign {
  ref: string;
  authority: string;
  authorityLabel: string;
  campaignNumber: string;
  component: string | null;
  defectSummary: string | null;
  consequenceSummary: string | null;
  correctiveAction: string | null;
  recallDate: string | null;
  notificationType: string | null;
  unitsAffected: number | null;
  affects: RecallAffectedYear[];
  links?: Record<string, string>;
}

export interface VinRecalls {
  vin: string;
  modelYearRef: string | null;
  resolved: boolean;
  source?: "observed" | "decoded";
  total: number;
  recalls: RecallCampaign[];
  asOf?: string;
  links?: Record<string, string>;
}

// get recalls for a VIN via Cardog 
export async function getVinRecalls(vin: string): Promise<VinRecalls> {
  const res = await fetch(`${CARDOG_BASE}/vin/${encodeURIComponent(vin)}/recalls`, {
    headers: cardogHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Cardog recall lookup failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export type SpecValue = string | number | boolean | string[];

export interface SpecAttributeValue {
  value: SpecValue;
  unit?: string;
  source: "decode" | "catalogue";
  region?: "US" | "CA" | "EU";
  disagreement?: {
    source: "decode" | "catalogue";
    values: SpecValue[];
    unit?: string;
  };
}

export interface SpecPartialEntry {
  id: string;
  statedBy: number;
  of: number;
}

export type SpecUnservableReason =
  | "not-a-number"
  | "not-an-integer"
  | "not-an-availability"
  | "not-in-enum"
  | "wrong-domain"
  | "not-an-array"
  | "object-value"
  | "zero-blank"
  | "non-string-item";

export interface SpecUnservableEntry {
  id: string;
  reason: SpecUnservableReason;
}

export interface SpecFeatureEntry {
  value: string;
  trims: "all" | string[];
}

export interface SpecTrim {
  id: string;
  trim?: string | null;
  styleName?: string | null;
  region?: "US" | "CA" | "EU" | null;
  year?: number | null;
  msrp?: number | null;
  currency?: "USD" | "CAD" | "EUR" | null;
}

export interface SpecSheet {
  ref: string;
  grain: "model-year" | "trim";
  trim?: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  specVersion: number;
  sections: Record<string, Record<string, SpecAttributeValue>>;
  trimDependent: string[];
  partial: SpecPartialEntry[];
  trims: SpecTrim[];
  unmapped: {
    features: SpecFeatureEntry[];
    attributes: string[];
    unservable: SpecUnservableEntry[];
  };
  links?: Record<string, string>;
}

// get a spec sheet by model-year ref via Cardog
export async function getSpecsByModelYear(modelYearRef: string): Promise<SpecSheet> {
  const res = await fetch(
    `${CARDOG_BASE}/specs/${encodeURIComponent(modelYearRef)}`,
    { headers: cardogHeaders() }
  );
  if (!res.ok) {
    throw new Error(`Cardog specs lookup failed: ${res.status}`);
  }
  return res.json();
}

export type SpecAttributeResult =
  | { status: "value"; value: SpecValue; source: "decode" | "catalogue" }
  | { status: "trimDependent" }
  | { status: "partial"; statedBy: number; of: number }
  | { status: "unservable"; reason: SpecUnservableReason }
  | { status: "absent" };


// read a spec attribute from a spec sheet, returning a typed result. This is
// a defensive helper for eligibility.ts, which needs to know why a spec
// attribute is missing (trimDependent, partial, unservable, or absent).
export function readSpecAttribute(
  sheet: SpecSheet,
  attributeId: string
): SpecAttributeResult {
  if (sheet.trimDependent.includes(attributeId)) {
    return { status: "trimDependent" };
  }

  const partialEntry = sheet.partial.find((p) => p.id === attributeId);
  if (partialEntry) {
    return { status: "partial", statedBy: partialEntry.statedBy, of: partialEntry.of };
  }

  const unservableEntry = sheet.unmapped.unservable.find((u) => u.id === attributeId);
  if (unservableEntry) {
    return { status: "unservable", reason: unservableEntry.reason };
  }

  for (const section of Object.values(sheet.sections)) {
    if (attributeId in section) {
      const attr = section[attributeId];
      return { status: "value", value: attr.value, source: attr.source };
    }
  }

  return { status: "absent" };
}

// ---------------------------------------------------------------------------
// vPIC fallback (NHTSA, public, no key required)
// ---------------------------------------------------------------------------

export interface VpicFallbackResult {
  year: number | null;
  make: string | null;
  model: string | null;
  vehicleType: string | null; // e.g. "PASSENGER CAR", "TRUCK", "MULTIPURPOSE PASSENGER VEHICLE (MPV)"
  doors: number | null;
  seats: number | null;
  errorCode: string | null;
  errorText: string | null;
}

// fall back to vPIC when Cardog's decode fails or has missing fields
// modelYear is optional but recommended when known, to help vPIC pick the right VIN pattern era
export async function getVpicFallback(
  vin: string,
  modelYear?: number
): Promise<VpicFallbackResult | null> {
  const url = new URL(`${VPIC_BASE}/DecodeVinValues/${encodeURIComponent(vin)}`);
  url.searchParams.set("format", "json");
  if (modelYear) {
    url.searchParams.set("modelyear", String(modelYear));
  }

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const data = await res.json();
  const result = data?.Results?.[0];
  if (!result) return null;

  return {
    year: result.ModelYear ? Number(result.ModelYear) : null,
    make: result.Make || null,
    model: result.Model || null,
    vehicleType: result.VehicleType || null,
    doors: result.Doors ? Number(result.Doors) : null,
    seats: result.Seats ? Number(result.Seats) : null,
    errorCode: result.ErrorCode || null,
    errorText: result.ErrorText || null,
  };
}
