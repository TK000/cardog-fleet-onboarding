// lib/eligibility.test.ts
//
// evaluateEligibility() is a pure function — VehicleFacts in, Verdict out —
// so every test here builds a Facts object by hand. No mocking, no network,
// no Cardog/vPIC types involved. This is exactly why the file was split
// from facts.ts in the first place: to make this possible.

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
    recalls: { checked: true, openCampaigns: [], excludedInconsequentialCount: 0 },
    mileage: 30_000,
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
    const verdict = evaluateEligibility(cleanFacts({ year: { status: "unknown", reason: "not-decoded" } }));
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
    expect(verdict.reasons.some((r) => /seats 2/i.test(r))).toBe(true);
  });

  it("gives a specific message for trimDependent, distinct from absent", () => {
    const trimDependent = evaluateEligibility(
      cleanFacts({ seatingCapacity: { status: "unknown", reason: "trimDependent" } })
    );
    const absent = evaluateEligibility(
      cleanFacts({ seatingCapacity: { status: "unknown", reason: "absent" } })
    );
    expect(trimDependent.status).toBe("cannot-say");
    expect(absent.status).toBe("cannot-say");
    // The whole point of the five-state model: these must not collapse
    // into identical copy.
    expect(trimDependent.reasons[0]).not.toBe(absent.reasons[0]);
  });

  it("surfaces the specific unservable reason in the message when present", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ seatingCapacity: { status: "unknown", reason: "unservable", detail: "not-an-integer" } })
    );
    expect(verdict.reasons[0]).toMatch(/not-an-integer/);
  });
});

describe("evaluateEligibility — recalls", () => {
  it("produces cannot-say when recall status could not be checked", () => {
    const verdict = evaluateEligibility(
      cleanFacts({ recalls: { checked: false, openCampaigns: [], excludedInconsequentialCount: 0 } })
    );
    expect(verdict.status).toBe("cannot-say");
  });

  it("disqualifies on a single open campaign", () => {
    const verdict = evaluateEligibility(
      cleanFacts({
        recalls: {
          checked: true,
          openCampaigns: [{ campaignNumber: "26V436000", authorityLabel: "NHTSA", component: "LABEL", correctiveAction: "Replace label." }],
          excludedInconsequentialCount: 0,
        },
      })
    );
    expect(verdict.status).toBe("not-eligible");
  });

  it("includes the 'provide proof of repair' instruction when the recall is the sole disqualifier", () => {
    const verdict = evaluateEligibility(
      cleanFacts({
        recalls: {
          checked: true,
          openCampaigns: [{ campaignNumber: "26V436000", authorityLabel: "NHTSA", component: null, correctiveAction: null }],
          excludedInconsequentialCount: 0,
        },
      })
    );
    expect(verdict.reasons.some((r) => /provide proof/i.test(r))).toBe(true);
  });

  it("omits the 'provide proof of repair' instruction when another disqualifier already exists", () => {
    // Regression test for the truck + recalls bug: telling a driver to
    // chase down a service record is misleading when the vehicle is
    // already disqualified for an unrelated, unfixable reason.
    const verdict = evaluateEligibility(
      cleanFacts({
        vehicleType: { status: "known", value: "truck", source: "cardog" },
        recalls: {
          checked: true,
          openCampaigns: [{ campaignNumber: "26V436000", authorityLabel: "NHTSA", component: null, correctiveAction: null }],
          excludedInconsequentialCount: 0,
        },
      })
    );
    expect(verdict.status).toBe("not-eligible");
    expect(verdict.reasons.some((r) => /provide proof/i.test(r))).toBe(false);
    // The recall should still be mentioned as a fact, just without the CTA.
    expect(verdict.reasons.some((r) => /open safety recall/i.test(r))).toBe(true);
  });

  it("does not disqualify on an Inconsequential-only recall set", () => {
    // buildVehicleFacts is responsible for filtering Inconsequential
    // campaigns out of openCampaigns before evaluateEligibility ever sees
    // them — this test documents that evaluateEligibility trusts that
    // filtering rather than re-implementing it.
    const verdict = evaluateEligibility(
      cleanFacts({ recalls: { checked: true, openCampaigns: [], excludedInconsequentialCount: 1 } })
    );
    expect(verdict.status).toBe("eligible");
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
    // Deliberate design choice (see comment in eligibility.ts): if the
    // vehicle is definitely too old, say so — even if we also couldn't
    // verify something else.
    const verdict = evaluateEligibility(
      cleanFacts({
        year: { status: "known", value: new Date().getFullYear() - 20, source: "cardog" },
        seatingCapacity: { status: "unknown", reason: "absent" },
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
