"""One-off asset prep. Reads brand/, writes src/assets/. Run: python -I tools/make-assets.py"""
import json, numpy as np
from PIL import Image
R = "D:/SADEWA PROJECT/ARE/"
src = Image.open(R + "brand/LOGO ARE PNG...png").convert("RGBA")  # IHDR colourtype 6, 91% pure-black alpha=0
a = np.array(src)

# premultiplied resize: transparent px are RGB(0,0,0) so straight resize would halo; premultiply, resize, unpremultiply
def premul_resize(img, size):
    f = np.array(img).astype(np.float64)
    al = f[..., 3:4] / 255.0
    f[..., :3] *= al
    p = Image.fromarray(np.uint8(np.round(f)), "RGBA") if False else None
    chans = [Image.fromarray(f[..., i].astype(np.float32), "F").resize(size, Image.LANCZOS) for i in range(4)]
    o = np.stack([np.array(c) for c in chans], -1)
    al2 = np.clip(o[..., 3:4] / 255.0, 0, 1)
    rgb = np.where(al2 > 0, o[..., :3] / np.maximum(al2, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 255), np.clip(o[..., 3:4], 0, 255)], -1)
    return Image.fromarray(np.uint8(np.round(out)), "RGBA")

al = a[..., 3]
ys, xs = np.where(al > 0)
box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
crop = src.crop(box)
w = 640
logo = premul_resize(crop, (w, round(crop.height * w / crop.width)))
logo.save(R + "src/assets/logo.png", optimize=True)
print("logo", logo.size, "crop", box)

# favicon trace from the real pixel grid of the cyan face
cy = (abs(a[..., 0].astype(int) - 1) < 30) & (abs(a[..., 1].astype(int) - 172) < 30) & (abs(a[..., 2].astype(int) - 253) < 30) & (al > 200)
yy, xx = np.where(cy)
x0, x1, y0, y1 = xx.min(), xx.max() + 1, yy.min(), yy.max() + 1
m = cy[y0:y1, x0:x1]
COLS, ROWS = 66, 20
cw, ch = m.shape[1] / COLS, m.shape[0] / ROWS
grid = np.zeros((ROWS, COLS), bool)
fr = []
for r in range(ROWS):
    for c in range(COLS):
        cell = m[int(r * ch):int((r + 1) * ch), int(c * cw):int((c + 1) * cw)]
        fr.append(cell.mean()); grid[r, c] = cell.mean() > 0.5
fr = np.array(fr); print("cell fill: <.2", (fr < .2).sum(), ".2-.8", ((fr >= .2) & (fr <= .8)).sum(), ">.8", (fr > .8).sum())
rects = []
for r in range(ROWS):
    c = 0
    while c < COLS:
        if grid[r, c]:
            s = c
            while c < COLS and grid[r, c]: c += 1
            rects.append([s, r, c - s, 1])
        else: c += 1
# merge identical vertical runs
merged = []
for rc in rects:
    for mg in merged:
        if mg[0] == rc[0] and mg[2] == rc[2] and mg[1] + mg[3] == rc[1]:
            mg[3] += 1; break
    else: merged.append(rc)
json.dump({"cols": COLS, "rows": ROWS, "rects": merged}, open(R + "src/assets/favicon-grid.json", "w"))
print("rects", len(merged))
for r in range(ROWS): print("".join("#" if g else "." for g in grid[r]))

# og card 1200x630: ink background taken from brand pixel, logo centred
bg = tuple(int(v) for v in a[813, 601][:3])
og = Image.new("RGB", (1200, 630), bg)
lg = premul_resize(crop, (760, round(crop.height * 760 / crop.width)))
og.paste(lg, ((1200 - lg.width) // 2, (630 - lg.height) // 2), lg)
og.save(R + "src/assets/og.png", optimize=True)
