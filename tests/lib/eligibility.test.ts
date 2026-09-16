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
      cleanFacts({ recalls: { checked: false, openCampaigns: [], asOf: null } })
    );
    expect(verdict.status).toBe("cannot-say");
  });

  it("produces cannot-say (not not-eligible) on a single open campaign", () => {
    // Deliberate: Cardog can confirm a campaign exists for this model
    // year, not whether THIS unit was repaired. That's genuine ambiguity,
    // not a verified disqualification — the brief's own framing of the
    // mandated recall question.
    const verdict = evaluateEligibility(
      cleanFacts({
        recalls: {
          checked: true,
          openCampaigns: [{ campaignNumber: "26V436000", authorityLabel: "NHTSA", component: "LABEL", correctiveAction: "Replace label." }],
          asOf: "2026-01-01T00:00:00Z",
        },
      })
    );
    expect(verdict.status).toBe("cannot-say");
  });

  it("includes the 'provide proof of repair' instruction when nothing else would block eligibility", () => {
    const verdict = evaluateEligibility(
      cleanFacts({
        recalls: {
          checked: true,
          openCampaigns: [{ campaignNumber: "26V436000", authorityLabel: "NHTSA", component: null, correctiveAction: null }],
          asOf: "2026-01-01T00:00:00Z",
        },
      })
    );
    expect(verdict.reasons.some((r) => /provide proof/i.test(r))).toBe(true);
  });

  it("keeps reasons focused on the actual disqualifier when recalls didn't cause the verdict", () => {
    // Recalls are NOT a disqualifier on their own (see the cannot-say test
    // above). When something else (wrong vehicle type) already makes the
    // verdict not-eligible, the recall note shouldn't appear in `reasons`
    // either — it wasn't part of why this verdict happened, and including
    // it risks implying it was a contributing factor. Full recall detail
    // is still always shown in the facts panel (VerdictResult), just not
    // duplicated into this list.
    const verdict = evaluateEligibility(
      cleanFacts({
        vehicleType: { status: "known", value: "truck", source: "cardog" },
        recalls: {
          checked: true,
          openCampaigns: [{ campaignNumber: "26V436000", authorityLabel: "NHTSA", component: null, correctiveAction: null }],
          asOf: "2026-01-01T00:00:00Z",
        },
      })
    );
    expect(verdict.status).toBe("not-eligible");
    expect(verdict.reasons.some((r) => /provide proof/i.test(r))).toBe(false);
    expect(verdict.reasons.some((r) => /open safety recall/i.test(r))).toBe(false);
    expect(verdict.reasons.some((r) => /truck/i.test(r))).toBe(true);
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
