// app/api/onboard/route.ts
//
// Thin orchestration layer only: call Cardog/vPIC, hand raw responses to
// buildVehicleFacts(), hand facts to evaluateEligibility().
// No business logic here

import { NextResponse } from "next/server";
import {
  getVinIdentity,
  getVpicFallback,
  getVinRecalls,
  getSpecsByModelYear,
  readSpecAttribute,
} from "@/lib/cardog";
import { buildVehicleFacts } from "@/lib/facts";
import { evaluateEligibility } from "@/lib/eligibility";

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export async function POST(request: Request) {
  let body: { vin?: string; mileage?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const vin = body.vin?.trim().toUpperCase();
  const mileage = typeof body.mileage === "number" && body.mileage >= 0 ? body.mileage : null;

  if (!vin || !VIN_PATTERN.test(vin)) {
    return NextResponse.json(
      { error: "A valid 17-character VIN is required." },
      { status: 400 }
    );
  }

  try {
    // timestamp for when we checked the data
    const checkedAt = new Date().toISOString();

    // try getting cardog data first
    const identity = await getVinIdentity(vin);

    const specs = identity.valid && identity.refs.modelYear
      ? await getSpecsByModelYear(identity.refs.modelYear)
      : null;

    const seatingCapacityUsable = specs
      ? (() => {
          const result = readSpecAttribute(specs, "seatingCapacity");
          return result.status === "value" && typeof result.value === "number";
        })()
      : false;

    // vPIC fallback fires whenever Cardog's identity+specs, together,
    // don't give us what the rule engine needs: cardog couldn't decode
    // the VIN at all, or it decoded but didn't give a vehicle type,
    // or it decoded but didn't give a clean seating capacity.
    const needsVpic = !identity.valid || identity.refs.vehicleType == null || !seatingCapacityUsable;
    const vpic = needsVpic
      ? await getVpicFallback(vin, identity.valid ? identity.year ?? undefined : undefined)
      : null;

    const recalls = await getVinRecalls(vin);

    const facts = buildVehicleFacts({
      vin,
      identity,
      vpic,
      specs,
      recalls,
      mileage,
      checkedAt,
    });

    const verdict = evaluateEligibility(facts);

    return NextResponse.json({ facts, verdict });
  } catch (err) {
    console.error("Onboarding check failed for", vin, err);
    return NextResponse.json(
      { error: "Vehicle lookup failed. Please try again." },
      { status: 502 }
    );
  }
}
