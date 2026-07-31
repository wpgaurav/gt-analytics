# Deployment

The Worker `counterscale-gauravtiwari` (custom domain `stats.gauravtiwari.org`) is deployed by
**Cloudflare Workers Builds**, connected directly to the private repo `wpgaurav/gt-analytics`.
Pushing to `main` builds and deploys.

## Workers Builds configuration

Set these in the Cloudflare dashboard under
**Workers & Pages → counterscale-gauravtiwari → Settings → Build**:

| Setting | Value |
|---|---|
| Repository | `wpgaurav/gt-analytics` (private) |
| Branch | `main` |
| Root directory | `/` — **not** `packages/server`. Turbo and the pnpm workspace resolve from the repo root; pointing at the server package breaks `pnpm install`. |
| Build command | `pnpm build` |
| Deploy command | `pnpm --filter @counterscale/server exec wrangler deploy --config packages/server/wrangler.json --var VERSION:$WORKERS_CI_COMMIT_SHA` |
| Build variables | none required — `pnpm` and Node 20+ are detected from `package.json` |

`WORKERS_CI_COMMIT_SHA` is injected by Workers Builds and is what stamps the deployed version,
replacing the `git rev-parse HEAD` the local deploy script uses.

### Why the GitHub Actions deploy was removed

Upstream shipped `.github/workflows/cd.yaml`, which deployed via `cloudflare/wrangler-action`.
With Workers Builds connected, both pipelines would deploy the same Worker from the same commit
and race each other. `cd.yaml` is deleted; `ci.yaml` (lint, typecheck, tests) is kept.

## One-time setup — requires a browser

Connecting a Worker to a **private** repository means installing the *Cloudflare Workers and
Pages* GitHub App and granting it access to that repo. Both halves are OAuth authorisation
flows on github.com and dash.cloudflare.com, so they cannot be done from the API or CLI.

1. Cloudflare dashboard → **Workers & Pages → counterscale-gauravtiwari → Settings → Build →
   Connect**.
2. Choose **GitHub**, authorise the Cloudflare Workers and Pages app.
3. On the GitHub install screen choose **Only select repositories** and pick
   `wpgaurav/gt-analytics`. Granting access to all repositories is not required.
4. Back on Cloudflare, select the repo and branch and fill in the table above.

After the first connected build, verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://stats.gauravtiwari.org/
```

## Manual deploy

Still available, and the fallback if a build fails. Always use the workspace binary — a bare
`wrangler` is not on PATH:

```bash
pnpm --filter @counterscale/server exec wrangler deploy --config wrangler.json
```

## Secrets

Workers Builds deploys code; it does not manage secrets. These are set once per environment with
`wrangler secret put` and persist across deploys:

`CF_ACCOUNT_ID`, `CF_BEARER_TOKEN`, `CF_PASSWORD_HASH`, `CF_JWT_SECRET`, `CF_AUTH_ENABLED`,
`CF_STORAGE_ENABLED`, `CF_API_TOKEN`.

Non-secret configuration (`CF_AE_DATASET`, `VERSION`) lives in `wrangler.json` under `vars` and
is deployed with the code.
