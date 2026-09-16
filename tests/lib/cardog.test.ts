// lib/cardog.test.ts
//
// readSpecAttribute() is the one piece of cardog.ts with real branching
// logic worth testing directly — everything else in that file is thin
// fetch wrappers, which aren't worth unit-testing (there's nothing to
// assert without hitting the network). This function decides between five
// states, and getting that branching wrong once already caused the
// unservable/absent-collapse bug fixed earlier in this build.

import { describe, it, expect } from "vitest";
import { readSpecAttribute, type SpecSheet } from "@/lib/cardog";

function sheetWith(overrides: Partial<SpecSheet>): SpecSheet {
  return {
    ref: "model-year:test/car/2024",
    grain: "model-year",
    trim: null,
    year: 2024,
    make: "Test",
    model: "Car",
    specVersion: 2,
    sections: {},
    trimDependent: [],
    partial: [],
    trims: [],
    unmapped: { features: [], attributes: [], unservable: [] },
    links: {},
    ...overrides,
  };
}

describe("readSpecAttribute", () => {
  it("returns 'value' when the attribute is in sections", () => {
    const sheet = sheetWith({ sections: { identity: { doors: { value: 4, source: "decode" } } } });
    const result = readSpecAttribute(sheet, "doors");
    expect(result).toEqual({ status: "value", value: 4, source: "decode" });
  });

  it("returns 'trimDependent' when the id is in the trimDependent array", () => {
    const sheet = sheetWith({ trimDependent: ["driveType"] });
    expect(readSpecAttribute(sheet, "driveType")).toEqual({ status: "trimDependent" });
  });

  it("returns 'partial' with statedBy/of when the id is in the partial array", () => {
    const sheet = sheetWith({ partial: [{ id: "seatingCapacity", statedBy: 3, of: 6 }] });
    expect(readSpecAttribute(sheet, "seatingCapacity")).toEqual({ status: "partial", statedBy: 3, of: 6 });
  });

  it("returns 'unservable' with the specific reason when the id is in unmapped.unservable", () => {
    const sheet = sheetWith({ unmapped: { features: [], attributes: [], unservable: [{ id: "range", reason: "zero-blank" }] } });
    expect(readSpecAttribute(sheet, "range")).toEqual({ status: "unservable", reason: "zero-blank" });
  });

  it("returns 'absent' when the id appears nowhere at all", () => {
    const sheet = sheetWith({});
    expect(readSpecAttribute(sheet, "doors")).toEqual({ status: "absent" });
  });

  it("checks trimDependent before partial and unservable — priority ordering", () => {
    // An id shouldn't realistically land in two buckets per the API's own
    // documented exclusivity, but the lookup order is a defensive choice
    // (see eligibility.ts discussion) and worth pinning down explicitly.
    const sheet = sheetWith({
      trimDependent: ["seatingCapacity"],
      partial: [{ id: "seatingCapacity", statedBy: 3, of: 6 }],
    });
    expect(readSpecAttribute(sheet, "seatingCapacity")).toEqual({ status: "trimDependent" });
  });

  it("distinguishes unservable from absent — the bug fixed earlier in this build", () => {
    const unservableSheet = sheetWith({
      unmapped: { features: [], attributes: [], unservable: [{ id: "doors", reason: "not-an-integer" }] },
    });
    const absentSheet = sheetWith({});
    const unservableResult = readSpecAttribute(unservableSheet, "doors");
    const absentResult = readSpecAttribute(absentSheet, "doors");
    expect(unservableResult.status).toBe("unservable");
    expect(absentResult.status).toBe("absent");
    expect(unservableResult).not.toEqual(absentResult);
  });
});
