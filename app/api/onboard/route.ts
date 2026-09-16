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
  getSpecsByModelYear,
  readSpecAttribute,
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
    // Captured before any Cardog/vPIC calls — this is the honest "when did
    // we check" timestamp for every fact except recalls, which carries its
    // own real asOf date from Cardog directly.
    const checkedAt = new Date().toISOString();

    // Cardog identity decode — always attempt this first.
    const identity = await getVinIdentity(vin);

    // Specs come before the vPIC decision (not after, as in an earlier
    // version of this route) specifically so we can check whether
    // seatingCapacity came back usable before deciding whether vPIC is
    // needed — see needsVpic below.
    //
    // Model-year grain only. A nano-grain, build-specific lookup existed
    // earlier in this project (getSpecsByNano) but was removed: it 404s
    // frequently for anything that isn't an exact-match catalogued
    // production build, meaning most real requests paid for two sequential
    // API calls instead of one, for a benefit (decode-sourced doors) that
    // stopped mattering once doors was cut as a rule.
    //
    // refs.modelYear can be null even when identity.valid is true (a real,
    // confirmed gap — see the 2026 Toyota RAV4 case: recognized as a valid
    // VIN pattern, but not yet linked to a modelYear entity). Guard on it
    // explicitly rather than letting the call fail.
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
    // don't give us what the rule engine needs — not just on a total
    // decode failure. Three real, empirically-observed gaps drive this:
    //  - identity.valid === false: Cardog couldn't place the VIN at all.
    //  - refs.vehicleType === null: seen on every Tesla identity response
    //    we've pulled, even on a fully successful decode.
    //  - seatingCapacity not a clean "value": seen on every real spec
    //    sheet we've tested (Lucid, two Teslas, Ford F-150, Honda
    //    Odyssey) — partial or fully absent every time, never clean.
    // buildVehicleFacts already merges vpic data in per-field wherever the
    // Cardog-sourced value is missing; this just makes sure vPIC actually
    // gets called whenever any of those three gaps shows up, not only the
    // first one. In practice this means vPIC runs on most real vehicles,
    // not just decode failures — expected, given how rarely Cardog's
    // specs sheet serves a clean seatingCapacity value.
    const needsVpic = !identity.valid || identity.refs.vehicleType == null || !seatingCapacityUsable;
    const vpic = needsVpic
      ? await getVpicFallback(vin, identity.valid ? identity.year ?? undefined : undefined)
      : null;

    // Recalls: always call, regardless of whether identity decoded.
    // Confirmed empirically (Toyota test VIN) that this degrades
    // gracefully — resolved: false, modelYearRef: null — rather than
    // erroring when there's no bridged model year.
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
