#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "$0")" && pwd)"
source_dir="$plugin_dir/gt-analytics-dashboard"
dist_dir="$plugin_dir/dist"
version="$(sed -n 's/^ \* Version:[[:space:]]*//p' "$source_dir/gt-analytics-dashboard.php" | head -n 1)"

if [[ -z "$version" ]]; then
    echo "Could not read the plugin version." >&2
    exit 1
fi

archive="$dist_dir/gt-analytics-dashboard-$version.zip"

mkdir -p "$dist_dir"
rm -f "$archive"

cd "$plugin_dir"
zip -q -r "$archive" "$(basename "$source_dir")" \
    -x '*.DS_Store' '*/.DS_Store' '*/tests/*'

echo "$archive"
