// app/page.tsx
"use client";

import { useState } from "react";
import type { VehicleFacts } from "@/lib/facts";
import type { Verdict } from "@/lib/eligibility";
import { OnboardingForm } from "./components/OnboardingForm";
import { VerdictResult } from "./components/VerdictResult";

type ViewState =
  | { view: "form" }
  | { view: "loading" }
  | { view: "result"; facts: VehicleFacts; verdict: Verdict }
  | { view: "error"; message: string };

export default function Home() {
  const [state, setState] = useState<ViewState>({ view: "form" });

  async function handleSubmit(vin: string, mileage: number | null) {
    setState({ view: "loading" });
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vin, mileage }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ view: "error", message: data.error ?? "Something went wrong." });
        return;
      }
      setState({ view: "result", facts: data.facts, verdict: data.verdict });
    } catch {
      setState({ view: "error", message: "Couldn't reach the server. Try again." });
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#F3F4F0] px-6 py-16">
      <div className="w-full max-w-xl">
        <h1 className="font-[family-name:var(--font-serif)] text-3xl font-semibold text-[#14171F]">
          Fleet vehicle check
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#5B5A52]">
          Enter a VIN to check whether a vehicle is eligible to onboard. We check model
          year, vehicle type, seating, and open safety recalls — and say plainly when we
          can't confirm something.
        </p>
      </div>

      <div className="mt-8 flex w-full flex-col items-center" aria-live="polite">
        {state.view === "form" && (
          <OnboardingForm onSubmit={handleSubmit} submitting={false} />
        )}
        {state.view === "loading" && (
          <OnboardingForm onSubmit={handleSubmit} submitting={true} />
        )}
        {state.view === "error" && (
          <div className="w-full max-w-xl">
            <div className="border border-[#A23B2E] bg-[#F6EAE8] px-4 py-3 text-sm text-[#A23B2E]">
              {state.message}
            </div>
            <button
              onClick={() => setState({ view: "form" })}
              className="mt-4 border border-[#D8D6CE] px-4 py-2 text-sm text-[#14171F] hover:bg-[#EAE8E0]"
            >
              Try again
            </button>
          </div>
        )}
        {state.view === "result" && (
          <VerdictResult
            facts={state.facts}
            verdict={state.verdict}
            onReset={() => setState({ view: "form" })}
          />
        )}
      </div>
    </main>
  );
}