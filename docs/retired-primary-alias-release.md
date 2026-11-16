# Retired primary alias only

This one-time maintenance release affects **only `release-forms.vercel.app`**.
The Calendar's native form at `bookingclubtattoo.com/release_form.html`, the
per-location branded Jotform links, studio messages, and all sibling aliases are
outside its scope. The production artifact remains the existing reviewed
inactive landing page. There is no new app behavior or database change.

## Provider mechanism

Vercel documents assignment of one alias via
`POST /v2/deployments/{deploymentId}/aliases` with exactly
`{"alias":"release-forms.vercel.app","redirect":null}`. Its official SDK
example includes a `*.vercel.app` alias. This does not require project promotion,
force, domain reassignment, or rebuilding. A provider permission/policy error is
a stop, **not** permission to promote the project or try another route.

- [Assign one alias](https://vercel.com/docs/rest-api/aliases/assign-an-alias)
- [Official alias SDK example](https://vercel.com/docs/rest-api/sdk/examples/deployments-automation)
- [Complete alias inventory](https://vercel.com/docs/rest-api/aliases/list-aliases)
- [CLI deployment, including skip-domain](https://vercel.com/docs/cli/deploy)
- [CLI authentication via environment](https://vercel.com/docs/cli/global-options)

The API has no documented compare-and-swap. The workflow serializes with the old
release lane, checks all alias mappings immediately before and after the single
write, and detects concurrent drift. The release operator must serialize manual
provider changes too. A detected race is not automatically repaired.

## Exact scope and preconditions

| Item | Required value |
| --- | --- |
| Repository | `aleink/Release-forms` |
| Team | `team_dYh8hnyuxB6dbWOjq34jIHNg` (`gemandi`) |
| Project | `prj_AgFYzaxmaGGuLPQnxkeSfzLawwMX` (`release-forms`) |
| Only mutable alias | `release-forms.vercel.app` |
| Approved prior mapping | `dpl_FCoyQZDaUzE1dEpcGiQqm6MfjqJ2` |
| Prior source | `1765d25ea2c9e43eb75033127b331be33aaa80c3` |

1. Review this patch independently, pass PR checks, and merge through the normal
   protected-main process. Require successful latest exact-main push CI too.
2. Before merging, the operator must verify/disconnect **only this retired
   project's** Git integration if still connected. This prevents a Git push
   from assigning generated aliases outside this workflow. Do not disconnect
   another project or alter any alias while doing so. The workflow requires
   `project.link == null` before any build is uploaded.
3. Keep `ENABLE_RELEASE_FORMS_PRODUCTION_DEPLOYMENT` unset/false. Never enable
   the old project-wide publisher. Enable only the new repository/environment
   variable `ENABLE_RETIRED_PRIMARY_ALIAS_DEPLOYMENT=true` after approval.
4. Reuse the existing privileged `VERCEL_TOKEN` in the main-only protected
   `Production` GitHub environment. This workflow hard-pins team/project IDs;
   it neither creates credentials nor accepts alternate targets.

## Stage, then verify/publish the same artifact

Dispatch `deploy-retired-primary-alias.yml` on current protected main with its
full SHA and confirmation `CHANGE ONLY release-forms.vercel.app`.

The `stage` job reruns source checks, builds and seals the inactive artifact,
captures **all** project aliases (including siblings with different deployment
IDs), and deploys with `--prebuilt --prod --skip-domain`. It checks exact provider
identity/source, enumerates every provider file, and proves staging did not
change any mapping. Its immutable artifact contains reviewed static bytes,
prebuilt bytes, full alias baseline, provider inventory and single-alias intent.
It contains no pulled environment file or access credential.

The separate `publish` job downloads the exact artifact ID from that same run,
revalidates current-main/CI admission, sealed build bytes, provider file inventory
and every alias. Its HTTP canary checks every static byte, all ten security
headers, and `/`, `/client`, `/staff`, `/formtest`, `/manager` against the inactive
artifact. No form, login, customer read, database request, or SMS is submitted.

### Protected staged deployment

With no additional access, the canary is public-only and stops on protection.
`CANARY_ACCESS_REQUIRED` before the immutable write-arm artifact means **no alias
mutation was attempted**. No `vercel curl`, automatic share link, protection
disablement or Trusted Sources change is used.

If protected, obtain a **new explicit owner approval** for this exact staged
deployment's temporary canary access and immediate revocation. Previous one-time
approvals are not reusable. Only then may the operator add the temporary
`RETIRED_ALIAS_CANARY_ACCESS` secret in `Production` as this JSON envelope:

```json
{
  "kind": "deployment-share",
  "orgId": "team_dYh8hnyuxB6dbWOjq34jIHNg",
  "projectId": "prj_AgFYzaxmaGGuLPQnxkeSfzLawwMX",
  "deploymentId": "<exact staged dpl ID>",
  "sourceSha": "<exact full staged main SHA>",
  "stageRunId": "<original workflow run ID as a string>",
  "publishAttempt": "<next GitHub run_attempt as a string>",
  "issuedAt": 0,
  "expiresAt": 0,
  "token": "<fresh owner-approved temporary canary credential>"
}
```

Use real epoch-millisecond times with expiry no more than **15 minutes** after
issuance. The example zeros are intentionally unusable. The script checks all
bindings and expiry before every request. The operator must create only a
shareable link for the exact deployment ID using
`PATCH /aliases/{deploymentId}/protection-bypass` with `ttl: 900`, never a
project-wide automation key, branch link, or alias protection override. The
token travels only as `_vercel_share` on that exact deployment origin. A
share handshake may follow one same-origin, same-path redirect using only a
newly issued host-only Secure/HttpOnly `_vercel_jwt` cookie in memory. All other
redirects are refused; cookies and credentials are never persisted. These are
not exported browser authentication cookies. Provider behavior outside this
bounded handshake fails closed for review. The operator must **revoke the provider credential immediately after
the canary/run and remove the GitHub secret, even on failure**. Envelope expiry
is not a substitute for provider revocation. The complete project protection
configuration and bypass registry, plus every alias-level access hash, remain
pinned. Temporary access must be scoped to the exact staged deployment and must
not change the project registry or any sibling. Any unexpected registry change
fails closed; do not weaken these checks to accept a broader key.

Re-run **only failed jobs**, not the successful stage job. This reuses the exact
immutable deployment and static bytes, not a newly built candidate. An envelope
from the preceding attempt is rejected. No additional access is currently
created or approved merely by merging this workflow.

### Only after all checks pass

Before the sole alias write, the workflow uploads an immutable
`retired-primary-alias-write-armed-<run_id>` artifact. Its name deliberately omits
the attempt number and overwrite is disabled. Once armed, subsequent attempts
cannot silently issue another write. The helper repeats live mapping/config/
deployment checks, assigns only the primary alias, then reconciles every alias.
It finally verifies exact inactive bytes/headers/routes on the public primary
alias **without any bypass**, and reconciles all mappings again.

Do not claim success from an API response alone, a successful build, an assigned
alias alone, or a protected page. Require the public canary and final mapping
receipt. Disable the new enable variable after this one-time release.

## Uncertainty and exact rollback

If a write was armed, a response timed out, or final evidence is missing, do not
blindly rerun, delete/overwrite the arm artifact, retry assignment, or promote
the whole project. Download that run's immutable intent and publish receipts,
verify their run/source provenance, and perform read-only reconciliation first:

```sh
node scripts/ci/retired-single-alias.mjs reconcile \
  single-alias-intent.json fresh-reconciliation.json
```

A rollback is a separate explicit operator decision, not an automatic response
to a timeout. From the reviewed source with the original immutable intent,
already-authorized provider credential, and an explicit exact-target rollback
confirmation, the helper can restore **only** its recorded prior primary mapping:

```sh
SINGLE_ALIAS_CONFIRMATION='ROLLBACK ONLY release-forms.vercel.app' \
node scripts/ci/retired-single-alias.mjs rollback \
  single-alias-intent.json unused rollback-attempt.json rollback-result.json
```

It refuses if the primary no longer points to that candidate, any sibling or
protection mode changed, either deployment is not READY/in the correct project,
or the old source/rollback ID differs. Durable attempt files use exclusive create
and may not be overwritten. The only rollback API request is the same exact
alias-assignment endpoint, with destination `dpl_FCoyQZDaUzE1dEpcGiQqm6MfjqJ2`.
After rollback, reconcile and verify the prior public response; do not call the
old active artifact security-hardened. No project-wide rollback is permitted.

## Evidence limits

This workflow intentionally rejects a project with more than one page/100 aliases
rather than silently omitting siblings. It proves no reviewed sibling mapping,
redirect, or alias access hash changed during this release; it does not retire
those siblings. It does not change functional Calendar/Jotform releases or clear
any unrelated security-tooling hold.
