import { NextResponse } from "next/server";
import { CardogClient } from "@cardog/api";

// This client can be created once and reused across requests.
const cardog = new CardogClient({ apiKey: process.env.CARDOG_API_KEY! });

// Next.js convention: exporting a function named POST from a file called
// route.ts inside app/api/onboard/ makes it handle POST /api/onboard.
// No router setup, no app.post(...) — the file path + export name IS the route.
export async function POST(request: Request) {
  // request is the standard Web Fetch API Request object (not Express's req).
  // .json() parses the body, same idea as body-parser but built in.
  const body = await request.json();
  const vin: string | undefined = body.vin;

  if (!vin || vin.length !== 17) {
    // NextResponse.json is just a helper that sets the JSON header and
    // lets you set a status code, same as res.status(400).json(...) in Express.
    return NextResponse.json(
      { error: "A 17-character VIN is required." },
      { status: 400 }
    );
  }

  try {
    const identity = await cardog.v2.vin.getByVin(vin);

    if (!identity.valid) {
      // Not an error — a real, expected outcome. Return it as data,
      // not a thrown exception, so your frontend can render "doesn't decode"
      // instead of a generic error page.
      return NextResponse.json({ decoded: false, vin });
    }

    const recalls = await cardog.v2.vin.recalls(vin);

    return NextResponse.json({
      decoded: true,
      vin,
      identity,
      recalls,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Cardog lookup failed." },
      { status: 502 }
    );
  }
}