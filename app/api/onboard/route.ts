// app/api/onboard/route.ts
//
// Thin orchestration layer only: call Cardog/vPIC, hand raw responses to
// buildVehicleFacts(), hand facts to evaluateEligibility(). No business
// logic lives here — that's the whole point of the lib/ split.

import { NextResponse } from "next/server";
import {
  getVinIdentity,
  getVpicFallback,
  getVinRecalls,
  getSpecsPreferNano,
} from "@/lib/cardog";
import { buildVehicleFacts } from "@/lib/facts";
import { evaluateEligibility } from "@/lib/eligibility";

// Same pattern Cardog's own API uses (confirmed against a real schema
// pattern in openapi.json's FeedbackCreateRequest): 17 chars, excluding
// I/O/Q, which VINs never contain.
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
    // Cardog identity decode — always attempt this first.
    const identity = await getVinIdentity(vin);

    // vPIC fallback only when Cardog couldn't place the VIN in its catalog
    // — no point spending the call (or the credits) otherwise. No model
    // year to pass here: this only runs when Cardog's own decode failed,
    // so we don't have a trustworthy year to hand vPIC either.
    const vpic = identity.valid ? null : await getVpicFallback(vin);

    // Recalls: always call, regardless of whether identity decoded.
    // Confirmed empirically (Toyota test VIN) that this degrades
    // gracefully — resolved: false, modelYearRef: null — rather than
    // erroring when there's no bridged model year.
    const recalls = await getVinRecalls(vin);

    // Specs: nano-grain preferred, model-year grain as fallback, only when
    // Cardog's own decode succeeded (vPIC alone can't give us a ref to look
    // up specs with). NOTE: the nano-grain path is spec-verified but not
    // yet confirmed against a real populated response — worth testing
    // before trusting this in front of a reviewer.
    const specs = identity.valid ? await getSpecsPreferNano(identity) : null;

    const facts = buildVehicleFacts({
      vin,
      identity,
      vpic,
      specs,
      recalls,
      mileage,
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