// lib/facts.test.ts

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

  it("falls back to vPIC when Cardog's refs.vehicleType is null", () => {
    const facts = buildVehicleFacts({
      vin: "TESTVIN0000000001",
      identity: baseIdentity(),
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
  it("uses vPIC's seat count when Cardog's spec status is 'partial'", () => {
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
      specs: sheet,
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.seatingCapacity).toEqual({ status: "known", value: 5, source: "vpic-fallback" });
  });

  it("still reports unknown honestly when vPIC has no seat data to offer either", () => {
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
      specs: sheet,
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.seatingCapacity).toEqual({ status: "unknown" });
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
      specs: sheet,
      recalls: baseRecalls(),
      mileage: null,
      checkedAt: "2026-01-01T00:00:00Z",
    });
    expect(facts.seatingCapacity).toEqual({ status: "known", value: 7, source: "cardog" });
  });
});

describe("buildVehicleFacts — recalls", () => {
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
