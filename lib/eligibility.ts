export type VehicleFacts = {
  year: number | null;
  vehicleType: string | null;
  seatingCapacity: number | "trimDependent" | "partial" | null;
  doors: number | "trimDependent" | "partial" | null;
  recallStatus: "resolved" | "unresolved";
  mileage: number | null; // driver-reported
  source: "cardog" | "vpic-fallback" | "mixed";
};

export type Verdict = { status: "eligible" | "not-eligible" | "cannot-say"; reasons: string[] };

export function evaluateEligibility(facts: VehicleFacts): Verdict { /* ... */ }