#!/usr/bin/env python3
"""
tools/make-icons.py — regenerate the PWA icon set from the master artwork.

Master: assets/source/app-icon-512.png (512px RGBA, alpha cutout).
Outputs: assets/icons/ — see OUTPUTS below.

Not part of the app and never loaded by it; run manually when the master art
changes. Python + Pillow because icon resampling needs a real image library
and the app itself has no toolchain (SPEC §2 — this script is tooling, not a
build step; the generated PNGs are committed).

    python3 tools/make-icons.py

Decisions encoded here (SPEC §14 Phase 5):
- Maskable icons: art scaled to the safe zone (~72% of canvas) over a solid
  backdrop. Android crops maskable icons to a circle and eats anything near
  the edge; a transparent-backdrop maskable renders on whatever the launcher
  feels like, so the backdrop is solid and ours.
- apple-touch-icon: 180x180, NO alpha — iOS renders transparency as black.
- Backdrop is the app's ocean dark (#070D18), NOT the icon's own navy
  (#173B5F): half the spiral's arms ARE that navy and vanish on it. Judged by
  eye against both, recorded in SPEC.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "assets" / "source" / "app-icon-512.png"
OUT = ROOT / "assets" / "icons"

BACKDROP = (0x07, 0x0D, 0x18, 0xFF)   # tokens.js DARK.ocean — keep in sync
MASKABLE_SCALE = 0.72                  # art within the safe-zone circle
TOUCH_SCALE = 0.84                     # iOS shows the full square, less padding

# (filename, size, transparent?, scale of art within canvas)
OUTPUTS = [
    ("icon-192.png",          192, True,  1.00),
    ("icon-512.png",          512, True,  1.00),
    ("maskable-192.png",      192, False, MASKABLE_SCALE),
    ("maskable-512.png",      512, False, MASKABLE_SCALE),
    ("apple-touch-icon.png",  180, False, TOUCH_SCALE),
    ("favicon-32.png",         32, True,  1.00),
]


def build(master: Image.Image, size: int, transparent: bool, scale: float) -> Image.Image:
    art_px = round(size * scale)
    art = master.resize((art_px, art_px), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size),
                       (0, 0, 0, 0) if transparent else BACKDROP)
    offset = (size - art_px) // 2
    canvas.paste(art, (offset, offset), art)
    if not transparent:
        canvas = canvas.convert("RGB")  # flatten: no alpha channel at all
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = Image.open(MASTER).convert("RGBA")
    for name, size, transparent, scale in OUTPUTS:
        build(master, size, transparent, scale).save(OUT / name, optimize=True)
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
