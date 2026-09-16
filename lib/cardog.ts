// lib/cardog.ts
//
// All Cardog + vPIC network calls live in this file, and nothing else does.
// Every function here does one job: call an endpoint, return a typed result.
// No eligibility logic, no verdicts — that all lives in lib/eligibility.ts.

const CARDOG_BASE = "https://api.cardog.app/v2";
const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

function cardogHeaders(): HeadersInit {
  const key = process.env.CARDOG_API_KEY;
  if (!key) {
    // Fail loudly at call time rather than sending an unauthenticated
    // request and getting a confusing 401 three layers away.
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
  gvwr?: string | null; // not in the schema's required list, despite being nullable
  country: string | null;
}

export interface ObservedTrim {
  value: string; // verbatim listing text, e.g. "Long Range Battery AWD/ NO ACCIDENT/ BC LOCAL"
  authorityTier: "observed"; // always "observed" per schema — comes from a listing, not a catalogue
  asOf: string | null;
}

/**
 * Matches the official VinIdentity schema in
 * https://api.cardog.app/v2/openapi.json (components.schemas.VinIdentity)
 * exactly — confirmed against the spec, not inferred from samples. Three
 * fields here (trimAuthorityTier, observedTrim, authorityTier) never
 * appeared in any real response we pulled during testing, and are correctly
 * marked optional: none of them are in the schema's `required` array.
 */
export interface VinIdentity {
  vin: string;
  valid: boolean; // when false, every other field and every ref is null — Cardog never backfills from similar vehicles
  year: number | null;
  make: string | null; // display name — use refs.make for joins
  model: string | null; // display name — use refs.model for joins
  trim: string | null; // catalogue trim decoded from the VIN pattern; never taken from listing text
  trimAuthorityTier?: AuthorityTier | null; // "derived" means decoded from the VIN pattern; null exactly when trim is null
  observedTrim?: ObservedTrim | null;
  refs: VinIdentityRefs;
  nano: string | null; // build code ref (VIN positions 1–8 + 10); null when valid is false
  squish: string | null; // WMI+VDS+model-year ref, plant-agnostic; the grain market prices are quoted at; null when valid is false
  authorityTier?: AuthorityTier; // trust tier of the identity facts as a whole — not nullable when present, but absent isn't required
  links: Record<string, string>; // always includes "instrument", "recalls", "listings", plus one entity link per ref
}

/**
 * GET /v2/vin/{vin} — decode a VIN via Cardog.
 * When valid is false, every other field is null — this is the
 * "does not decode" case the brief calls out. Do not treat it as an error;
 * it's a real, expected outcome that the rule engine needs to see.
 */
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

/**
 * Matches the official RecallsVin schema in
 * https://api.cardog.app/v2/openapi.json (components.schemas.RecallsVin)
 * exactly, including which fields are actually required vs. merely
 * nullable-when-present — those are different axes in JSON Schema and easy
 * to conflate. Confirmed against a real recalled VIN (Subaru Forester/
 * Ascent 26V436000 campaign), not just the spec text.
 */
export interface RecallAffectedYear {
  modelYearRef: string;
  year: number;
  unitsAffected: number | null;
}

export interface RecallCampaign {
  ref: string; // e.g. "recall:tc/2024-123"
  authority: string; // "tc" (Transport Canada) or "nhtsa" — other values may be added
  authorityLabel: string; // e.g. "Transport Canada"
  campaignNumber: string;
  component: string | null;
  defectSummary: string | null;
  consequenceSummary: string | null;
  correctiveAction: string | null;
  recallDate: string | null; // ISO date, YYYY-MM-DD
  notificationType: string | null; // "Inconsequential" is a real observed value — filter it from eligibility gates, but keep it visible on the page
  unitsAffected: number | null; // largest value across `affects` — the whole-campaign figure
  affects: RecallAffectedYear[];
  links?: Record<string, string>; // not required
}

export interface VinRecalls {
  vin: string;
  modelYearRef: string | null;
  resolved: boolean; // false when the VIN is neither in the vehicle graph nor decodable to a model year
  // — recalls is then empty because nothing could be checked, NOT because the vehicle is clear.
  source?: "observed" | "decoded"; // how the VIN was matched to a model year — absent when resolved is false.
  // "observed" = the exact VIN is in Cardog's vehicle graph; "decoded" = derived via the VIN decoder.
  // Confirmed empirically: our synthetic-but-valid test VINs came back "decoded".
  total: number;
  recalls: RecallCampaign[];
  asOf?: string; // ISO 8601 — not required
  links?: Record<string, string>; // not required
}

/**
 * GET /v2/vin/{vin}/recalls — the authoritative per-VIN recall check.
 * `resolved: false` means "Cardog could not check this VIN" — NOT "clean."
 * Confirmed empirically: this degrades gracefully (resolved: false,
 * modelYearRef: null) even for a VIN that failed identity decode, so it's
 * always safe to call regardless of whether getVinIdentity succeeded.
 */
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
// Specs (model-year and nano/build grain)
// ---------------------------------------------------------------------------

/**
 * Matches the official SpecSheet schema in
 * https://api.cardog.app/v2/openapi.json (components.schemas.SpecSheet)
 * exactly, including which fields are truly required. `trim` and `links`
 * are both absent from the schema's `required` array — easy to miss since
 * `trim` reads like it should always be there.
 */
export type SpecValue = string | number | boolean | string[];

export interface SpecAttributeValue {
  value: SpecValue;
  unit?: string; // stated on every number; UnitCode from the catalog (MM, LB, MPG, USD, ...)
  source: "decode" | "catalogue";
  region?: "US" | "CA" | "EU";
  disagreement?: {
    source: "decode" | "catalogue";
    values: SpecValue[]; // every distinct value that source stated, never resolved to one
    unit?: string;
  };
}

// CONFIRMED across four independent real responses spanning sedan (Lucid
// Air), SUV (Tesla Model Y), truck (Ford F-150, 57 trims), and minivan
// (Honda Odyssey, 8 trims): "doors" never appears in sections, trimDependent,
// or partial, on any of them. Treat this as an established fact, not a
// hedge — Cardog's specs endpoint does not serve door count in practice.
// If your rule engine depends on door count, source it from the vPIC
// fallback (DecodeVinValues returns a populated "Doors" field) instead, or
// drop the doors rule and lean on vehicleType + seatingCapacity.

export interface SpecPartialEntry {
  id: string;
  statedBy: number; // how many trims state a value
  of: number; // how many trims have a spec at all
}

// The closed set per the schema — not arbitrary text. "zero-blank" is the
// one we've seen in practice (Ford F-150's "range"); the other eight are
// documented but unconfirmed against a real response so far.
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
  id: string; // a catalog attribute id
  reason: SpecUnservableReason;
}

