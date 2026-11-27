#!/usr/bin/env python3
"""
Slice a NASA-layout equirect OpenEXR into immersive milky-way EXR tiles.

Layout (same as NASA SVS #4851 / public/sky/tiles/milkyway):
  - equirect ICRF/J2000
  - 0 h RA at image center, RA increases left, NCP at top
  - tile grid: cols = 2^(z+1), rows = 2^z, tileSize 1024
  - default maxZ=1 → z0 2048×1024, z1 4096×2048

Expects a flattened RGB (or BGR-ordered channels named R/G/B) half/float EXR.
No display-referred uint16 scale — values stay in linear HDR.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import Imath
import numpy as np
import OpenEXR

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "public" / "sky" / "tiles" / "milkyway"
DEFAULT_MANIFEST = ROOT / "public" / "sky" / "tiles" / "manifest.json"
TILE_SIZE = 1024


def load_exr_rgb(path: Path) -> np.ndarray:
  """Load flattened RGB EXR as float32 HxWx3 (clips tiny negatives)."""
  f = OpenEXR.File(str(path), False)
  if not f.parts:
    raise SystemExit(f"{path}: no EXR parts")
  part = f.parts[0]
  channels = part.channels
  if "RGB" in channels:
    rgb = np.asarray(channels["RGB"].pixels, dtype=np.float32)
  elif "R" in channels and "G" in channels and "B" in channels:
    r = np.asarray(channels["R"].pixels, dtype=np.float32)
    g = np.asarray(channels["G"].pixels, dtype=np.float32)
    b = np.asarray(channels["B"].pixels, dtype=np.float32)
    rgb = np.stack([r, g, b], axis=-1)
  else:
    raise SystemExit(
      f"{path}: need RGB or R/G/B channels, got {sorted(channels.keys())}"
    )
  if rgb.ndim != 3 or rgb.shape[2] < 3:
    raise SystemExit(f"{path}: expected HxWx3, got {rgb.shape}")
  np.maximum(rgb, 0.0, out=rgb)
  return rgb


def box_downsample_tile(
  src: np.ndarray,
  x0: int,
  y0: int,
  factor: int,
  tile: int,
) -> np.ndarray:
  block = src[y0 : y0 + tile * factor, x0 : x0 + tile * factor]
  if block.shape[0] != tile * factor or block.shape[1] != tile * factor:
    raise RuntimeError(
      f"tile window shape {block.shape} != {(tile * factor, tile * factor, 3)}"
    )
  return block.reshape(tile, factor, tile, factor, block.shape[2]).mean(
    axis=(1, 3)
  )


def write_exr_half_zip(path: Path, rgb: np.ndarray) -> None:
  h, w, _ = rgb.shape
  header = OpenEXR.Header(w, h)
  half = Imath.PixelType(Imath.PixelType.HALF)
  header["channels"] = {
    "R": Imath.Channel(half),
    "G": Imath.Channel(half),
    "B": Imath.Channel(half),
  }
  header["compression"] = Imath.Compression(Imath.Compression.ZIP_COMPRESSION)
  path.parent.mkdir(parents=True, exist_ok=True)
  out = OpenEXR.OutputFile(str(path), header)
  try:
    out.writePixels(
      {
        "R": rgb[:, :, 0].astype(np.float16).tobytes(),
        "G": rgb[:, :, 1].astype(np.float16).tobytes(),
        "B": rgb[:, :, 2].astype(np.float16).tobytes(),
      }
    )
  finally:
    out.close()


def grid_for_z(z: int) -> tuple[int, int]:
  return 2 ** (z + 1), 2**z


def slice_level(src: np.ndarray, out_root: Path, z: int) -> None:
  cols, rows = grid_for_z(z)
  src_h, src_w = src.shape[0], src.shape[1]
  out_w, out_h = cols * TILE_SIZE, rows * TILE_SIZE
  if src_w % out_w != 0 or src_h % out_h != 0:
    raise SystemExit(
      f"source {src_w}×{src_h} not divisible into z{z} atlas {out_w}×{out_h}"
    )
  fx = src_w // out_w
  fy = src_h // out_h
  if fx != fy:
    raise SystemExit(f"non-square downsample z{z}: fx={fx} fy={fy}")
  factor = fx
  folder = out_root / f"z{z}"
  folder.mkdir(parents=True, exist_ok=True)
  for ty in range(rows):
    for tx in range(cols):
      x0 = tx * TILE_SIZE * factor
      y0 = ty * TILE_SIZE * factor
      rgb = box_downsample_tile(src, x0, y0, factor, TILE_SIZE)
      dest = folder / f"{tx}_{ty}.exr"
      write_exr_half_zip(dest, rgb)
      print(
        f"  z{z} {tx}_{ty}.exr  "
        f"min={rgb.min():.5g} max={rgb.max():.5g} mean={rgb.mean():.5g}  "
        f"({dest.stat().st_size} bytes)",
        flush=True,
      )


def patch_manifest(
  manifest_path: Path,
  layer: str,
  width: int,
  height: int,
  max_z: int,
  source_name: str,
) -> None:
  data = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
  layers = data.setdefault("layers", {})
  layers[layer] = {
    "layer": layer,
    "source": source_name,
    "width": width,
    "height": height,
    "tileSize": TILE_SIZE,
    "maxZ": max_z,
    "minZ": 0,
  }
  manifest_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
  print(f"manifest ← layers.{layer}", flush=True)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("exr", type=Path, help="NASA-layout flattened equirect EXR")
  parser.add_argument(
    "--out",
    type=Path,
    default=DEFAULT_OUT,
    help=f"tile root (default {DEFAULT_OUT})",
  )
  parser.add_argument("--layer", default="milkyway")
  parser.add_argument("--max-z", type=int, default=1)
  parser.add_argument(
    "--manifest",
    type=Path,
    default=DEFAULT_MANIFEST,
    help="patch this manifest with the new layer entry",
  )
  parser.add_argument(
    "--no-manifest",
    action="store_true",
    help="do not edit manifest.json",
  )
  args = parser.parse_args()

  if not args.exr.is_file():
    raise SystemExit(f"missing EXR: {args.exr}")

  print(f"source {args.exr}", flush=True)
  src = load_exr_rgb(args.exr)
  print(
    f"loaded shape={src.shape} dtype={src.dtype} "
    f"min={src.min():.5g} max={src.max():.5g} mean={src.mean():.5g}",
    flush=True,
  )

  args.out.mkdir(parents=True, exist_ok=True)
  for z in range(0, args.max_z + 1):
    print(f"slicing z{z}…", flush=True)
    slice_level(src, args.out, z)

  if not args.no_manifest:
    patch_manifest(
      args.manifest,
      args.layer,
      width=int(src.shape[1]),
      height=int(src.shape[0]),
      max_z=args.max_z,
      source_name=args.exr.name,
    )

  print("done", flush=True)


if __name__ == "__main__":
  try:
    main()
  except KeyboardInterrupt:
    sys.exit(130)
