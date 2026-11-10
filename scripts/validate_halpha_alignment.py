#!/usr/bin/env python3
"""Mark known Hα targets on the reprojected texture for alignment checks."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

TARGETS = [
  ("Sgr / GC", 17.7611, -29.0078, (255, 220, 80)),
  ("M8 Lagoon", 18.0600, -24.3800, (255, 180, 120)),
  ("Orion M42", 5.588, -5.391, (120, 220, 255)),
  ("Horsehead", 5.679, -2.458, (180, 200, 255)),
  ("North America", 20.993, 44.333, (200, 255, 180)),
  ("RA 12h seam", 12.0, 0.0, (255, 100, 100)),
]


def ra_dec_to_xy(ra_h: float, dec_d: float, w: int, h: int) -> tuple[int, int]:
  ra = (ra_h / 24.0) * 2.0 * np.pi
  dec = np.deg2rad(dec_d)
  u = np.mod(0.5 - ra / (2.0 * np.pi), 1.0)
  v = 0.5 - dec / np.pi
  return int(u * w) % w, int(np.clip(v, 0.0, 0.999999) * h)


def crop_around(im: Image.Image, x: int, y: int, size: int = 512) -> Image.Image:
  w, h = im.size
  half = size // 2
  # Handle RA wrap for crops near the 12h seam.
  canvas = Image.new("RGB", (size, size))
  for dy in range(size):
    sy = min(max(y - half + dy, 0), h - 1)
    for dx in range(size):
      sx = (x - half + dx) % w
      canvas.putpixel((dx, dy), im.getpixel((sx, sy)))
  return canvas


def main() -> None:
  src = Path("public/sky/halpha_j2000.webp")
  out_dir = Path("raw-sky/validation")
  out_dir.mkdir(parents=True, exist_ok=True)
  im = Image.open(src).convert("RGB")
  # Boost for preview
  arr = np.asarray(im, dtype=np.float32)
  preview = np.clip(arr * 2.2, 0, 255).astype(np.uint8)
  preview[..., 1] = (preview[..., 0] * 0.30).astype(np.uint8)
  preview[..., 2] = (preview[..., 0] * 0.40).astype(np.uint8)
  full = Image.fromarray(preview, "RGB")
  draw = ImageDraw.Draw(full)
  w, h = full.size

  for name, ra, dec, color in TARGETS:
    x, y = ra_dec_to_xy(ra, dec, w, h)
    r = 18
    draw.ellipse((x - r, y - r, x + r, y + r), outline=color, width=2)
    draw.line((x - 28, y, x + 28, y), fill=color, width=1)
    draw.line((x, y - 28, x, y + 28), fill=color, width=1)
    draw.text((x + 22, y - 10), name, fill=color)
    crop = crop_around(full, x, y, 640)
    cdraw = ImageDraw.Draw(crop)
    cdraw.ellipse((320 - r, 320 - r, 320 + r, 320 + r), outline=color, width=2)
    cdraw.text((12, 12), f"{name}  RA={ra:.3f}h  Dec={dec:.2f}°", fill=color)
    safe = name.split()[0].lower().replace("/", "_")
    crop.save(out_dir / f"crop_{safe}.jpg", quality=92)
    print(f"{name}: xy=({x},{y}) peak={arr[y, x, 0]:.1f}")

  # Seam strip: left|right concatenated at Dec=0 band
  y0 = h // 2 - 64
  left = full.crop((0, y0, 128, y0 + 128))
  right = full.crop((w - 128, y0, w, y0 + 128))
  seam = Image.new("RGB", (256, 128))
  seam.paste(right, (0, 0))
  seam.paste(left, (128, 0))
  seam.save(out_dir / "seam_12h_strip.jpg", quality=92)
  full.resize((2048, 1024), Image.Resampling.BOX).save(
    out_dir / "full_annotated.jpg",
    quality=90,
  )
  print(f"Wrote previews → {out_dir}")


if __name__ == "__main__":
  main()
