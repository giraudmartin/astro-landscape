#!/usr/bin/env python3
"""Offline PL anchors vs shipped VIIRS COG (no commercial atlases).

Checks zenith First Rig SQM windows from src/__tests__/plAnchors.test.ts.
DEM gates are browser-only (Mapterhorn) — this script is flat-site First Rig.

  python scripts/validate-pl-anchors.py
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

COG = Path("public/light-pollution/viirs-vnl-2024-500m.cog.tif")
MAX_KM = 300
ZLR_DIV = 66.89
NAT = 21.83

ANCHORS = [
    ("Mer de Glace", 45.9137, 6.9387, 21.15, 21.75),
    ("Paris centre", 48.8566, 2.3522, 17.6, 18.3),
    ("Spitzkoppe", -21.8247, 15.1983, 21.7, 21.85),
    ("Mauna Kea", 19.8207, -155.4681, 21.7, 21.9),
]


def mag_from_zlr(zlr: float) -> float:
    nat = 10 ** (-0.4 * NAT)
    art = zlr * 10 ** (-0.4 * 22.0)
    return math.log10(nat + art) / -0.4


def first_rig(ds, lat: float, lon: float) -> float:
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
    mask = (data >= 0.5) & (d <= MAX_KM) & np.isfinite(data)
    alpha = 2.47 * (dd / 350.0) ** 0.158
    wgt = dd ** (-alpha)
    S = float(np.sum(data[mask] * A[mask] * wgt[mask]))
    return mag_from_zlr(S / ZLR_DIV)


def main() -> None:
    if not COG.exists():
        raise SystemExit(f"missing {COG}")
    ds = rasterio.open(COG)
    failed = 0
    for name, lat, lon, lo, hi in ANCHORS:
        mag = first_rig(ds, lat, lon)
        ok = lo <= mag <= hi
        failed += 0 if ok else 1
        flag = "OK" if ok else "FAIL"
        print(f"{flag:4s} {name:16s} sqm={mag:5.2f} window=[{lo},{hi}]")
    if failed:
        raise SystemExit(f"{failed} anchor(s) outside window")
    print("all anchors OK (flat First Rig; DEM only in browser)")


if __name__ == "__main__":
    main()
