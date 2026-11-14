#!/usr/bin/env python3
"""
Bake a downsampled Cloud-Optimized GeoTIFF of nighttime radiance for Bortle.

Preferred input: EOG VIIRS VNL average_masked (true nW/cm²/sr).
Fallback: NASA GIBS Black Marble → glow→radiance proxy (no EOG login).

Output:
  public/light-pollution/viirs-vnl-average-masked.cog.tif

Usage:
  python scripts/build-viirs-bortle-cog-rasterio.py --from-gibs
  python scripts/build-viirs-bortle-cog-rasterio.py --input path/to/average_masked.tif
  python scripts/build-viirs-bortle-cog-rasterio.py --download
"""

from __future__ import annotations

import argparse
import gzip
import math
import shutil
import ssl
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import calculate_default_transform, reproject

ROOT = Path(__file__).resolve().parents[1]
OUT_DEFAULT = ROOT / "public" / "light-pollution" / "viirs-vnl-average-masked.cog.tif"

DEFAULT_URL = (
    "https://eogdata.mines.edu/nighttime_light/annual/v22/2021/"
    "VNL_v22_npp_2021_global_vcmslcfg_c202205302300.average_masked.tif.gz"
)

# Match src/lightPollution/bortleFromRadiance.ts + tiles.ts
BLACK_MARBLE_LUMA_FLOOR = 0.155
GIBS_YEAR = "2016-01-01"
GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"

# VNL coverage
WEST, SOUTH, EAST, NORTH = -180.0, -65.0, 180.0, 75.0


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}", flush=True)
    print(f"→ {dest}", flush=True)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "astro-landscape-cog-bake/1.1"},
    )
    with urllib.request.urlopen(req, timeout=600, context=_ssl_context()) as resp, open(
        dest, "wb"
    ) as out:
        shutil.copyfileobj(resp, out)
    return dest


