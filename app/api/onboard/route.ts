import { NextResponse } from "next/server";
import { CardogClient } from "@cardog/api";
import { buildVehicleFacts } from "@/lib/facts";
import { evaluateEligibility } from "@/lib/eligibility";
import { getVinIdentity, getVpicFallback, getVinRecalls, getSpecsByModelYear } from "@/lib/cardog";

// This client can be created once and reused across requests.
const cardog = new CardogClient({ apiKey: process.env.CARDOG_API_KEY! });

export async function POST(request: Request) {
  const { vin } = await request.json();
  let identity = await getVinIdentity(vin);
  let source: VehicleFacts["source"] = "cardog";

  if (!identity.valid) {
    const fallback = await getVpicFallback(vin);
    if (fallback) { identity = fallback; source = "vpic-fallback"; }
  }

  const recalls = await getVinRecalls(vin);
  const specs = identity.refs?.modelYear ? await getSpecsByModelYear(identity.refs.modelYear) : null;

  const facts = buildFacts(identity, recalls, specs, source); // small mapper, can live in eligibility.ts too
  const verdict = evaluateEligibility(facts);

  return NextResponse.json({ facts, verdict });
}