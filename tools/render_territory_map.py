"""渲染历史政治地图风格（色块版图）的预览"""
import io
import math
import os
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_rel(path):
    with io.open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


_geo = read_rel('assets/scripts/core/Geo.ts')
SCALE = float(re.search(r'const\s+SCALE\s*=\s*([\d.]+)', _geo).group(1))
LON_MIN, LON_MAX = 99, 125
LAT_MIN, LAT_MAX = 19, 43
COS_MID = math.cos(math.radians(31))
MAP_W = (LON_MAX - LON_MIN) * COS_MID * SCALE
MAP_H = (LAT_MAX - LAT_MIN) * SCALE


def project(lat, lon):
    # 与 core/Geo.ts 一致：原点在地图中心，y 向**北**为正
    return ((lon - LON_MIN) * COS_MID * SCALE - MAP_W / 2,
            (lat - LAT_MIN) * SCALE - MAP_H / 2)


def load_font(size, bold=False):
    for c in [r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
              r'C:\Windows\Fonts\simhei.ttf']:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, max(8, int(size)))
            except Exception:
                continue
    return ImageFont.load_default()


# 城池
src = read_rel('assets/scripts/data/Provinces.ts')
provs = []
for ch in src.split("id: '")[1:]:
    cid = ch.split("'")[0]

    def grab(k):
        i = ch.find(k)
        if i < 0:
            return None
        m = re.match(r'\s*(-?[\d.]+)', ch[i + len(k):])
        return float(m.group(1)) if m else None

    nm = re.search(r"name:\s*'([^']+)'", ch)
    rg = re.search(r"region:\s*'([^']+)'", ch)
    lat, lon = grab('lat:'), grab('lon:')
    if lat is None or lon is None or not nm:
        continue
    ci = ch.find('city:')
    city = ('true' in ch[ci:ci + 20]) if ci >= 0 else False
    provs.append({'id': cid, 'name': nm.group(1), 'lat': lat, 'lon': lon,
                  'city': city, 'region': rg.group(1) if rg else ''})

owners = dict(re.findall(r"(\w+):\s*'([a-z_]+)'", src.split('INITIAL_OWNER')[1]))

fact_src = read_rel('assets/scripts/data/Factions.ts')
factions = {}
for ch in fact_src.split("id: '")[1:]:
    fid = ch.split("'")[0]
    nm = re.search(r"name:\s*'([^']+)'", ch)
    col = re.search(r"color:\s*'(#[0-9a-fA-F]{6})'", ch)
    if nm and col:
        factions[fid] = {'name': nm.group(1), 'color': col.group(1)}


