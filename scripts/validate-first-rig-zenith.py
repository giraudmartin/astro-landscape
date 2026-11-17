#!/usr/bin/env python3
"""Offline First Rig zenith check against the shipped VIIRS 500 m COG.

Usage (from repo root):
  python scripts/validate-first-rig-zenith.py

Treats int16 DN as nW (ignores GeoTIFF Scale=10 — see docs/LIGHT_POLLUTION.md).
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

COG = Path("public/light-pollution/viirs-vnl-2024-500m.cog.tif")
MAX_KM = 300
ALPHA_SCALE = 2.47
ALPHA_POWER = 0.158
ZLR_DIV = 66.89
NAT_MAG = 21.83
BG = 0.5

SITES = {
    "Mer de Glace": (45.879, 6.932, 21.7),
    "Chamonix": (45.9237, 6.8694, 20.9),
    "Paris": (48.8566, 2.3522, 18.13),
    "Spitzkoppe": (-21.8247, 15.1983, 21.99),
    "Tokyo": (35.6762, 139.6503, 17.66),
}


def mag_from_zlr(zlr: float) -> float:
    nat = 10 ** (-0.4 * NAT_MAG)
    art = zlr * 10 ** (-0.4 * 22.0)
    return math.log10(nat + art) / -0.4


def first_rig(ds, lat: float, lon: float):
    dlat = MAX_KM / 111.32
    coslat = max(0.2, math.cos(math.radians(lat)))
    dlon = MAX_KM / (111.32 * coslat)
    win = from_bounds(lon - dlon, lat - dlat, lon + dlon, lat + dlat, ds.transform)
    data = ds.read(1, window=win, boundless=True, fill_value=ds.nodata).astype(np.float64)
    data[data == ds.nodata] = np.nan
    data[data < 0] = np.nan
    transform = ds.window_transform(win)
    h, w = data.shape
    rows, cols = np.indices((h, w))
    xs, ys = rasterio.transform.xy(transform, rows, cols, offset="center")
    xs = np.asarray(xs, dtype=np.float64).reshape(h, w)
    ys = np.asarray(ys, dtype=np.float64).reshape(h, w)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    lat2 = np.radians(ys)
    lon2 = np.radians(xs)
    a = (
        np.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    )
    d = 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    res = abs(ds.res[0])
    A = (res * 111.32) * (res * 111.32 * np.maximum(0.05, np.cos(lat2)))
    min_d = max(0.2, res * 111.32 * 0.5)
    dd = np.maximum(d, min_d)
    mask = (data >= BG) & (d <= MAX_KM) & np.isfinite(data)
    alpha = ALPHA_SCALE * (dd / 350.0) ** ALPHA_POWER
    wgt = dd ** (-alpha)
    S = float(np.sum(data[mask] * A[mask] * wgt[mask]))
    zlr = S / ZLR_DIV
    return mag_from_zlr(zlr), zlr, S, int(mask.sum())


def main() -> None:
    if not COG.exists():
        raise SystemExit(f"missing {COG}")
    ds = rasterio.open(COG)
    print(f"COG scale tag={ds.scales} (ignored — DN as nW)")
    print(f"{'site':16s} {'model':>6} {'target':>6} {'dMag':>6}  ZLR")
    for name, (lat, lon, target) in SITES.items():
        mag, zlr, _S, _n = first_rig(ds, lat, lon)
        print(f"{name:16s} {mag:6.2f} {target:6.2f} {mag - target:+6.2f}  {zlr:7.3f}")


if __name__ == "__main__":
    main()