def gunzip(src: Path, dest: Path) -> Path:
    print(f"Decompressing {src.name}…", flush=True)
    with gzip.open(src, "rb") as f_in, open(dest, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    return dest


def glow_from_rgb(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Vectorized glowFromBlackMarbleRgb (channels 0…1)."""
    avg = (r + g + b) / 3.0
    blue_dom = (b >= r - 0.02) & (b >= g - 0.02)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    excess = (luma - BLACK_MARBLE_LUMA_FLOOR) / (1.0 - BLACK_MARBLE_LUMA_FLOOR)
    glow = np.clip(excess, 0.0, 1.0)
    glow = np.where(blue_dom & (avg < 0.28), 0.0, glow)
    return glow.astype(np.float32)


def radiance_from_glow(glow: np.ndarray) -> np.ndarray:
    """Vectorized radianceFromBlackMarbleGlow."""
    g = np.clip(glow, 0.0, 1.0)
    out = np.power(g, 1.25) * 18.0
    out = np.where(g < 0.01, 0.0, out)
    return out.astype(np.float32)


def fetch_gibs_strip(lon0: float, lon1: float, width: int, height: int) -> np.ndarray:
    # WMS 1.3.0 + EPSG:4326 → BBOX = lat_min,lon_min,lat_max,lon_max
    bbox = f"{SOUTH},{lon0},{NORTH},{lon1}"
    url = (
        f"{GIBS_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
        f"&LAYERS=VIIRS_Black_Marble&STYLES=&CRS=EPSG:4326"
        f"&BBOX={bbox}&WIDTH={width}&HEIGHT={height}"
        f"&FORMAT=image/png&TIME={GIBS_YEAR}"
    )
    req = urllib.request.Request(
        url, headers={"User-Agent": "astro-landscape-cog-bake/1.1"}
    )
    with urllib.request.urlopen(req, timeout=180, context=_ssl_context()) as resp:
        data = resp.read()
    im = Image.open(__import__("io").BytesIO(data)).convert("RGBA")
    arr = np.asarray(im, dtype=np.float32) / 255.0
    return arr


def build_cog_from_gibs(out_cog: Path, res_deg: float) -> None:
    out_cog.parent.mkdir(parents=True, exist_ok=True)
    width = int(round((EAST - WEST) / res_deg))
    height = int(round((NORTH - SOUTH) / res_deg))
    print(
        f"GIBS Black Marble → radiance proxy @ {res_deg}° → {width}x{height}",
        flush=True,
    )

    # Fetch in lon strips (GIBS caps ~4k on a side).
    strip_w = min(1800, width)
    n_strips = int(math.ceil(width / strip_w))
    dest = np.zeros((height, width), dtype=np.float32)

    col = 0
    for i in range(n_strips):
        w = min(strip_w, width - col)
        lon0 = WEST + col * res_deg
        lon1 = WEST + (col + w) * res_deg
        print(f"  strip {i + 1}/{n_strips}: lon [{lon0:.2f},{lon1:.2f}] {w}x{height}", flush=True)
        rgba = fetch_gibs_strip(lon0, lon1, w, height)
        if rgba.shape[0] != height or rgba.shape[1] != w:
            rgba = np.array(
                Image.fromarray((rgba * 255).astype(np.uint8)).resize(
                    (w, height), Image.Resampling.BILINEAR
                ),
                dtype=np.float32,
            ) / 255.0
        r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
        dest[:, col : col + w] = radiance_from_glow(glow_from_rgb(r, g, b))
        col += w

    transform = from_bounds(WEST, SOUTH, EAST, NORTH, width, height)
    profile = {
        "driver": "COG",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:4326",
        "transform": transform,
        "nodata": 0,
        "compress": "deflate",
        "blocksize": 256,
        "predictor": 2,
        "overview_resampling": "average",
    }
    print(f"Writing COG {out_cog}…", flush=True)
    with rasterio.open(out_cog, "w", **profile) as dst:
        dst.write(dest, 1)
        dst.update_tags(
            source="NASA GIBS VIIRS_Black_Marble → radiance proxy",
            note="EOG average_masked preferred when available; this unlocks COG path without login",
            year=GIBS_YEAR,
        )
    size_mb = out_cog.stat().st_size / (1024 * 1024)
    print(f"Wrote {out_cog} ({size_mb:.1f} MB)", flush=True)


def build_cog(src_tif: Path, out_cog: Path, res_deg: float) -> None:
    out_cog.parent.mkdir(parents=True, exist_ok=True)
    print(f"Reading {src_tif}…", flush=True)
    with rasterio.open(src_tif) as src:
        print(
            f"  size={src.width}x{src.height} crs={src.crs} dtype={src.dtypes[0]}",
            flush=True,
        )
        dst_crs = "EPSG:4326"
        src_crs = src.crs or dst_crs
        transform, width, height = calculate_default_transform(
            src_crs,
            dst_crs,
            src.width,
            src.height,
            *src.bounds,
            resolution=res_deg,
        )
        print(
            f"Warping → {width}x{height} @ {res_deg}° "
            f"(~{(width * height * 4) / 1e6:.0f} MB float buffer)…",
            flush=True,
        )
        dest = np.zeros((height, width), dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1),
            destination=dest,
            src_transform=src.transform,
            src_crs=src_crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            resampling=Resampling.average,
            src_nodata=src.nodata,
            dst_nodata=0,
        )

        np.nan_to_num(dest, copy=False, nan=0.0, posinf=0.0, neginf=0.0)
        dest[dest < 0] = 0

        profile = {
            "driver": "COG",
            "height": height,
            "width": width,
            "count": 1,
            "dtype": "float32",
            "crs": dst_crs,
            "transform": transform,
            "nodata": 0,
            "compress": "deflate",
            "blocksize": 256,
            "predictor": 2,
            "overview_resampling": "average",
        }
        print(f"Writing COG {out_cog}…", flush=True)
        with rasterio.open(out_cog, "w", **profile) as dst:
            dst.write(dest, 1)
            dst.update_tags(
                source="EOG VIIRS VNL average_masked",
                note="Downsampled for astro-landscape Bortle scouting",
            )

    size_mb = out_cog.stat().st_size / (1024 * 1024)
    print(f"Wrote {out_cog} ({size_mb:.1f} MB)", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Local GeoTIFF (or .tif.gz)")
    parser.add_argument("--url", default=DEFAULT_URL, help="EOG download URL")
    parser.add_argument(
        "--download",
        action="store_true",
        help="Download --url into a temp dir before baking (needs EOG account cookie)",
    )
    parser.add_argument(
        "--from-gibs",
        action="store_true",
        help="Bake radiance-proxy COG from NASA GIBS Black Marble (no EOG login)",
    )
    parser.add_argument("--out", type=Path, default=OUT_DEFAULT)
    parser.add_argument(
        "--res",
        type=float,
        default=0.05,
        help="Output resolution in degrees (default 0.05 ≈ 5 km)",
    )
    args = parser.parse_args()

    if args.from_gibs:
        build_cog_from_gibs(args.out, args.res)
        print("App samples this COG for Bortle when present (else live Black Marble).", flush=True)
        return 0

    with tempfile.TemporaryDirectory(prefix="viirs-bortle-") as tmp:
        tmp_path = Path(tmp)
        src = args.input
        if args.download or src is None:
            gz = tmp_path / "viirs.tif.gz"
            try:
                download(args.url, gz)
            except Exception as exc:
                print(
                    "Download failed (EOG requires a free account / OAuth cookie).\n"
                    "Options:\n"
                    "  1) Manual: https://eogdata.mines.edu/products/vnl/ → average_masked, then:\n"
                    "       python scripts/build-viirs-bortle-cog-rasterio.py --input your.tif\n"
                    "  2) No login: bake GIBS Black Marble radiance proxy:\n"
                    "       python scripts/build-viirs-bortle-cog-rasterio.py --from-gibs\n"
                    f"Error: {exc}",
                    file=sys.stderr,
                )
                return 1
            src = gunzip(gz, tmp_path / "viirs.tif")
        elif str(src).endswith(".gz"):
            src = gunzip(src, tmp_path / "viirs.tif")

        if not src or not src.exists():
            print("No input GeoTIFF.", file=sys.stderr)
            return 1

        build_cog(src, args.out, args.res)

    print(
        "App samples this COG for Bortle when present (else Black Marble).",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