def hex_color(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def shade(c, f):
    return tuple(min(255, int(v * f)) for v in c)


# 陆地
geo_src = read_rel('assets/scripts/data/Geography.ts')
COAST = [(float(m.group(1)), float(m.group(2)))
         for m in re.finditer(r'\[([\d.]+),\s*([\d.]+)\]',
                              geo_src.split('COASTLINE')[1].split('];')[0])]
land_ll = COAST + [(LON_MIN, LAT_MIN), (LON_MIN, LAT_MAX), (COAST[0][0], LAT_MAX)]
land_px = [project(lat, lon) for lon, lat in land_ll]


def clip_half(poly, nx, ny, c):
    if not poly:
        return []
    out = []
    n = len(poly)
    ins = lambda p: nx * p[0] + ny * p[1] <= c
    for i in range(n):
        cur = poly[i]
        prev = poly[(i - 1) % n]
        ci, pi = ins(cur), ins(prev)
        if ci:
            if not pi:
                out.append(inter(prev, cur, nx, ny, c))
            out.append(cur)
        elif pi:
            out.append(inter(prev, cur, nx, ny, c))
    return out


def inter(a, b, nx, ny, c):
    da = nx * a[0] + ny * a[1] - c
    db = nx * b[0] + ny * b[1] - c
    t = da / (da - db) if (da - db) != 0 else 0
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


# Voronoi
pts = [{'id': p['id'], **dict(zip(('x', 'y'), project(p['lat'], p['lon'])))} for p in provs]
territories = {}
for a in pts:
    poly = land_px[:]
    for b in pts:
        if a['id'] == b['id']:
            continue
        dx, dy = b['x'] - a['x'], b['y'] - a['y']
        if dx * dx + dy * dy < 1e-6:
            continue
        c = ((b['x'] ** 2 + b['y'] ** 2) - (a['x'] ** 2 + a['y'] ** 2)) / 2
        poly = clip_half(poly, dx, dy, c)
        if not poly:
            break
    if len(poly) >= 3:
        territories[a['id']] = poly

print(f'城池 {len(provs)}，版图 {len(territories)}')

# 绘制
PAD = 40
LEGEND_W = 160
img = Image.new('RGB',
                (int(MAP_W) + PAD * 2 + LEGEND_W, int(MAP_H) + PAD * 2),
                (74, 106, 128))
d = ImageDraw.Draw(img, 'RGBA')


def to_img(x, y):
    return (x + MAP_W / 2 + PAD, MAP_H / 2 - y + PAD)


# 陆地底色
d.polygon([to_img(*p) for p in land_px], fill=(200, 190, 156, 255))

# 版图
for p in provs:
    poly = territories.get(p['id'])
    if not poly:
        continue
    f = factions.get(owners.get(p['id']))
    fill = shade(hex_color(f['color']), 1.25) if f else (178, 172, 158)
    d.polygon([to_img(*q) for q in poly], fill=fill + (255,))

# 版图边界
for p in provs:
    poly = territories.get(p['id'])
    if poly:
        d.line([to_img(*q) for q in poly] + [to_img(*poly[0])],
               fill=(120, 100, 70, 90), width=1)

# 州界
edges = {}
for p in provs:
    poly = territories.get(p['id'])
    if not poly:
        continue
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ka = f'{a[0]:.1f},{a[1]:.1f}'
        kb = f'{b[0]:.1f},{b[1]:.1f}'
        ek = f'{ka}|{kb}' if ka < kb else f'{kb}|{ka}'
        e = edges.setdefault(ek, {'a': a, 'b': b, 'r': set()})
        e['r'].add(p['region'])
for e in edges.values():
    if len(e['r']) >= 2:
        d.line([to_img(*e['a']), to_img(*e['b'])], fill=(96, 74, 46, 170), width=3)

# 城池 + 标签
font = load_font(17, bold=True)
for p in provs:
    cx, cy = to_img(p['lat'] and project(p['lat'], p['lon'])[0],
                    project(p['lat'], p['lon'])[1])
    r = 21 if p['city'] else 17
    d.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], fill=(36, 30, 22, 235))
    f = factions.get(owners.get(p['id']))
    d.ellipse([cx - r, cy - r, cx + r, cy + r],
              fill=shade(hex_color(f['color']), 0.85) if f else (178, 172, 158))
    if p['city']:
        d.ellipse([cx - r + 6, cy - r + 6, cx + r - 6, cy + r - 6],
                  outline=(250, 240, 210, 220), width=2)
    # 标签
    bbox = d.textbbox((0, 0), p['name'], font=font)
    tw = bbox[2] - bbox[0]
    ty = cy + r + 3
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            d.text((cx - tw / 2 + dx, ty + dy), p['name'], font=font, fill=(252, 248, 236, 240))
    d.text((cx - tw / 2, ty), p['name'], font=font, fill=(30, 24, 16, 255))

# 图例
f_leg = load_font(16)
lx = img.size[0] - 150
ly = 16
d.rectangle([lx - 10, ly - 10, img.size[0] - 6, ly + 24 * len(factions) + 6],
            fill=(18, 16, 13, 240), outline=(150, 130, 90, 210))
for fid, f in factions.items():
    d.rectangle([lx, ly, lx + 12, ly + 12], fill=hex_color(f['color']))
    d.text((lx + 18, ly - 4), f['name'], font=f_leg, fill=(228, 222, 210, 255))
    ly += 24

out = os.path.join(ROOT, 'tools', 'map-preview.png')
img.save(out)
print(f'输出 {out}  {img.size}')
