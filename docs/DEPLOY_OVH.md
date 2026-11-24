# Sadr3D Sphere — OVH VPS deploy (same machine as Horizon)

**Architecture (locked)**  
- **Horizon** (Photo Sightline): existing VPS stack — front `/var/www/photo-sightline`, NestJS API, PostGIS, LiDAR/RGE. Deploy: GitHub Action → SSH → `scripts/deploy-alpha.sh`. Domain: `horizon.sadr3d.com`.  
- **Sphere** (this repo): static Vite build via Caddy on the **same** VPS. Deploy: GitHub Action → SSH → `scripts/deploy-sphere.sh`. Domain: `sphere.sadr3d.com`.  
- VIIRS COG (~64 Mo): served **as-is** (no pre-tiling) from a **persistent** directory outside the web publish tree.

No Vercel / Blob path for Sphere.

## Layout on the VPS

```text
/home/ubuntu/sadr3d-sphere/
  astro-landscape/                 # git clone of this repo
  data/light-pollution/
    viirs-vnl-2024-500m.cog.tif    # upload once (~64 Mo), never wiped by deploy
/var/www/sadr3d-sphere/            # Vite dist (rsync --delete each deploy)
```

Caddy maps:

| URL | Source |
|-----|--------|
| `https://sphere.sadr3d.com/` | `/var/www/sadr3d-sphere` |
| `https://sphere.sadr3d.com/light-pollution/*` | `/home/ubuntu/sadr3d-sphere/data/light-pollution/*` |

App default (see `src/lightPollution/cogConfig.ts`):  
`/light-pollution/viirs-vnl-2024-500m.cog.tif` — same-origin, works locally via `public/light-pollution/` and in prod via Caddy. Optional override: `VITE_LIGHT_POLLUTION_COG_URL` (see `.env.example`).

## One-shot setup (do once on the VPS)

### 1. Clone + Node

```bash
mkdir -p ~/sadr3d-sphere/data/light-pollution
cd ~/sadr3d-sphere
git clone git@github.com:giraudmartin/astro-landscape.git astro-landscape
# or https + deploy key — same pattern as Horizon (docs in photo-sightline DEPLOY_ALPHA.md)
```

Reuse or add a GitHub deploy key for `astro-landscape` if the Horizon key is repo-scoped.

### 2. Place the COG (once)

From your laptop (file is gitignored):

```bash
scp public/light-pollution/viirs-vnl-2024-500m.cog.tif \
  ubuntu@51.75.124.117:~/sadr3d-sphere/data/light-pollution/
```

### 3. Publish dirs + sudoers

```bash
sudo mkdir -p /var/www/sadr3d-sphere
sudo chown caddy:caddy /var/www/sadr3d-sphere

sudo tee /etc/sudoers.d/sadr3d-sphere-deploy >/dev/null <<'EOF'
ubuntu ALL=(root) NOPASSWD: /usr/bin/rsync, /bin/mkdir, /usr/bin/chown
EOF
sudo chmod 440 /etc/sudoers.d/sadr3d-sphere-deploy
sudo visudo -cf /etc/sudoers.d/sadr3d-sphere-deploy
```

### 4. Caddy

Merge [`deploy/Caddyfile.sadr3d.example`](../deploy/Caddyfile.sadr3d.example) into `/etc/caddy/Caddyfile` (keep existing IP / Horizon API proxy rules that already work). Then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 5. DNS (registrar)

| Name | Type | Value |
|------|------|--------|
| `horizon` | A | `51.75.124.117` |
| `sphere` | A | `51.75.124.117` |
| (optional) | AAAA | `2001:41d0:305:2100::1:9b44` |

Wait for propagation; Caddy issues HTTPS certificates automatically.

### 6. GitHub Actions secrets (Sphere repo)

Same VPS as Horizon — reuse:

- `ALPHA_VPS_HOST` = `51.75.124.117`
- `ALPHA_VPS_USER` = `ubuntu`
- `ALPHA_VPS_SSH_KEY` = deploy private key (authorized on the VPS)

Workflow: [`.github/workflows/deploy-sphere.yml`](../.github/workflows/deploy-sphere.yml)  
A push/merge to `main` in **this** repo runs Sphere deploy only (does not call Horizon’s script).

### 7. First deploy

```bash
cd ~/sadr3d-sphere/astro-landscape
bash scripts/deploy-sphere.sh
```

Or **Actions → Deploy Sphere → Run workflow**.

## Smoke tests

### Range requests (COG)

```bash
bash scripts/check-cog-range.sh https://sphere.sadr3d.com/light-pollution/viirs-vnl-2024-500m.cog.tif
```

Expect `HTTP/2 206` (or `HTTP/1.1 206 Partial Content`).

### App

1. Open `https://sphere.sadr3d.com` — map loads.  
2. Enable PL heatmap — tiles paint (COG protocol).  
3. Drop a spot — Bortle card shows a class (zenith sample from COG).  
4. Hard-refresh / direct load of `/` — SPA loads (no React Router today; `try_files` still in place).

### Local unchanged

```bash
npm run dev
# COG at public/light-pollution/viirs-vnl-2024-500m.cog.tif (gitignored)
```

## Notes

- `rsync --delete` excludes `light-pollution/` under the web root; the real COG is only under `~/sadr3d-sphere/data/`.  
- Horizon deploy (`deploy-alpha.sh`) is unchanged and must not point at Sphere paths.  
- SPA: no client-side path router in Sphere today — only query flags.  
- Hosting cost stays on the fixed VPS when traffic grows (bandwidth within OVH plan).
