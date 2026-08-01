#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "$0")" && pwd)"
source_dir="$plugin_dir/gt-analytics-dashboard"
dist_dir="$plugin_dir/dist"
archive="$dist_dir/gt-analytics-dashboard-1.0.0.zip"

mkdir -p "$dist_dir"
rm -f "$archive"

cd "$plugin_dir"
zip -q -r "$archive" "$(basename "$source_dir")" \
    -x '*.DS_Store' '*/.DS_Store' '*/tests/*'

echo "$archive"