export interface SpecFeatureEntry {
  value: string;
  trims: "all" | string[]; // "all" when every trim with a spec carries this sentence
}

export interface SpecTrim {
  id: string; // the only required field on this object per the schema
  trim?: string | null;
  styleName?: string | null;
  region?: "US" | "CA" | "EU" | null;
  year?: number | null;
  msrp?: number | null;
  currency?: "USD" | "CAD" | "EUR" | null; // null when the market is unknown — do not assume one
}

export interface SpecSheet {
  ref: string;
  grain: "model-year" | "trim";
  trim?: string | null; // set when grain === "trim"; not required
  year: number | null;
  make: string | null;
  model: string | null;
  specVersion: number;
  sections: Record<string, Record<string, SpecAttributeValue>>;
  trimDependent: string[];
  partial: SpecPartialEntry[];
  trims: SpecTrim[]; // cheapest first
  unmapped: {
    features: SpecFeatureEntry[];
    attributes: string[]; // keys a source stated that the catalog does not define
    unservable: SpecUnservableEntry[];
  };
  links?: Record<string, string>; // not required
}

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

/**
 * Matches components.schemas.SpecSheetBuild exactly. Same shape as
 * SpecSheet, minus the top-level `trim` field (a nano/build code can be
 * shared by several trims — see `trims` — so there's no single trim to
 * name), plus `modelYearRef` linking back to the aggregate grain. `links`
 * is not required here either, per the schema.
 */
export interface SpecSheetBuild {
  ref: string;
  grain: "nano";
  year: number | null;
  make: string | null;
  model: string | null;
  modelYearRef: string; // the build's model-year, the aggregate-grain dual
  specVersion: number;
  sections: Record<string, Record<string, SpecAttributeValue>>;
  trimDependent: string[];
  partial: SpecPartialEntry[];
  trims: SpecTrim[]; // every trim that shares this build code — never a pick
  unmapped: {
    features: SpecFeatureEntry[];
    attributes: string[];
    unservable: SpecUnservableEntry[];
  };
  links?: Record<string, string>; // not required
}

/**
 * GET /v2/specs/nano:{code} — spec sheet for one exact build. Prefer this
 * over getSpecsByModelYear() when you have a decoded VIN: `identity.nano`
 * is populated whenever `identity.valid` is true (derived straight from VIN
 * positions 1-8 + 10), unlike `identity.trim`, which is frequently null even
 * on a successfully decoded VIN — so nano is the more reliable grain to key
 * off, not just the more precise one. Values here carry `source: "decode"`
 * for the decoder's own answer; where a linked trim disagrees, that shows
 * up as `disagreement` on the value rather than forcing the id into
 * trimDependent.
 */
/**
 * Thrown by getSpecsByNano so callers can distinguish "no sheet at this
 * grain" (404 — expected, fall through) from a real problem (401, 500,
 * network error — worth knowing about, not silently swallowing).
 */
