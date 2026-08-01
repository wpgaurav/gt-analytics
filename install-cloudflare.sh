#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_URL="https://github.com/wpgaurav/gt-analytics.git"
DEFAULT_INSTALL_DIR="${GT_ANALYTICS_DIR:-$PWD/gt-analytics}"
DRY_RUN=false

usage() {
    cat <<'EOF'
Install GT Analytics on Cloudflare.

Usage:
  ./install-cloudflare.sh [--dry-run]

Environment overrides:
  GT_ANALYTICS_DIR             Clone destination when run outside a checkout
  GT_ANALYTICS_WORKER          Worker name (default: gt-analytics)
  GT_ANALYTICS_DATASET         Pageview dataset (default: <worker>_metrics)
  GT_ANALYTICS_EVENTS_DATASET  Events dataset (default: <worker>_events)
  GT_ANALYTICS_D1              D1 database name (default: <worker>)
  GT_ANALYTICS_R2              R2 bucket name (default: <worker>-daily-rollups)
  GT_ANALYTICS_ACCOUNT_ID      Cloudflare account ID
  GT_ANALYTICS_CF_TOKEN        Account Analytics Read API token
  GT_ANALYTICS_PASSWORD        Dashboard password (12+ characters)
  GT_ANALYTICS_PUBLIC_DASHBOARD=1 to deploy without dashboard authentication
EOF
}

while (($#)); do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

say() {
    printf '\n==> %s\n' "$1"
}

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required."
command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is required."

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
((node_major >= 20)) || fail "Node.js 20 or newer is required; found $(node --version)."

run_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        pnpm "$@"
    elif command -v corepack >/dev/null 2>&1; then
        corepack pnpm "$@"
    else
        fail "pnpm 9+ is required. Install pnpm or enable Corepack."
    fi
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"

if [[ -f "$script_dir/packages/server/package.json" ]]; then
    repo_root="$script_dir"
elif [[ -f "$PWD/packages/server/package.json" ]]; then
    repo_root="$PWD"
else
    if [[ -e "$DEFAULT_INSTALL_DIR" ]]; then
        fail "$DEFAULT_INSTALL_DIR already exists. Set GT_ANALYTICS_DIR to an empty destination."
    fi
    say "Cloning GT Analytics"
    git clone --depth 1 "$REPOSITORY_URL" "$DEFAULT_INSTALL_DIR"
    repo_root="$DEFAULT_INSTALL_DIR"
fi

cd "$repo_root"
repo_root="$PWD"

run_wrangler() {
    run_pnpm --filter @counterscale/server exec wrangler "$@"
}

worker_name="${GT_ANALYTICS_WORKER:-gt-analytics}"
dataset_name="${GT_ANALYTICS_DATASET:-${worker_name//-/_}_metrics}"
events_dataset_name="${GT_ANALYTICS_EVENTS_DATASET:-${worker_name//-/_}_events}"
d1_name="${GT_ANALYTICS_D1:-$worker_name}"
r2_bucket="${GT_ANALYTICS_R2:-$worker_name-daily-rollups}"

[[ "$worker_name" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] ||
    fail "GT_ANALYTICS_WORKER must contain lowercase letters, numbers, and hyphens."
[[ "$dataset_name" =~ ^[A-Za-z0-9_]{1,64}$ ]] ||
    fail "GT_ANALYTICS_DATASET must contain letters, numbers, and underscores."
[[ "$events_dataset_name" =~ ^[A-Za-z0-9_]{1,64}$ ]] ||
    fail "GT_ANALYTICS_EVENTS_DATASET must contain letters, numbers, and underscores."
[[ "$d1_name" =~ ^[A-Za-z0-9_-]{1,64}$ ]] ||
    fail "GT_ANALYTICS_D1 contains unsupported characters."
[[ "$r2_bucket" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] ||
    fail "GT_ANALYTICS_R2 must contain lowercase letters, numbers, and hyphens."

say "Installing dependencies"
run_pnpm install --frozen-lockfile

say "Building GT Analytics"
run_pnpm build

config_dir="$repo_root/.gt-analytics"
config_path="$config_dir/wrangler.json"
mkdir -p "$config_dir"

account_id="${GT_ANALYTICS_ACCOUNT_ID:-}"
d1_id="00000000-0000-0000-0000-000000000000"

if [[ "$DRY_RUN" == false ]]; then
    say "Checking Cloudflare authentication"
    if ! whoami_output="$(run_wrangler whoami 2>&1)"; then
        run_wrangler login
        whoami_output="$(run_wrangler whoami 2>&1)"
    fi

    if [[ -z "$account_id" ]]; then
        account_ids="$(printf '%s\n' "$whoami_output" | grep -Eo '[0-9a-f]{32}' | sort -u || true)"
        account_count="$(printf '%s\n' "$account_ids" | sed '/^$/d' | wc -l | tr -d ' ')"

        if [[ "$account_count" == "1" ]]; then
            account_id="$(printf '%s\n' "$account_ids" | sed -n '1p')"
        else
            printf '%s\n' "$whoami_output"
            read -r -p "Cloudflare account ID: " account_id
        fi
    fi

    [[ "$account_id" =~ ^[0-9a-f]{32}$ ]] || fail "A valid 32-character Cloudflare account ID is required."
    export CLOUDFLARE_ACCOUNT_ID="$account_id"

    say "Provisioning D1"
    d1_json="$(run_wrangler d1 list --json)"
    d1_id="$(printf '%s' "$d1_json" | GT_D1_NAME="$d1_name" node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
    const rows = JSON.parse(input);
    const match = rows.find(row => row.name === process.env.GT_D1_NAME);
    if (match) process.stdout.write(match.uuid || match.id || "");
});
')"

    if [[ -z "$d1_id" ]]; then
        run_wrangler d1 create "$d1_name"
        d1_json="$(run_wrangler d1 list --json)"
        d1_id="$(printf '%s' "$d1_json" | GT_D1_NAME="$d1_name" node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
    const rows = JSON.parse(input);
    const match = rows.find(row => row.name === process.env.GT_D1_NAME);
    if (match) process.stdout.write(match.uuid || match.id || "");
});
')"
    fi

    [[ "$d1_id" =~ ^[0-9a-f-]{36}$ ]] || fail "Could not resolve the D1 database ID for $d1_name."

    say "Provisioning R2"
    r2_list="$(run_wrangler r2 bucket list)"
    if ! printf '%s\n' "$r2_list" | grep -Fq "$r2_bucket"; then
        run_wrangler r2 bucket create "$r2_bucket"
    fi
