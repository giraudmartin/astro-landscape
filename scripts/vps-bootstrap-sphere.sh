#!/usr/bin/env bash
# One-shot / idempotent Sphere prep on the OVH VPS (run as ubuntu).
# Does not merge to main / does not trigger GitHub deploy.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/sadr3d-sphere/astro-landscape}"
DATA_DIR="${DATA_DIR:-/home/ubuntu/sadr3d-sphere/data/light-pollution}"
WEB_DIST_DIR="${WEB_DIST_DIR:-/var/www/sadr3d-sphere}"
COG_FILE="${COG_FILE:-viirs-vnl-2024-500m.cog.tif}"
BRANCH="${BRANCH:-deploy/ovh-sphere}"
REPO_URL="${REPO_URL:-git@github.com:giraudmartin/astro-landscape.git}"

echo "==> Dirs"
mkdir -p "$(dirname "${REPO_DIR}")" "${DATA_DIR}"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "==> Clone ${REPO_URL} (${BRANCH})"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${REPO_DIR}" \
    || git clone "${REPO_URL}" "${REPO_DIR}"
fi

echo "==> Sync branch ${BRANCH}"
cd "${REPO_DIR}"
git fetch origin
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"

echo "==> Web publish dir ${WEB_DIST_DIR}"
sudo mkdir -p "${WEB_DIST_DIR}"
sudo chown caddy:caddy "${WEB_DIST_DIR}"

echo "==> Sudoers for Sphere deploy"
sudo tee /etc/sudoers.d/sadr3d-sphere-deploy >/dev/null <<'EOF'
ubuntu ALL=(root) NOPASSWD: /usr/bin/rsync, /bin/mkdir, /usr/bin/chown
EOF
sudo chmod 440 /etc/sudoers.d/sadr3d-sphere-deploy
sudo visudo -cf /etc/sudoers.d/sadr3d-sphere-deploy

COG_PATH="${DATA_DIR}/${COG_FILE}"
if [[ -f "${COG_PATH}" ]]; then
  echo "==> COG present ($(du -h "${COG_PATH}" | awk '{print $1}'))"
  # Readable by Caddy (www-data/caddy typically needs o+r or group).
  chmod 755 "$(dirname "${DATA_DIR}")" "${DATA_DIR}" || true
  chmod 644 "${COG_PATH}"
  # Ensure caddy can traverse home if needed — prefer ACL if available.
  if id caddy >/dev/null 2>&1; then
    if command -v setfacl >/dev/null 2>&1; then
      setfacl -m u:caddy:--x /home/ubuntu || true
      setfacl -R -m u:caddy:rX /home/ubuntu/sadr3d-sphere/data || true
    fi
    sudo -u caddy test -r "${COG_PATH}" \
      && echo "OK: caddy can read COG" \
      || echo "WARNING: caddy cannot read ${COG_PATH} yet"
  fi
else
  echo "WARNING: missing ${COG_PATH}"
  echo "Upload with: scp public/light-pollution/${COG_FILE} ubuntu@HOST:${DATA_DIR}/"
fi

echo "==> Bootstrap OK (Caddy site block still needs merge — see deploy/Caddyfile.sadr3d.example)"
