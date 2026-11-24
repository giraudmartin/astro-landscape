#!/usr/bin/env bash
# Verify the VIIRS COG answers HTTP Range with 206 Partial Content.
# Usage:
#   bash scripts/check-cog-range.sh
#   bash scripts/check-cog-range.sh https://sphere.sadr3d.com/light-pollution/viirs-vnl-2024-500m.cog.tif
set -euo pipefail

URL="${1:-http://127.0.0.1/light-pollution/viirs-vnl-2024-500m.cog.tif}"

echo "==> HEAD ${URL}"
curl -sI "${URL}" | head -n 20

echo
echo "==> Range bytes=0-15 (expect 206)"
HEADERS="$(curl -sI -H 'Range: bytes=0-15' "${URL}")"
echo "${HEADERS}" | head -n 25

STATUS="$(printf '%s\n' "${HEADERS}" | head -n 1 | tr -d '\r')"
if printf '%s' "${STATUS}" | grep -q '206'; then
  echo
  echo "OK: ${STATUS}"
  exit 0
fi

echo
echo "FAIL: expected HTTP 206 Partial Content, got: ${STATUS}" >&2
exit 1