fi

version="$(node -p 'require("./packages/server/package.json").version')"

GT_REPO_ROOT="$repo_root" \
GT_CONFIG_PATH="$config_path" \
GT_WORKER_NAME="$worker_name" \
GT_ACCOUNT_ID="$account_id" \
GT_VERSION="$version" \
GT_DATASET_NAME="$dataset_name" \
GT_EVENTS_DATASET_NAME="$events_dataset_name" \
GT_D1_NAME="$d1_name" \
GT_D1_ID="$d1_id" \
GT_R2_BUCKET="$r2_bucket" \
node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.env.GT_REPO_ROOT;
const config = {
    main: path.join(root, "packages/server/workers/app.ts"),
    name: process.env.GT_WORKER_NAME,
    account_id: process.env.GT_ACCOUNT_ID || undefined,
    compatibility_flags: ["nodejs_compat_v2"],
    compatibility_date: "2024-12-13",
    assets: {
        binding: "ASSETS",
        directory: path.join(root, "packages/server/build/client"),
    },
    vars: {
        VERSION: process.env.GT_VERSION,
        CF_AE_DATASET: process.env.GT_DATASET_NAME,
        CF_EVENTS_DATASET: process.env.GT_EVENTS_DATASET_NAME,
    },
    analytics_engine_datasets: [
        { binding: "WEB_COUNTER_AE", dataset: process.env.GT_DATASET_NAME },
        { binding: "EVENTS_AE", dataset: process.env.GT_EVENTS_DATASET_NAME },
    ],
    r2_buckets: [
        { binding: "DAILY_ROLLUPS", bucket_name: process.env.GT_R2_BUCKET },
    ],
    d1_databases: [
        {
            binding: "SITES_DB",
            database_name: process.env.GT_D1_NAME,
            database_id: process.env.GT_D1_ID,
            migrations_dir: path.join(root, "packages/server/migrations"),
        },
    ],
    triggers: { crons: ["0 2 * * *"] },
    durable_objects: {
        bindings: [{ name: "REALTIME", class_name: "RealtimeSite" }],
    },
    migrations: [{ tag: "v1", new_classes: ["RealtimeSite"] }],
};

fs.mkdirSync(path.dirname(process.env.GT_CONFIG_PATH), { recursive: true });
fs.writeFileSync(process.env.GT_CONFIG_PATH, JSON.stringify(config, null, 4) + "\n");
NODE

if [[ "$DRY_RUN" == true ]]; then
    say "Validating generated Worker configuration"
    run_wrangler deploy --dry-run --config "$config_path"
    printf '\nDry run complete. Generated config: %s\n' "$config_path"
    exit 0
fi

put_secret() {
    local name="$1"
    local value="$2"
    printf '%s' "$value" | run_wrangler secret put "$name" --config "$config_path"
}

api_token="${GT_ANALYTICS_CF_TOKEN:-}"
if [[ -z "$api_token" ]]; then
    printf '\nCreate an Account Analytics Read token at:\n'
    printf 'https://dash.cloudflare.com/profile/api-tokens\n\n'
    read -r -s -p "Cloudflare API token: " api_token
    printf '\n'
fi
[[ -n "$api_token" ]] || fail "A Cloudflare Account Analytics Read token is required."

say "Setting Worker secrets"
put_secret "CF_ACCOUNT_ID" "$account_id"
put_secret "CF_BEARER_TOKEN" "$api_token"
put_secret "CF_STORAGE_ENABLED" "true"
put_secret "CF_REALTIME_SALT" "$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')"

if [[ "${GT_ANALYTICS_PUBLIC_DASHBOARD:-0}" == "1" ]]; then
    put_secret "CF_AUTH_ENABLED" "false"
else
    dashboard_password="${GT_ANALYTICS_PASSWORD:-}"
    if [[ -z "$dashboard_password" ]]; then
        read -r -s -p "Dashboard password (12+ characters): " dashboard_password
        printf '\n'
    fi
    ((${#dashboard_password} >= 12)) || fail "The dashboard password must be at least 12 characters."

    password_hash="$(cd "$repo_root/packages/cli" && GT_DASHBOARD_PASSWORD="$dashboard_password" node --input-type=module -e '
import bcrypt from "bcryptjs";
process.stdout.write(await bcrypt.hash(process.env.GT_DASHBOARD_PASSWORD, 12));
')"
    unset dashboard_password

    put_secret "CF_AUTH_ENABLED" "true"
    put_secret "CF_PASSWORD_HASH" "$password_hash"
    put_secret "CF_JWT_SECRET" "$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')"
fi

say "Applying D1 migrations"
run_wrangler d1 migrations apply SITES_DB --remote --config "$config_path"

say "Deploying GT Analytics"
run_wrangler deploy --config "$config_path"

printf '\nGT Analytics is deployed.\n'
printf 'Reusable Wrangler config: %s\n' "$config_path"
printf 'Add a custom domain later from Cloudflare Workers & Pages if desired.\n'
