// lib/eligibility.test.ts

import { describe, it, expect } from "vitest";
import { evaluateEligibility } from "@/lib/eligibility";
import type { VehicleFacts } from "@/lib/facts";

// A fully-clean baseline. Individual tests override just the field(s)
// they're exercising, so each test's intent is visible at a glance.
function cleanFacts(overrides: Partial<VehicleFacts> = {}): VehicleFacts {
  return {
    vin: "TESTVIN0000000001",
    decoded: true,
    year: { status: "known", value: new Date().getFullYear(), source: "cardog" },
    vehicleType: { status: "known", value: "passenger-car", source: "cardog" },
    seatingCapacity: { status: "known", value: 5, source: "cardog" },
    recalls: { checked: true, openCampaigns: [], asOf: "2026-01-01T00:00:00Z" },
    mileage: 30_000,
    checkedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("evaluateEligibility — undecodable VIN", () => {
  it("returns cannot-say when neither Cardog nor vPIC identified the vehicle", () => {
    const verdict = evaluateEligibility(cleanFacts({ decoded: false }));
    expect(verdict.status).toBe("cannot-say");
    expect(verdict.reasons[0]).toMatch(/couldn't identify/i);
  });
});

describe("evaluateEligibility — happy path", () => {
  it("returns eligible when every check passes cleanly", () => {
    const verdict = evaluateEligibility(cleanFacts());
    expect(verdict.status).toBe("eligible");
  });
});

describe("evaluateEligibility — year", () => {
  it("disqualifies a vehicle older than the age limit", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ year: { status: "known", value: new Date().getFullYear() - 20, source: "cardog" } })
    );
    expect(verdict.status).toBe("not-eligible");
    expect(verdict.reasons.some((r) => /years old/.test(r))).toBe(true);
  });

  it("accepts a vehicle exactly at the age limit", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ year: { status: "known", value: new Date().getFullYear() - 12, source: "cardog" } })
    );
    expect(verdict.status).toBe("eligible");
  });

  it("produces cannot-say (not a silent pass) when year is unknown", () => {
    const verdict = evaluateEligibility(cleanFacts({ year: { status: "unknown" } }));
    expect(verdict.status).toBe("cannot-say");
  });
});

describe("evaluateEligibility — vehicleType", () => {
  it("disqualifies a truck", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ vehicleType: { status: "known", value: "truck", source: "cardog" } })
    );
    expect(verdict.status).toBe("not-eligible");
    expect(verdict.reasons.some((r) => /truck/.test(r))).toBe(true);
  });

  it("accepts a multipurpose passenger vehicle (mpv)", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ vehicleType: { status: "known", value: "mpv", source: "cardog" } })
    );
    expect(verdict.status).toBe("eligible");
  });
});

describe("evaluateEligibility — seatingCapacity", () => {
  it("disqualifies a vehicle with too few seats", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ seatingCapacity: { status: "known", value: 2, source: "vpic-fallback" } })
    );
    expect(verdict.status).toBe("not-eligible");
    expect(verdict.reasons.some((r) => /2 seats/i.test(r))).toBe(true);
  });

  it("produces cannot-say when seating capacity is unknown", () => {
    const verdict = evaluateEligibility(cleanFacts({ seatingCapacity: { status: "unknown" } }));
    expect(verdict.status).toBe("cannot-say");
    expect(verdict.reasons.some((r) => /seating capacity/i.test(r))).toBe(true);
  });
});

describe("evaluateEligibility — recalls", () => {
  it("produces cannot-say when recall status could not be checked", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ recalls: { checked: false, openCampaigns: [], asOf: null } })
    );
    expect(verdict.status).toBe("cannot-say");
  });

  it("produces cannot-say (not not-eligible) on a single open campaign", () => {
    const verdict = evaluateEligibility(
      cleanFacts({
        recalls: {
          checked: true,
          openCampaigns: [{ campaignNumber: "26V436000", authorityLabel: "NHTSA", component: "LABEL", correctiveAction: "Replace label.", recallDate: "2026-07-07" }],
          asOf: "2026-01-01T00:00:00Z",
        },
      })
    );
    expect(verdict.status).toBe("cannot-say");
  });
});

describe("evaluateEligibility — mileage", () => {
  it("produces cannot-say when mileage wasn't provided", () => {
    const verdict = evaluateEligibility(cleanFacts({ mileage: null }));
    expect(verdict.status).toBe("cannot-say");
  });

  it("disqualifies mileage over the limit", () => {
    const verdict = evaluateEligibility(cleanFacts({ mileage: 200_000 }));
    expect(verdict.status).toBe("not-eligible");
  });

  it("accepts mileage exactly at the limit", () => {
    const verdict = evaluateEligibility(cleanFacts({ mileage: 150_000 }));
    expect(verdict.status).toBe("eligible");
  });
});

describe("evaluateEligibility — precedence", () => {
  it("a known disqualifier wins over an unrelated unknown", () => {
    const verdict = evaluateEligibility(
      cleanFacts({
        year: { status: "known", value: new Date().getFullYear() - 20, source: "cardog" },
        seatingCapacity: { status: "unknown" },
      })
    );
    expect(verdict.status).toBe("not-eligible");
  });

  it("cannot-say only when there are unknowns and zero disqualifiers", () => {
    const verdict = evaluateEligibility(cleanFacts({ mileage: null }));
    expect(verdict.status).toBe("cannot-say");
    expect(verdict.reasons.every((r) => !/isn't eligible|exceeds|years old|open safety recall/.test(r))).toBe(true);
  });
});