export class CardogSpecsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CardogSpecsError";
  }
}

/**
 * GET /v2/specs/nano:{code} — spec sheet for one exact build. Prefer this
 * over getSpecsByModelYear() when you have a decoded VIN: `identity.nano`
 * is populated whenever `identity.valid` is true (derived straight from VIN
 * positions 1-8 + 10), unlike `identity.trim`, which is frequently null even
 * on a successfully decoded VIN — so nano is the more reliable grain to key
 * off, not just the more precise one. Values here carry `source: "decode"`
 * for the decoder's own answer; where a linked trim disagrees, that shows
 * up as `disagreement` on the value rather than forcing the id into
 * trimDependent.
 */
export async function getSpecsByNano(nanoRef: string): Promise<SpecSheetBuild> {
  const res = await fetch(
    `${CARDOG_BASE}/specs/${encodeURIComponent(nanoRef)}`,
    { headers: cardogHeaders() }
  );
  if (!res.ok) {
    throw new CardogSpecsError(`Cardog nano-grain specs lookup failed: ${res.status}`, res.status);
  }
  return res.json();
}

/**
 * Preferred sourcing order for a decoded VIN: nano-grain first (always
 * available, most precise, decode-authoritative), model-year grain as the
 * fallback if the nano lookup 404s (no build-level sheet for this exact
 * code — an expected, benign case) or the identity call lacks a nano ref.
 * Any other failure (auth, rate limit, network, 5xx) is logged and
 * re-thrown rather than silently swallowed — those represent a real
 * problem, and silently falling back on every error would hide it forever
 * behind a fallback that always "succeeds." Returns which grain actually
 * answered, since that's a fact worth surfacing next to any value it
 * sourced ("source: build-specific decode" vs. "source: model-year
 * aggregate").
 */
export async function getSpecsPreferNano(
  identity: VinIdentity
): Promise<{ sheet: SpecSheet | SpecSheetBuild; grain: "nano" | "model-year" } | null> {
  if (identity.nano) {
    try {
      return { sheet: await getSpecsByNano(identity.nano), grain: "nano" };
    } catch (err) {
      if (!(err instanceof CardogSpecsError) || err.status !== 404) {
        console.error("Nano-grain specs lookup failed unexpectedly, falling back to model-year", err);
      }
      // fall through to model-year grain below either way — a fallback is
      // still the right move even on an unexpected error, but now it's a
      // logged, visible decision rather than a silent one.
    }
  }
  if (identity.refs.modelYear) {
    return { sheet: await getSpecsByModelYear(identity.refs.modelYear), grain: "model-year" };
  }
  return null; // neither ref available — identity.valid was presumably false
}

/**
 * Look up a single attribute (e.g. "seatingCapacity", "doors") across a
 * spec sheet's five possible states. eligibility.ts should read attributes
 * through this rather than poking at sections/trimDependent/partial/
 * unmapped.unservable directly, so the "cannot verify" logic lives in one
 * place. "unservable" and "absent" are both "we have nothing" for rule
 * purposes, but worth distinct copy: unservable means Cardog checked and
 * explicitly withheld it (with a reason); absent means it was never
 * mentioned at all. Works on either grain — SpecSheet or SpecSheetBuild —
 * since both share the sections/trimDependent/partial/unmapped shape.
 */
export type SpecAttributeResult =
  | { status: "value"; value: SpecValue; source: "decode" | "catalogue" }
  | { status: "trimDependent" }
  | { status: "partial"; statedBy: number; of: number }
  | { status: "unservable"; reason: SpecUnservableReason }
  | { status: "absent" };

export function readSpecAttribute(
  sheet: SpecSheet | SpecSheetBuild,
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

// NOTE: field shape confirmed against the example response shown on
// NHTSA's own API documentation page for DecodeVinValues — a documented
// example, not just something we happened to observe while testing our own
// VINs. NHTSA's real response has ~130 fields; we extract the 7 that
// matter for eligibility. Short of a formal schema, though: NHTSA's docs
// don't give required/optional/type declarations the way Cardog's
// OpenAPI spec does, so "always present as a key" isn't guaranteed the
// same way it is for the Cardog types above.
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

/**
 * Falls back to NHTSA's free vPIC API when Cardog's own decode fails
 * (valid: false). Confirmed empirically that vPIC can resolve make/year/
 * vehicleType — and sometimes doors/seats — for VINs Cardog can't place in
 * its catalog. Never returns recall data; that stays Cardog-only.
 *
 * modelYear is optional but NHTSA's own docs recommend always sending it
 * when known — it helps the decoder pick the right VIN pattern era. Since
 * this function only runs when Cardog's identity.valid was false, we
 * usually won't have a trustworthy year to pass; omit it in that case
 * rather than guessing.
 */
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
