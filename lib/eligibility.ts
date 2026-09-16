// lib/eligibility.ts
//
// Pure function: VehicleFacts in, Verdict out. No network calls, no
// knowledge of Cardog, vPIC, or HTTP — only the `VehicleFacts` type crosses
// the boundary from facts.ts, and that's a type-only import (erased at
// compile time, zero runtime coupling). This is the piece worth
// unit-testing with hand-built fixtures: construct a VehicleFacts object
// directly, no mocking required.

import type { VehicleFacts, UnknownReason } from "./facts";

const MAX_VEHICLE_AGE_YEARS = 12;
const MIN_SEATING_CAPACITY = 4;
const MAX_MILEAGE = 150_000;
const ALLOWED_VEHICLE_TYPES = new Set(["passenger-car", "mpv"]);

export type VerdictStatus = "eligible" | "not-eligible" | "cannot-say";

export interface Verdict {
  status: VerdictStatus;
  reasons: string[]; // plain language, driver-facing
}

/**
 * Precedence, by design: a known disqualifying fact always wins over an
 * unrelated unknown — if the vehicle is definitely too old, we say so, even
 * if we also couldn't verify the recall status. Only when there are zero
 * known disqualifiers AND zero unknowns does the verdict become "eligible."
 */
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
    unknowns.push("We couldn't confirm the model year.");
  }

  // --- vehicleType ---
  if (facts.vehicleType.status === "known") {
    if (!ALLOWED_VEHICLE_TYPES.has(facts.vehicleType.value)) {
      disqualifiers.push(`Vehicle type (${facts.vehicleType.value}) isn't eligible for this fleet.`);
    }
  } else {
    unknowns.push("We couldn't confirm the vehicle type.");
  }

  // --- seatingCapacity ---
  if (facts.seatingCapacity.status === "known") {
    if (facts.seatingCapacity.value < MIN_SEATING_CAPACITY) {
      disqualifiers.push(
        `Seats ${facts.seatingCapacity.value}; we require at least ${MIN_SEATING_CAPACITY}.`
      );
    }
  } else {
    unknowns.push(describeUnknownSeats(facts.seatingCapacity.reason, facts.seatingCapacity.detail));
  }

  // --- recalls (hard gate: unresolved always produces at least "cannot-say") ---
  if (!facts.recalls.checked) {
    unknowns.push("We couldn't check this vehicle's recall status.");
  } else if (facts.recalls.openCampaigns.length > 0) {
    const names = facts.recalls.openCampaigns.map((c) => c.campaignNumber).join(", ");
    disqualifiers.push(
      `Open safety recall(s) on file (${names}) with no way to confirm the repair was completed on this specific vehicle. Please provide proof of completed repair (dealer service record) to proceed.`
    );
  }

  // --- mileage (driver-reported, unverified) ---
  if (facts.mileage == null) {
    unknowns.push("Mileage wasn't provided.");
  } else if (facts.mileage > MAX_MILEAGE) {
    disqualifiers.push(
      `Reported mileage (${facts.mileage.toLocaleString()}) exceeds our ${MAX_MILEAGE.toLocaleString()}-mile limit.`
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

function describeUnknownSeats(reason: UnknownReason, detail?: string): string {
  switch (reason) {
    case "trimDependent":
      return "Seating capacity varies by trim for this model year, and we don't have the specific trim.";
    case "partial":
      return "Seating capacity isn't reported for all trims of this model year, and we can't confirm this one.";
    case "unservable":
      return detail
        ? `Seating capacity is on file but couldn't be used (${detail}) — this looks like a data quality issue, not a missing record.`
        : "Seating capacity is on file but couldn't be used.";
    case "absent":
      return "Seating capacity was never reported for this vehicle.";
    case "not-decoded":
      return "We couldn't confirm seating capacity.";
  }
}