// lib/facts.test.ts
//
// buildVehicleFacts() does touch Cardog/vPIC types, but it's still a pure
// function — raw API-shaped objects in, VehicleFacts out — so these are
// still hand-built fixtures, not network mocks. Focused on the merge
// logic specifically, since that's where the real bugs in this build
// actually showed up (vehicleType always vpic-sourced, seatingCapacity
// discarding a fetched vpic value on "partial").

import { describe, it, expect } from "vitest";
import { buildVehicleFacts } from "@/lib/facts";
import type { VinIdentity, VinRecalls, SpecSheet, VpicFallbackResult } from "@/lib/cardog";

function baseIdentity(overrides: Partial<VinIdentity> = {}): VinIdentity {
  return {
    vin: "TESTVIN0000000001",
    valid: true,
    year: 2024,
    make: "Test",
    model: "Car",
    trim: null,
    refs: {
      make: "make:test",
      model: "model:test/car",
      modelYear: "model-year:test/car/2024",
      bodyStyle: null,
      fuelType: null,
      driveType: null,
      transmission: null,
      electrificationLevel: null,
      vehicleType: null,
      gvwr: null,
      country: null,
    },
    nano: "nano:TESTXX",
    squish: "squish:TESTX",
    links: {},
    ...overrides,
  };
}

function baseRecalls(overrides: Partial<VinRecalls> = {}): VinRecalls {
  return {
    vin: "TESTVIN0000000001",
    modelYearRef: "model-year:test/car/2024",
    resolved: true,
    source: "decoded",
    total: 0,
    recalls: [],
    asOf: "2026-01-01T00:00:00Z",
    links: {},
    ...overrides,
  };
}

const cleanVpic: VpicFallbackResult = {
  year: 2024,
  make: "Test",
  model: "Car",
  vehicleType: "PASSENGER CAR",
  doors: 4,
  seats: 5,
  errorCode: null,
  errorText: null,
};

describe("buildVehicleFacts — vehicleType", () => {
  it("uses Cardog's refs.vehicleType when Cardog actually populates it", () => {
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity({ refs: { ...baseIdentity().refs, vehicleType: "vehicle-type:passenger-car" } }),
      vpic: null,
      specs: null,
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.vehicleType).toEqual({ status: "known", value: "passenger-car", source: "cardog" });
  });

  it("falls back to vPIC when Cardog's refs.vehicleType is null — the common real-world case", () => {
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity(), // refs.vehicleType: null, matching every real response seen in testing
      vpic: cleanVpic,
      specs: null,
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.vehicleType).toEqual({ status: "known", value: "passenger-car", source: "vpic-fallback" });
  });
});

describe("buildVehicleFacts — seatingCapacity (regression coverage)", () => {
  it("uses vPIC's seat count when Cardog's spec status is 'partial', not just 'absent'", () => {
    // This is the exact bug found and fixed: the merge used to only try
    // vPIC on "absent", silently discarding a perfectly good, already-
    // fetched vPIC seat count whenever Cardog said "partial" instead —
    // which is the MORE common status across every real spec sheet tested.
    const sheet: SpecSheet = {
      ref: "model-year:test/car/2024",
      grain: "model-year",
      trim: null,
      year: 2024,
      make: "Test",
      model: "Car",
      specVersion: 2,
      sections: {},
      trimDependent: [],
      partial: [{ id: "seatingCapacity", statedBy: 3, of: 6 }],
      trims: [],
      unmapped: { features: [], attributes: [], unservable: [] },
      links: {},
    };
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity(),
      vpic: cleanVpic,
      specs: { sheet, grain: "model-year" },
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.seatingCapacity).toEqual({ status: "known", value: 5, source: "vpic-fallback" });
  });

  it("still reports 'partial' honestly when vPIC has no seat data to offer either", () => {
    const sheet: SpecSheet = {
      ref: "model-year:test/car/2024",
      grain: "model-year",
      trim: null,
      year: 2024,
      make: "Test",
      model: "Car",
      specVersion: 2,
      sections: {},
      trimDependent: [],
      partial: [{ id: "seatingCapacity", statedBy: 3, of: 6 }],
      trims: [],
      unmapped: { features: [], attributes: [], unservable: [] },
      links: {},
    };
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity(),
      vpic: { ...cleanVpic, seats: null },
      specs: { sheet, grain: "model-year" },
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.seatingCapacity).toEqual({ status: "unknown", reason: "partial" });
  });

  it("prefers Cardog's own clean value over vPIC when Cardog actually has one", () => {
    const sheet: SpecSheet = {
      ref: "model-year:test/car/2024",
      grain: "model-year",
      trim: null,
      year: 2024,
      make: "Test",
      model: "Car",
      specVersion: 2,
      sections: { identity: { seatingCapacity: { value: 7, source: "catalogue" } } },
      trimDependent: [],
      partial: [],
      trims: [],
      unmapped: { features: [], attributes: [], unservable: [] },
      links: {},
    };
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity(),
      vpic: cleanVpic, // has seats: 5 — should be ignored in favor of Cardog's 7
      specs: { sheet, grain: "model-year" },
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.seatingCapacity).toEqual({ status: "known", value: 7, source: "cardog" });
  });
});

describe("buildVehicleFacts — recalls", () => {
  it("filters Inconsequential campaigns out of openCampaigns but keeps a count", () => {
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity(),
      vpic: null,
      specs: null,
      recalls: baseRecalls({
        total: 2,
        recalls: [
          {
            ref: "recall:nhtsa/1",
            authority: "nhtsa",
            authorityLabel: "NHTSA",
            campaignNumber: "26V001000",
            component: "BRAKES",
            defectSummary: null,
            consequenceSummary: null,
            correctiveAction: null,
            recallDate: null,
            notificationType: null,
            unitsAffected: null,
            affects: [],
          },
          {
            ref: "recall:tc/2",
            authority: "tc",
            authorityLabel: "Transport Canada",
            campaignNumber: "2026001",
            component: "Label",
            defectSummary: null,
            consequenceSummary: null,
            correctiveAction: null,
            recallDate: null,
            notificationType: "Inconsequential",
            unitsAffected: null,
            affects: [],
          },
        ],
      }),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.recalls.openCampaigns).toHaveLength(1);
    expect(facts.recalls.openCampaigns[0].campaignNumber).toBe("26V001000");
    expect(facts.recalls.excludedInconsequentialCount).toBe(1);
  });

  it("reports checked: false when Cardog couldn't resolve a model year, not a false clean", () => {
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity({ valid: false, year: null, refs: { ...baseIdentity().refs, modelYear: null } }),
      vpic: null,
      specs: null,
      recalls: baseRecalls({ resolved: false, modelYearRef: null, source: undefined }),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.recalls.checked).toBe(false);
  });
});

describe("buildVehicleFacts — decoded", () => {
  it("is true when Cardog decodes even with no vPIC data", () => {
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity(),
      vpic: null,
      specs: null,
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.decoded).toBe(true);
  });

  it("is false when neither Cardog nor vPIC identify the vehicle", () => {
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity({ valid: false, year: null, make: null, model: null }),
      vpic: null,
      specs: null,
      recalls: baseRecalls({ resolved: false, modelYearRef: null }),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.decoded).toBe(false);
  });
});
