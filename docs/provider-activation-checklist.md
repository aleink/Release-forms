# Replacement release-form provider activation

This React application remains intentionally inactive until product acceptance.

1. Confirm the accepted production project and domain in Vercel.
2. Configure the GitHub `Production` environment with required reviewers and main-only deployment rules.
3. Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as `Production` environment secrets.
4. After end-to-end acceptance, set repository variable `ENABLE_RELEASE_FORMS_PRODUCTION_DEPLOYMENT` to `true`.
5. Dispatch the workflow with the full current `main` SHA and verify its deployment-evidence artifact and live headers while Vercel Git auto-deployment remains available.
6. Only after the exact-SHA canary succeeds, disable Vercel Git auto-deployments so the governed workflow is the sole production path. Never leave both paths disabled.
7. Deactivate the legacy GitHub Pages site in repository Settings > Pages, then verify both the custom domain and `*.github.io` URL no longer serve its old artifact. Deleting a workflow alone does not remove a published Pages artifact.

The workflow always records unsigned SHA-256 integrity metadata. If the repository plan supports GitHub artifact attestations, set `ENABLE_GITHUB_ARTIFACT_ATTESTATIONS=true` to add a signed GitHub attestation over that release-evidence file. Until that succeeds, the hash must not be described as signed provenance.

Rollback: unset the activation variable and use Vercel's rollback/promote control to restore the last accepted deployment. Do not reactivate the legacy Pages copy as an emergency fallback because it cannot enforce the Vercel header policy.
