#!/usr/bin/env bash
# Smoke-test Sphere HTTP cache headers in production (or any base URL).
# Usage: bash scripts/check-sphere-cache.sh [https://sphere.sadr3d.com]
set -euo pipefail

BASE="${1:-https://sphere.sadr3d.com}"
BASE="${BASE%/}"
FAIL=0

need() {
  local label="$1" url="$2" expect_cc="$3"
  local headers status cc
  headers="$(curl -sI "$url")"
  status="$(printf '%s\n' "$headers" | head -n1 | tr -d '\r')"
  cc="$(printf '%s\n' "$headers" | awk -F': ' 'tolower($1)=="cache-control"{print $2}' | tr -d '\r')"

  if [[ "$status" != *"200"* && "$status" != *"206"* && "$status" != *"304"* ]]; then
    echo "FAIL  $label — unexpected status: $status"
    FAIL=1
    return
  fi
  if [[ "$cc" != *"$expect_cc"* ]]; then
    echo "FAIL  $label — Cache-Control want *${expect_cc}*, got: ${cc:-<missing>}"
    FAIL=1
    return
  fi
  echo "OK    $label — Cache-Control: $cc"
}

echo "==> Sphere cache smoke @ ${BASE}"

need "HTML /" "${BASE}/" "no-cache"

# Discover a hashed asset from the live HTML.
JS_PATH="$(curl -s "${BASE}/" | grep -oE '/assets/[^"[:space:]]+\.js' | head -n1 || true)"
if [[ -z "${JS_PATH}" ]]; then
  echo "FAIL  could not find /assets/*.js in HTML"
  FAIL=1
else
  need "hashed JS ${JS_PATH}" "${BASE}${JS_PATH}" "immutable"
fi

need "catalog JSON" "${BASE}/catalogs/stars.json" "must-revalidate"
need "COG" "${BASE}/light-pollution/viirs-vnl-2024-500m.cog.tif" "max-age=2592000"

# Missing hashed file must 404 as JS, not SPA HTML.
MISSING_HEADERS="$(curl -sI "${BASE}/assets/__missing_hash_probe__.js")"
MISSING_STATUS="$(printf '%s\n' "$MISSING_HEADERS" | head -n1 | tr -d '\r')"
MISSING_CT="$(printf '%s\n' "$MISSING_HEADERS" | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r')"
if [[ "$MISSING_STATUS" == *"404"* ]]; then
  echo "OK    missing /assets/* → 404"
elif [[ "$MISSING_CT" == *"text/html"* ]]; then
  echo "FAIL  missing /assets/* served as HTML (SPA fallback still on /assets)"
  FAIL=1
else
  echo "FAIL  missing /assets/* — status: $MISSING_STATUS type: ${MISSING_CT:-<none>}"
  FAIL=1
fi

# Range on COG still works with cache headers.
RANGE_STATUS="$(curl -sI -H 'Range: bytes=0-63' \
  "${BASE}/light-pollution/viirs-vnl-2024-500m.cog.tif" | head -n1 | tr -d '\r')"
if [[ "$RANGE_STATUS" == *"206"* ]]; then
  echo "OK    COG Range → 206"
else
  echo "FAIL  COG Range — status: $RANGE_STATUS"
  FAIL=1
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "==> FAILED — apply Sphere cache headers on the VPS Caddyfile (see deploy/Caddyfile.sadr3d.example)"
  exit 1
fi
echo "==> All cache checks passed"
