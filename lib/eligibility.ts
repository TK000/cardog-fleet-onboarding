// lib/eligibility.ts
//
// The eligilibity engine: this is where the business logic lives.
// It takes a VehicleFacts object generated in facts.ts and returns a
// Verdict object

import type { VehicleFacts } from "./facts";

// Constants for the eligibility rules
const MAX_VEHICLE_AGE_YEARS = 12;
const MIN_SEATING_CAPACITY = 4;
const MAX_MILEAGE = 150_000;
const ALLOWED_VEHICLE_TYPES = new Set(["passenger-car", "mpv"]);

export type VerdictStatus = "eligible" | "not-eligible" | "cannot-say";

export interface Verdict {
  status: VerdictStatus;
  reasons: string[];
}

export function evaluateEligibility(facts: VehicleFacts): Verdict {
  if (!facts.decoded) {
    return {
      status: "cannot-say",
      reasons: ["We couldn't identify this vehicle from the VIN provided (checked with both Cardog and NHTSA)."],
    };
  }

  const disqualifiers: string[] = [];
  const unknowns: string[] = [];

  // --- year ---
  if (facts.year.status === "known") {
    const age = new Date().getFullYear() - facts.year.value;
    if (age > MAX_VEHICLE_AGE_YEARS) {
      disqualifiers.push(
        `Vehicle is ${age} years old; we accept vehicles up to ${MAX_VEHICLE_AGE_YEARS} years old.`
      );
    }
  } else {
    unknowns.push("We couldn't confirm the model year. This will need manual review before onboarding can proceed.");
  }

  // --- vehicleType ---
  if (facts.vehicleType.status === "known") {
    if (!ALLOWED_VEHICLE_TYPES.has(facts.vehicleType.value)) {
      disqualifiers.push(`Vehicle type (${facts.vehicleType.value}) isn't eligible for this fleet.`);
    }
  } else {
    unknowns.push("We couldn't confirm the vehicle type. This will need manual review before onboarding can proceed.");
  }

  // --- seatingCapacity ---
  if (facts.seatingCapacity.status === "known") {
    if (facts.seatingCapacity.value < MIN_SEATING_CAPACITY) {
      disqualifiers.push(
        `Vehicle has ${facts.seatingCapacity.value} seats; we require at least ${MIN_SEATING_CAPACITY}.`
      );
    }
  } else {
    unknowns.push("We couldn't confirm this vehicle's seating capacity. This will need manual review before onboarding can proceed.");
  }

  // --- mileage (driver-reported, unverified) ---
  if (facts.mileage == null) {
    unknowns.push("Mileage wasn't provided. Please provide the current odometer reading for this vehicle.");
  } else if (facts.mileage > MAX_MILEAGE) {
    disqualifiers.push(
      `Reported mileage (${facts.mileage.toLocaleString()}) exceeds our ${MAX_MILEAGE.toLocaleString()}-mile limit.`
    );
  }

  // --- recalls ---
  // Recalls are a special case: they are never a disqualifier,
  // only a "cannot say" reason, since we cannot confirm whether
  // a specific vehicle has been repaired.
  if (!facts.recalls.checked) {
    unknowns.push("We couldn't check this vehicle's recall status.");
  } else if (facts.recalls.openCampaigns.length > 0) {
    const count = facts.recalls.openCampaigns.length;
    const base = `${count} open safety recall${count > 1 ? "s" : ""} on file, with no way to confirm the repair was completed on this specific vehicle — see recall details below.`;
    unknowns.push(
      disqualifiers.length === 0
        ? `${base} Please provide proof of completed repair (dealer service record) to proceed.`
        : base
    );
  }

  if (disqualifiers.length > 0) {
    return { status: "not-eligible", reasons: disqualifiers };
  }
  if (unknowns.length > 0) {
    return { status: "cannot-say", reasons: unknowns };
  }
  return { status: "eligible", reasons: ["All checks passed."] };
}
