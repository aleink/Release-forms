# Release Forms

Retained release-form prototype and backend design for Club Tattoo / Inked locations.

> **Not production:** production builds intentionally render an inactive landing
> page and do not initialize Supabase. The authoritative release-form flow is
> `https://bookingclubtattoo.com/release_form.html` using studio-issued links.
> See `docs/HOSTING_STATUS.md` before changing any hosting or activation state.

## What This Repo Contains

- Client release form flow at `/form/:token`
- Staff review dashboard at `/staff`
- Manager requirement profile view at `/manager`
- Supabase schema, storage bucket, RLS policies, and seed data under `supabase/`
- Research notes from the shared PDFs/XLSX and official jurisdiction sources under `docs/`

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add the Supabase project URL and publishable anon key to `.env.local` only for
local development against an approved non-production backend.

The app fails closed when those values or a release token are missing. For an
explicit synthetic demo during local development only, set
`VITE_RELEASE_FORM_DEMO_MODE=true`. Demo submissions return an in-memory
synthetic receipt and never persist form payloads in browser storage.

## Backend Shape

The backend is designed around versioned requirement profiles. Every submitted release form should store the exact requirement version used at signing time, so future edits to New Jersey, Las Vegas, Houston, Miami, or new-location rules do not mutate historical forms.

The public form should stay client-light. Appointment, artist, pricing, and studio-known procedure details are expected to come from the staff-created release link. Requirement fields are tagged as `client` only when the client must answer them directly; ink lots, needle lots, artist/piercer signatures, jewelry, and similar completion details stay staff-side.

## Compliance Note

The seed wording and fields are based on provided internal documents and official public sources. Final legal wording should be reviewed by the business or counsel before production use.
