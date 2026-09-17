// lib/cardog.test.ts
//
// Test readSpecAttribute() 
// All other functions in cardog.ts are thin fetch wrappers, which aren't
// worth unit-testing (there's nothing to assert without hitting the network).

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
});
