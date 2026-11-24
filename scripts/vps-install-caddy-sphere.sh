#!/usr/bin/env bash
# Merge Sphere site block into /etc/caddy/Caddyfile and reload.
# Safe: backup, validate, then reload. Idempotent if marker present.
set -euo pipefail

CADDY_FILE="${CADDY_FILE:-/etc/caddy/Caddyfile}"
MARKER="# --- sadr3d-sphere (managed) ---"
DATA_ROOT="/home/ubuntu/sadr3d-sphere/data"
WEB_ROOT="/var/www/sadr3d-sphere"

if [[ ! -f "${CADDY_FILE}" ]]; then
  echo "Missing ${CADDY_FILE}" >&2
  exit 1
fi

if sudo grep -qF "${MARKER}" "${CADDY_FILE}"; then
  echo "==> Sphere block already present — skipping insert"
else
  echo "==> Backup Caddyfile"
  sudo cp -a "${CADDY_FILE}" "${CADDY_FILE}.bak.$(date +%Y%m%d%H%M%S)"

  echo "==> Append Sphere block"
  sudo tee -a "${CADDY_FILE}" >/dev/null <<EOF

${MARKER}
# Temporary host until DNS for sphere.sadr3d.com propagates:
# access via http://IP/ with Host header, or add the domain when ready.
http://sphere.sadr3d.com, sphere.sadr3d.com {
	encode gzip zstd

	handle /light-pollution/* {
		root * ${DATA_ROOT}
		file_server
	}

	handle {
		root * ${WEB_ROOT}
		try_files {path} /index.html
		file_server
	}
}
# --- end sadr3d-sphere ---
EOF
fi

echo "==> Validate Caddy"
sudo caddy validate --config "${CADDY_FILE}"

echo "==> Reload Caddy"
sudo systemctl reload caddy

echo "==> Horizon smoke (must still work)"
curl -sf -o /dev/null -w "horizon_www HTTP %{http_code}\n" http://127.0.0.1/ || \
  curl -sf -o /dev/null -w "horizon_www HTTP %{http_code}\n" -H "Host: 51.75.124.117" http://127.0.0.1/ || true
curl -sf "http://127.0.0.1:3000/health" && echo || echo "WARNING: API /health failed"

echo "==> Sphere COG Range (local via Host header)"
# May 404 until COG uploaded; Range 206 when present.
CODE="$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Host: sphere.sadr3d.com" \
  -H "Range: bytes=0-15" \
  "http://127.0.0.1/light-pollution/viirs-vnl-2024-500m.cog.tif" || true)"
echo "sphere COG Range → HTTP ${CODE} (expect 206 with file, 404 without)"

echo "==> Caddy Sphere install OK"
