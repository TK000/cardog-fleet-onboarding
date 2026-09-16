// app/components/OnboardingForm.tsx

import { useState } from "react";

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function OnboardingForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (vin: string, mileage: number | null) => void;
  submitting: boolean;
}) {
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [touched, setTouched] = useState(false);

  const normalizedVin = vin.trim().toUpperCase();
  const vinError = touched && !VIN_PATTERN.test(normalizedVin)
    ? "Enter a valid 17-character VIN."
    : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!VIN_PATTERN.test(normalizedVin)) return;
    const mileageValue = mileage.trim() === "" ? null : Number(mileage);
    onSubmit(normalizedVin, mileageValue != null && !Number.isNaN(mileageValue) ? mileageValue : null);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl border border-[#D8D6CE] bg-white p-6">
      <div>
        <label htmlFor="vin" className="block text-sm text-[#14171F]">
          Vehicle identification number
        </label>
        <input
          id="vin"
          value={vin}
          onChange={(e) => setVin(e.target.value)}
          onBlur={() => setTouched(true)}
          maxLength={17}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full border border-[#D8D6CE] bg-[#F3F4F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm uppercase tracking-wide text-[#14171F] outline-none focus-visible:border-[#14171F]"
        />
        {vinError && <div className="mt-1 text-xs text-[#A23B2E]">{vinError}</div>}
      </div>

      <div className="mt-5">
        <label htmlFor="mileage" className="block text-sm text-[#14171F]">
          Mileage <span className="text-[#8A8A80]">(optional)</span>
        </label>
        <input
          id="mileage"
          type="number"
          inputMode="numeric"
          min={0}
          value={mileage}
          onChange={(e) => setMileage(e.target.value)}
          className="mt-2 w-full border border-[#D8D6CE] bg-[#F3F4F0] px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-[#14171F] outline-none focus-visible:border-[#14171F]"
        />
        <div className="mt-1 text-xs text-[#8A8A80]">
          Self-reported — we can't independently verify this.
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full bg-[#14171F] px-4 py-2.5 text-sm font-medium text-[#F3F4F0] transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14171F]"
      >
        {submitting ? "Checking…" : "Check eligibility"}
      </button>
    </form>
  );
}
