#!/usr/bin/env python3
"""
Slice a NASA-layout equirect TIFF into immersive milky-way EXR tiles.

Layout (same as NASA SVS #4851 / existing public/sky/tiles/milkyway):
  - equirect ICRF/J2000
  - 0 h RA at image center, RA increases left, NCP at top
  - tile grid: cols = 2^(z+1), rows = 2^z, tileSize 1024
  - default maxZ=1 → z0 2048×1024, z1 4096×2048

Writes beside the shipping tiles by default (milkyway-neb), so A/B is safe.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import Imath
import numpy as np
import OpenEXR
import tifffile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "public" / "sky" / "tiles" / "milkyway"
DEFAULT_MANIFEST = ROOT / "public" / "sky" / "tiles" / "manifest.json"
TILE_SIZE = 1024


def memmap_contiguous_tiff(path: Path) -> np.memmap:
  with tifffile.TiffFile(path) as tiff:
    page = tiff.pages[0]
    if not page.is_contiguous:
      raise SystemExit(f"{path}: TIFF must be uncompressed / contiguous for memmap")
    offset = int(page.dataoffsets[0])
    shape = tuple(int(x) for x in page.shape)
    dtype = np.dtype(page.dtype)
  return np.memmap(path, dtype=dtype, mode="r", offset=offset, shape=shape)


def box_downsample_tile(
  src: np.ndarray,
  x0: int,
  y0: int,
  factor: int,
  tile: int,
) -> np.ndarray:
  """Average a (tile*factor)² source window into tile×tile float32 RGB in 0..1."""
  block = np.asarray(
    src[y0 : y0 + tile * factor, x0 : x0 + tile * factor],
    dtype=np.float32,
  )
  if block.shape[0] != tile * factor or block.shape[1] != tile * factor:
    raise RuntimeError(
      f"tile window shape {block.shape} != {(tile * factor, tile * factor, 3)}"
    )
  # (ty, fy, tx, fx, c) → mean over fy, fx
  out = block.reshape(tile, factor, tile, factor, block.shape[2]).mean(axis=(1, 3))
  if src.dtype == np.uint16:
    out /= 65535.0
  elif src.dtype == np.uint8:
    out /= 255.0
  elif np.issubdtype(src.dtype, np.floating):
    pass
  else:
    raise SystemExit(f"unsupported TIFF dtype {src.dtype}")
  return out


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


def slice_level(src: np.ndarray, out_root: Path, z: int, scale: float) -> None:
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
      if scale != 1.0:
        rgb *= scale
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
  parser.add_argument("tiff", type=Path, help="NASA-layout equirect TIFF")
  parser.add_argument(
    "--out",
    type=Path,
    default=DEFAULT_OUT,
    help=f"tile root (default {DEFAULT_OUT})",
  )
  parser.add_argument("--layer", default="milkyway")
  parser.add_argument("--max-z", type=int, default=1)
  parser.add_argument(
    "--scale",
    type=float,
    default=1.0,
    help="extra multiplier after uint16→0..1 (tune vs MILKY_WAY_EXPOSURE)",
  )
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

  if not args.tiff.is_file():
    raise SystemExit(f"missing TIFF: {args.tiff}")

  print(f"source {args.tiff}", flush=True)
  src = memmap_contiguous_tiff(args.tiff)
  print(f"memmap shape={src.shape} dtype={src.dtype}", flush=True)
  if src.ndim != 3 or src.shape[2] < 3:
    raise SystemExit(f"expected HxWx3+ RGB, got {src.shape}")

  args.out.mkdir(parents=True, exist_ok=True)
  for z in range(0, args.max_z + 1):
    print(f"slicing z{z}…", flush=True)
    slice_level(src, args.out, z, args.scale)

  if not args.no_manifest:
    patch_manifest(
      args.manifest,
      args.layer,
      width=int(src.shape[1]),
      height=int(src.shape[0]),
      max_z=args.max_z,
      source_name=args.tiff.name,
    )

  print("done", flush=True)


if __name__ == "__main__":
  try:
    main()
  except KeyboardInterrupt:
    sys.exit(130)
