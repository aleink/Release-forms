# Standalone release-forms runtime retirement

The standalone Vercel application in this repository is not an active Club Tattoo release-form workflow. Its production build is a deliberately inactive notice with no Supabase client, release submission capability, or browser persistence.

`ENABLE_RELEASE_FORMS_PRODUCTION_DEPLOYMENT` must remain unset or `false`. Do not add a production domain, reconnect the source-pinned Vercel project to Git, or promote this application as a replacement for the live release-form flow.

The manual production workflow exists only as a controlled rollback/retirement boundary. Enabling it requires all of the following:

- written product acceptance for the inactive retirement page;
- the exact source-pinned Vercel account and `release-forms` project, disconnected from Git (the workflow independently verifies the account, project, and provider-reported link state);
- the `Production` environment approval and exact typed confirmation;
- a full SHA that is still current `main` immediately before promotion;
- successful exact-artifact, canary, rollback-inventory, and provider-reconciliation gates.

If promotion evidence is absent or reports `promotion_uncertain`, do not rerun the workflow. Reconcile every alias in the retained rollback inventory and, if rollback is required, use only its recorded deployment ID.
