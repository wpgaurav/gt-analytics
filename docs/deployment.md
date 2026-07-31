# Deployment

The Worker `counterscale-gauravtiwari` (custom domain `stats.gauravtiwari.org`) is deployed by
**GitHub Actions** from this private repo. Pushing to `main` runs the full gate — build, lint,
typecheck, tests — and deploys only if all of it passes.

Workflow: [`.github/workflows/deploy.yaml`](../.github/workflows/deploy.yaml).

## Why not Cloudflare Workers Builds

Connecting a Worker to a **private** repository requires installing the *Cloudflare Workers and
Pages* GitHub App and authorising it — OAuth flows on github.com and dash.cloudflare.com that
cannot be driven from the API or CLI. GitHub Actions needs no browser step and keeps the deploy
gate in the same place as the tests. Workers Builds remains available later if the dashboard
view is ever wanted; the two must not both be connected, or they will race to deploy the same
commit.

### The upstream workflow had a real bug

Upstream's `cd.yaml` triggered on:

```yaml
workflow_run:
    workflows: [ci]
    types: [completed]
```

`completed` includes `failure`, and there was no check on
`github.event.workflow_run.conclusion`. That pipeline deployed even when CI had just gone red.
`cd.yaml` is deleted; the gate and the deploy now live in one job, so a failing test cannot be
followed by a deploy.

## Secrets and configuration

Two GitHub repository secrets drive the deploy:

| Secret | Contents |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Scoped API token, id `4b1b4e11…`, named *gt-analytics GitHub Actions deploy* |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account the Worker lives in |

The token is deliberately least-privilege — it can deploy this Worker and touch the bindings the
project uses, and nothing else:

- Account: **Workers Scripts Write**, **Workers KV Storage Write**, **Workers R2 Storage Write**,
  **D1 Write**, **Account Settings Read**
- Zone `gauravtiwari.org`: **Workers Routes Write** (for the `stats.` custom domain)

It has no DNS, no zone-settings, no billing, and no account-write access. To roll it, create a
replacement in the Cloudflare dashboard under **My Profile → API Tokens**, then:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo wpgaurav/gt-analytics
```

### Runtime secrets are separate

GitHub Actions deploys code; it does not manage the Worker's own secrets. These are set once
with `wrangler secret put` and persist across deploys:

`CF_ACCOUNT_ID`, `CF_BEARER_TOKEN`, `CF_PASSWORD_HASH`, `CF_JWT_SECRET`, `CF_AUTH_ENABLED`,
`CF_STORAGE_ENABLED`, `CF_API_TOKEN`.

Non-secret configuration (`CF_AE_DATASET`, `VERSION`) lives in `wrangler.json` under `vars` and
ships with the code.

> `CF_AE_DATASET` must match the `analytics_engine_datasets` binding in `wrangler.json`. When
> they drift, writes go to one dataset and reads to another, and every query returns zero rows
> with no error. `app/analytics/__tests__/dataset.test.ts` exists to catch exactly that.

## Manual deploy

The fallback if Actions is unavailable. Always use the workspace binary — a bare `wrangler` is
not on PATH:

```bash
pnpm --filter @counterscale/server exec wrangler deploy --config wrangler.json
```

## Verifying a deploy

The workflow polls `https://stats.gauravtiwari.org/tracker.js` and fails the run if it does not
return 200 within ~50 seconds. To check by hand:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://stats.gauravtiwari.org/tracker.js
```
