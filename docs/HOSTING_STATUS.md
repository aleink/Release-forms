# Hosting status and activation boundary

This React application is not the authoritative Club Tattoo release-form flow.
Production builds intentionally render only an inactive landing page, do not
initialize Supabase, and set a no-store, noindex response policy.

The active release form is:

- `https://bookingclubtattoo.com/release_form.html`

That page uses a different capability-link contract. Do not redirect
`/form/:token` to the active page or forward a token between the two systems.

## Recorded provider state

GitHub Pages is not configured by a workflow in this repository. The legacy
branch-based Pages deployment was disabled through the provider API on
August 31, 2026. A fresh request to
`https://aleink.github.io/Release-forms/` returned `404`, confirming that the
raw Vite source is no longer published. Keep that URL in the short closeout
observation check so an unexpected provider-state change is caught.

The repository's Vercel project remained intact through the Pages change. Keep
it without a production custom domain and with production promotion disabled.
A preview may be used only to verify the inactive landing and the response
headers in `vercel.json`.

For a preview, import `aleink/Release-forms` into a dedicated Vercel project at
the repository root. `vercel.json` fixes the build to `npm run build` and output
to `dist`; the build itself rejects an artifact containing an active Supabase
client. Keep the generated `.vercel/project.json` local because `.vercel/` is
ignored. Verify the preview at `/`, `/form/test`, and `/staff`: every path must
show the same inactive landing, return `Cache-Control: private, no-store`, and
deny framing. Do not attach a custom production domain.

Activating the React application requires a separate reviewed project covering
data migration, legal wording, identity-image retention, storage access, RLS,
staff authorization, and capability compatibility. Do not activate it by adding
provider environment variables alone.
