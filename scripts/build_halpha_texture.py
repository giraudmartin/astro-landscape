#!/usr/bin/env python3
"""
Offline: NOIRLab WHAM/VTSS/SHASSA Hα (galactic equirect) → light ICRF/J2000
equirect texture matching the NASA SVS milky-way layout.

NASA layout (source EXR / tiles, before GPU flip):
  - 0 h RA at image center
  - RA increasing toward the left
  - NCP at top, SCP at bottom

Source: galactic 360°×180° equirect (l=0 at center, l increasing left, b=+90 top).
Credit: WHAM/VTSS/SHASSA/Douglas Finkbeiner — CC BY 4.0 (NOIRLab).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from PIL import Image

# Keep Pillow happy with the 10k TIFF.
Image.MAX_IMAGE_PIXELS = 60_000_000


def galactic_uv_to_lb(u_gal: np.ndarray, v_gal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
  """Galactic equirect UV → (l, b) radians. l=0 at u=0.5, l increases left."""
  l = (0.5 - u_gal) * (2.0 * np.pi)
  b = (0.5 - v_gal) * np.pi
  return l, b


def equatorial_xy_to_radec(
  x: np.ndarray,
  y: np.ndarray,
  width: int,
  height: int,
) -> tuple[np.ndarray, np.ndarray]:
  """Pixel centers → (RA, Dec) radians. 0h at center, RA increases left."""
  u_eq = (x + 0.5) / width
  v_eq = (y + 0.5) / height
  ra = (0.5 - u_eq) * (2.0 * np.pi)
  ra = np.mod(ra, 2.0 * np.pi)
  dec = (0.5 - v_eq) * np.pi
  return ra, dec


def sample_bilinear(image: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
  """Bilinear sample equirect RGB/float image; u wraps, v clamps."""
  h, w = image.shape[:2]
  x = u * w - 0.5
  y = np.clip(v * h - 0.5, 0.0, h - 1.001)
  x0 = np.floor(x).astype(np.int64)
  y0 = np.floor(y).astype(np.int64)
  x1 = x0 + 1
  y1 = np.minimum(y0 + 1, h - 1)
  fx = (x - x0).astype(np.float32)
  fy = (y - y0).astype(np.float32)
  x0 %= w
  x1 %= w

  channels = image.shape[2] if image.ndim == 3 else 1
  if image.ndim == 2:
    image = image[..., None]

  def take(xx: np.ndarray, yy: np.ndarray) -> np.ndarray:
    return image[yy, xx].astype(np.float32)

  c00 = take(x0, y0)
  c10 = take(x1, y0)
  c01 = take(x0, y1)
  c11 = take(x1, y1)
  top = c00 * (1.0 - fx)[..., None] + c10 * fx[..., None]
  bot = c01 * (1.0 - fx)[..., None] + c11 * fx[..., None]
  out = top * (1.0 - fy)[..., None] + bot * fy[..., None]
  return out.reshape(*u.shape, channels) if channels > 1 else out[..., 0]


def extract_emission(rgb: np.ndarray) -> np.ndarray:
  """
  Pull discrete Hα nebulae from the NOIRLab viz — bright knots only,
  no diffuse red wash (matches a crimson emission overlay look).
  """
  r = rgb[..., 0]
  g = rgb[..., 1]
  b = rgb[..., 2]
  # Red excess vs green/blue (kills grey/brown dust continuum).
  excess = np.maximum(0.0, r - 0.55 * g - 0.35 * b)

  # Aggressive floor: keep only the bright nebular cores / complexes.
  floor = float(np.percentile(excess, 88))
  signal = np.maximum(0.0, excess - floor)
  # Strong midtone crush → sparse glowing patches, not a fog.
  signal = np.power(signal, 1.65)

  # Soft highlight compression (cores stay readable, not clipped white).
  compressed = signal / (1.0 + 1.2 * signal)
  positive = compressed[compressed > 1e-6]
  peak = float(np.percentile(positive, 99.5)) if positive.size else 1.0
  peak = max(peak, 1e-4)
  out = np.clip(compressed / peak, 0.0, 1.0)
  # Hard zero background — shader must add nothing off-nebula.
  out[out < 0.04] = 0.0
  return out.astype(np.float32)


def reproject(
  galactic_rgb: np.ndarray,
  out_w: int,
  out_h: int,
  chunk_rows: int = 64,
) -> np.ndarray:
  emission_gal = extract_emission(galactic_rgb / 255.0)
  # Store RGB for debugging inspection, but G=B=R (single-channel signal).
  out = np.zeros((out_h, out_w), dtype=np.float32)

  for y0 in range(0, out_h, chunk_rows):
    y1 = min(out_h, y0 + chunk_rows)
    yy, xx = np.mgrid[y0:y1, 0:out_w]
    ra, dec = equatorial_xy_to_radec(xx, yy, out_w, out_h)
    eq = SkyCoord(ra=ra * u.rad, dec=dec * u.rad, frame="icrs")
    gal = eq.galactic
    l = gal.l.wrap_at(180 * u.deg).radian
    b = gal.b.radian
    u_gal = np.mod(0.5 - l / (2.0 * np.pi), 1.0)
    v_gal = np.clip(0.5 - b / np.pi, 0.0, 1.0)
    out[y0:y1] = sample_bilinear(emission_gal, u_gal, v_gal)

  return out


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument(
    "--input",
    type=Path,
    default=Path("raw-sky/wham_halpha.tiff"),
  )
  parser.add_argument(
    "--output",
    type=Path,
    default=Path("public/sky/halpha_j2000.webp"),
  )
  parser.add_argument("--width", type=int, default=4096)
  parser.add_argument("--height", type=int, default=2048)
  args = parser.parse_args()

  print(f"Loading {args.input}…")
  with Image.open(args.input) as im:
    galactic = np.asarray(im.convert("RGB"), dtype=np.uint8)
  print(f"Source {galactic.shape[1]}×{galactic.shape[0]} RGB")

  print(f"Reprojecting → {args.width}×{args.height} ICRF/J2000 equirect…")
  emission = reproject(galactic, args.width, args.height)

  # Encode R=emission, G=B=0 (shader reads .r). WebP keeps it light.
  pixels = np.clip(np.round(emission * 255.0), 0, 255).astype(np.uint8)
  rgb = np.zeros((args.height, args.width, 3), dtype=np.uint8)
  rgb[..., 0] = pixels
  args.output.parent.mkdir(parents=True, exist_ok=True)
  Image.fromarray(rgb, mode="RGB").save(
    args.output,
    format="WEBP",
    quality=90,
    method=6,
  )
  meta = {
    "projection": "icrf-j2000-equirect",
    "orientation": "RA 0h at center, RA increasing left, NCP at top",
    "width": args.width,
    "height": args.height,
    "source": {
      "id": "AllSky-17_Optical656nm-Halpha-WHAM-SHASSA-VTSS",
      "url": "https://noirlab.edu/public/images/AllSky-17_Optical656nm-Halpha-WHAM-SHASSA-VTSS/",
      "credit": "WHAM/VTSS/SHASSA/Douglas Finkbeiner",
      "license": "CC BY 4.0",
      "original_frame": "galactic equirectangular 360×180",
    },
    "processing": "red-excess extract, dark-red floor subtract, soft highlight compress; reprojected galactic→ICRS",
  }
  meta_path = args.output.with_suffix(".json")
  meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
  print(f"Wrote {args.output} ({args.output.stat().st_size} bytes)")
  print(f"Wrote {meta_path}")

  # Quick sanity: galactic center ≈ RA 17.76h Dec −28.9° → bright
  # and Orion ≈ RA 5.6h Dec −5° → bright; north galactic pole → dark.
  def probe(ra_h: float, dec_d: float) -> float:
    ra = (ra_h / 24.0) * 2.0 * np.pi
    dec = np.deg2rad(dec_d)
    u_eq = np.mod(0.5 - ra / (2.0 * np.pi), 1.0)
    v_eq = 0.5 - dec / np.pi
    x = int(u_eq * args.width) % args.width
    y = int(np.clip(v_eq, 0, 0.999) * args.height)
    return float(emission[y, x])

  print(
    "probes:",
    f"Sgr={probe(17.76, -29):.3f}",
    f"Ori={probe(5.6, -5):.3f}",
    f"NGP={probe(12.8, 27.1):.3f}",
    f"seam12hN={probe(12.0, 0):.3f}",
  )


if __name__ == "__main__":
  main()
