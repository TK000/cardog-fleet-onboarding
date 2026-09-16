# Cardog Fleet Onboarding

A fleet-onboarding eligibility check for Cardog's engineering take-home (brief 2.2).
A driver submits a VIN and optional mileage; the app decodes the vehicle, checks it against a defined rule set, and returns **eligible**, **not eligible**, or **cannot say** — with plain-language reasons, and every fact tagged with where it came from and when it was checked.

**Live:** [https://cardog-fleet-onboarding-orpin.vercel.app/](https://cardog-fleet-onboarding-orpin.vercel.app/)
**Write-up:** [WRITEUP.md](./WRITEUP.md) — the reasoning behind the rules, the one design choice defended, and the answer to the brief's required question.

---

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Vitest — unit tests for the rule engine, no network or API key required
- Cardog v2 API + NHTSA vPIC (fallback)
- Deployed on Vercel

## Getting started

Requires Node.js 18.18+.

```bash
git clone https://github.com/TK000/cardog-fleet-onboarding
cd cardog-fleet-onboarding
npm install
```

Create `.env.local` in the project root:

```
CARDOG_API_KEY=your-key-here
```

`.env.local` is already in `.gitignore` — never commit this file, and never paste the key into a screenshot, issue, or commit message.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Running the tests

```bash
npm test
```

(equivalent to `npx vitest run`). This runs everything under `tests/lib/`

## Try it

Any valid 17-character VIN works. Two real ones to start with if you want a quick look:

- `4T1DAACK5SU614616` — a 2025 Toyota Camry
- `JF2SKAJC8SG000101` — a 2025 Subaru Forester with real open recalls

## What it checks

- Model year (vehicle no older than 12 years)
- Vehicle type (passenger car or multipurpose passenger vehicle only)
- Seating capacity (at least 4)
- Open safety recalls, NHTSA + Transport Canada (see write-up for why this produces "cannot say" rather than an automatic rejection)
- Mileage (driver-reported, optional, clearly labeled as unverified)

## Project structure

```
lib/
  cardog.ts         Typed fetch wrappers for Cardog's v2 API + NHTSA vPIC.
  facts.ts          Maps raw Cardog/vPIC responses into normalized source-tagged VehicleFacts.
  eligibility.ts    The rule engine: takes in VehicleFacts and returns a verdict.

app/
  api/onboard/route.ts   Orchestrates the above. The only place that touches the network.
  page.tsx                Client page: renders the form, then the results.
  components/             SourceTag, FactRow, OnboardingForm, VerdictResult.

tests/lib/            Vitest tests, mirroring the lib/ structure above.
```

## Deployment notes

If you're redeploying this yourself on Vercel:

- Set `CARDOG_API_KEY` under Project Settings → Environment Variables
- Deployment Protection must be **disabled** (Settings → Deployment Protection)

