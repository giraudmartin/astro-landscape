#!/usr/bin/env python3
"""
Bake a reasonable-size Cloud-Optimized GeoTIFF from EOG VIIRS VNL
`average_masked` for Bortle sampling in the app.

Commercial-OK (EOG / Colorado School of Mines — public domain / free use with
attribution). Output is radiance in nW/cm²/sr (float32).

Usage:
  # With a local EOG download already:
  python scripts/build-viirs-bortle-cog.py --input path/to/average_masked.tif

  # Download latest known annual masked composite (needs network; ~250–300 MB):
  python scripts/build-viirs-bortle-cog.py --download

Requires: GDAL (`conda install -c conda-forge gdal` or OSGeo4W).

Default: downsample to 0.05° (~5 km) so the COG stays tens of MB — fine for
scouting Bortle, not for lamp-post precision.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

# 2021 annual masked (example; override with --input / --url).
DEFAULT_URL = (
    "https://eogdata.mines.edu/nighttime_light/annual/v22/2021/"
    "VNL_v22_npp_2021_global_vcmslcfg_c202205302300.average_masked.tif.gz"
)

ROOT = Path(__file__).resolve().parents[1]
OUT_DEFAULT = ROOT / "public" / "light-pollution" / "viirs-vnl-average-masked.cog.tif"


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd)


def which_gdal() -> None:
    try:
        subprocess.check_call(
            ["gdalinfo", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(
            "GDAL not found. Install with: conda install -c conda-forge gdal\n"
            f"({exc})"
        )


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}", flush=True)
    print(f"→ {dest}", flush=True)
    urllib.request.urlretrieve(url, dest)
    return dest


def gunzip(src: Path, dest: Path) -> Path:
    import gzip
    import shutil

    print(f"Decompressing {src.name}…", flush=True)
    with gzip.open(src, "rb") as f_in, open(dest, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    return dest


def build_cog(src_tif: Path, out_cog: Path, res_deg: float) -> None:
    out_cog.parent.mkdir(parents=True, exist_ok=True)
    warped = out_cog.with_suffix(".warp.tif")
    try:
        # Downsample + compress working copy
        run(
            [
                "gdalwarp",
                "-overwrite",
                "-t_srs",
                "EPSG:4326",
                "-tr",
                str(res_deg),
                str(res_deg),
                "-r",
                "average",
                "-co",
                "COMPRESS=DEFLATE",
                "-co",
                "TILED=YES",
                str(src_tif),
                str(warped),
            ]
        )
        run(
            [
                "gdal_translate",
                str(warped),
                str(out_cog),
                "-of",
                "COG",
                "-co",
                "COMPRESS=DEFLATE",
                "-co",
                "PREDICTOR=2",
                "-co",
                "BLOCKSIZE=256",
                "-co",
                "OVERVIEWS=IGNORE_EXISTING",
            ]
        )
    finally:
        if warped.exists():
            warped.unlink()

    size_mb = out_cog.stat().st_size / (1024 * 1024)
    print(f"Wrote {out_cog} ({size_mb:.1f} MB)", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Local GeoTIFF (or .tif.gz)")
    parser.add_argument("--url", default=DEFAULT_URL, help="EOG download URL")
    parser.add_argument(
        "--download",
        action="store_true",
        help="Download --url into a temp dir before baking",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=OUT_DEFAULT,
        help="Output COG path (served from Vite public/)",
    )
    parser.add_argument(
        "--res",
        type=float,
        default=0.05,
        help="Output resolution in degrees (default 0.05 ≈ 5 km)",
    )
    args = parser.parse_args()
    which_gdal()

    with tempfile.TemporaryDirectory(prefix="viirs-bortle-") as tmp:
        tmp_path = Path(tmp)
        src = args.input
        if args.download or src is None:
            gz = tmp_path / "viirs.tif.gz"
            try:
                download(args.url, gz)
            except Exception as exc:
                print(
                    "Download failed (EOG often needs a free account / cookie).\n"
                    "Manual: download average_masked from "
                    "https://eogdata.mines.edu/products/vnl/ then:\n"
                    f"  python scripts/build-viirs-bortle-cog.py --input your.tif\n"
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
        "App will sample this COG for Bortle when present "
        "(else falls back to Black Marble).",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
