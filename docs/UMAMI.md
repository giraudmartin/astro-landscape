# Umami — first-party analytics (alpha)

Self-hosted on the same OVH VPS as Sphere. Dashboard is for you only;
visitors never need to open it.

| URL | Role |
|-----|------|
| `https://analytics.sadr3d.com` | Umami admin UI (login) |
| `https://sphere.sadr3d.com` | App; loads tracker when `VITE_UMAMI_WEBSITE_ID` is set |

## One-shot VPS setup

### 1. DNS

| Name | Type | Value |
|------|------|--------|
| `analytics` | A | `51.75.124.117` |

### 2. Docker Compose

```bash
mkdir -p ~/umami && cd ~/umami
# From the Sphere clone on the VPS, or scp from your laptop:
cp ~/sadr3d-sphere/astro-landscape/deploy/umami/docker-compose.yml .
cp ~/sadr3d-sphere/astro-landscape/deploy/umami/.env.example .env
nano .env   # strong POSTGRES_PASSWORD + APP_SECRET=$(openssl rand -hex 32)

docker compose up -d
docker compose ps   # umami healthy on 127.0.0.1:3100
```

Default login: `admin` / `umami` — **change the password immediately**.

### 3. Caddy

Merge the `analytics.sadr3d.com` block from
[`deploy/Caddyfile.sadr3d.example`](../deploy/Caddyfile.sadr3d.example)
into `/etc/caddy/Caddyfile`. Also refresh Sphere’s CSP (`script-src` must allow
`https://analytics.sadr3d.com`).

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 4. Create the website in Umami

1. Open `https://analytics.sadr3d.com` → log in.
2. **Add website** → domain `sphere.sadr3d.com`.
3. Copy the **Website ID** (UUID).

### 5. Wire Sphere build

On the VPS, create or edit `~/sadr3d-sphere/astro-landscape/.env.production`
(gitignored; survives deploy `git reset`):

```dotenv
VITE_UMAMI_SCRIPT_URL=https://analytics.sadr3d.com/script.js
VITE_UMAMI_WEBSITE_ID=paste-uuid-here
```

Redeploy Sphere (`bash scripts/deploy-sphere.sh` or Actions). Without
`VITE_UMAMI_WEBSITE_ID`, the app ships with tracker **off**.

## Events (custom)

Pageviews are automatic. Product events (no coords, no PII):

| Name | When | Props |
|------|------|--------|
| `immersive_enter` | Enter immersive (ground) view | — |
| `immersive_exit` | Leave immersive back to map | — |
| `spot_save` | Save a personal spot | — |
| `framing_save` | Save / update a framing | `is_new` |
| `bug_report` | Bug form submitted successfully | — |
| `onboarding_tour_done` | Map or immersive guide closed | `reason`, `half` |
| `pl_heatmap_toggle` | PL heatmap on/off | `enabled` |
| `basemap_change` | Basemap mode changed | `mode` |
| `map_3d_toggle` | Map 2D/3D tilt toggled | `enabled` |
| `locate_me` | GPS “Locate me” succeeded | — |
| `place_search` | Fly to an address search result | — |
| `terrain_quality_choose` | Terrain quality picked (dialog) | `quality` |
| `settings_open` | Settings panel opened | — |
| `my_spots_open` | My spots rail/sheet opened | — |
| `framings_open` | Framings rail/sheet opened | — |

## Ops

```bash
cd ~/umami
docker compose pull
docker compose up -d
docker compose logs -f umami
```

Back up the Docker volume `umami_umami-db-data` (or the compose project name’s
`umami-db-data`) with your usual VPS backup routine.

## Privacy

Keep Settings → Confidentialité and [`PRIVACY.md`](./PRIVACY.md) in sync: this
is **first-party** audience measurement on our server (no ad network, no user
accounts). Do not enable session replay or third-party drains without updating
those texts.
