#!/usr/bin/env bash
# OVH VPS deploy for Sadr3D Sphere — run on the server (or via GitHub Actions SSH).
# Publishes the Vite static build only. Does NOT replace the persistent VIIRS COG.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/sadr3d-sphere/astro-landscape}"
WEB_DIST_DIR="${WEB_DIST_DIR:-/var/www/sadr3d-sphere}"
COG_DATA_DIR="${COG_DATA_DIR:-/home/ubuntu/sadr3d-sphere/data/light-pollution}"
COG_FILE="${COG_FILE:-viirs-vnl-2024-500m.cog.tif}"
BRANCH="${DEPLOY_BRANCH:-main}"

echo "==> Deploy Sphere (${BRANCH}) in ${REPO_DIR}"
cd "${REPO_DIR}"

echo "==> Sync git"
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"

echo "==> npm ci"
npm ci

echo "==> Build (tsc + vite)"
# Default COG URL is /light-pollution/... (same-origin). Optional override via
# repo-root .env.production on the server (not in git).
npm run build

echo "==> Publish web → ${WEB_DIST_DIR}"
sudo mkdir -p "${WEB_DIST_DIR}"
# --delete refreshes the SPA; COG lives outside this tree (Caddy handle).
# --delay-updates writes into a temp name then renames, shrinking the window
# where index.html already points at hashes not yet fully on disk.
sudo rsync -a --delete --delay-updates \
  --exclude 'light-pollution/' \
  dist/ "${WEB_DIST_DIR}/"
sudo chown -R caddy:caddy "${WEB_DIST_DIR}"

echo "==> COG check (persistent, outside dist)"
COG_PATH="${COG_DATA_DIR}/${COG_FILE}"
if [[ ! -f "${COG_PATH}" ]]; then
  echo "WARNING: missing ${COG_PATH}" >&2
  echo "Copy the VIIRS COG once to that path (see docs/DEPLOY_OVH.md)." >&2
else
  echo "COG present: ${COG_PATH} ($(du -h "${COG_PATH}" | awk '{print $1}'))"
fi

echo "==> Deploy OK"
