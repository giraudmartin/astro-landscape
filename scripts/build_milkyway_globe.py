#!/usr/bin/env python3
"""
Bake an equirect cover of the NASA SVS milky-way tiles for the MapLibre
globe backdrop (decorative, not the immersive LOD dome).

Uses z1 (4096×2048) when present, else falls back to z0.
Output: public/sky/milkyway_globe.webp
"""

from __future__ import annotations

from pathlib import Path

import Imath
import numpy as np
import OpenEXR
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TILE_ROOT = ROOT / "public" / "sky" / "tiles" / "milkyway"
OUT = ROOT / "public" / "sky" / "milkyway_globe.webp"

# Soft low-contrast Reinhard for a calm space backdrop.
EXPOSURE = 55.0
GAIN = 0.85
OUT_SIZE = (4096, 2048)


def load_exr(path: Path) -> np.ndarray:
  f = OpenEXR.InputFile(str(path))
  dw = f.header()["dataWindow"]
  w = dw.max.x - dw.min.x + 1
  h = dw.max.y - dw.min.y + 1
  pt = Imath.PixelType(Imath.PixelType.FLOAT)
  r = np.frombuffer(f.channel("R", pt), dtype=np.float32).reshape(h, w)
  g = np.frombuffer(f.channel("G", pt), dtype=np.float32).reshape(h, w)
  b = np.frombuffer(f.channel("B", pt), dtype=np.float32).reshape(h, w)
  return np.stack([r, g, b], axis=-1)


def stitch_level(z: int) -> np.ndarray:
  """NASA tile grid: cols = 2^(z+1), rows = 2^z."""
  cols = 2 ** (z + 1)
  rows = 2**z
  folder = TILE_ROOT / f"z{z}"
  row_imgs: list[np.ndarray] = []
  for y in range(rows):
    tiles = [load_exr(folder / f"{x}_{y}.exr") for x in range(cols)]
    row_imgs.append(np.concatenate(tiles, axis=1))
  return np.concatenate(row_imgs, axis=0)


def main() -> None:
  z = 1 if (TILE_ROOT / "z1" / "0_0.exr").exists() else 0
  full = stitch_level(z)
  tm = (full * EXPOSURE) / (1.0 + full * EXPOSURE)
  tm = np.clip(tm * GAIN, 0.0, 1.0)
  img = Image.fromarray((tm * 255.0).astype(np.uint8), mode="RGB")
  if img.size != OUT_SIZE:
    img = img.resize(OUT_SIZE, Image.Resampling.LANCZOS)
  OUT.parent.mkdir(parents=True, exist_ok=True)
  img.save(OUT, "WEBP", quality=95, method=6)
  print(f"z{z} → {OUT} {img.size[0]}×{img.size[1]} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
  main()
