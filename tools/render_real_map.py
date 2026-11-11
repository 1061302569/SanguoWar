"""
渲染真实地理的三国地图预览（PNG）

与游戏内 MapRenderer.ts 使用同一套投影、配色与「陆地铺底 + 海面覆盖」算法。
脚本刻意避免复杂嵌套正则（Python re 在长文本上会灾难性回溯）。

用法：python tools/render_real_map.py
输出：tools/map-preview.png
"""
import io
import math
import os
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_rel(path):
    with io.open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


# ⚠ 关键：SCALE 必须与游戏内 core/Geo.ts 保持一致，
# 否则预览图与游戏实际比例不同，静默掩盖真实的间距/尺寸问题。
# （曾出现预览用 78、游戏用 52 的情况，导致"验证通过"但实际体验不对）
_geo_src = read_rel('assets/scripts/core/Geo.ts')
_m = re.search(r'const\s+SCALE\s*=\s*([\d.]+)', _geo_src)
if not _m:
    raise SystemExit('无法从 core/Geo.ts 读取 SCALE')
SCALE = float(_m.group(1))

LON_MIN, LON_MAX = 99, 125
LAT_MIN, LAT_MAX = 19, 43
COS_MID = math.cos(math.radians((LAT_MIN + LAT_MAX) / 2))

W = int((LON_MAX - LON_MIN) * COS_MID * SCALE)
H = int((LAT_MAX - LAT_MIN) * SCALE)
print(f'SCALE={SCALE:g}（读自 core/Geo.ts）→ 地图 {W}x{H}px')


def project(lat, lon):
    return ((lon - LON_MIN) * COS_MID * SCALE, (LAT_MAX - lat) * SCALE)


def read(path):
    with io.open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


PAIR = re.compile(r'\[(-?[\d.]+),\s*(-?[\d.]+)\]')
QUAD = re.compile(r'\[(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\]')


def parse_pairs(text):
    return [(float(m.group(1)), float(m.group(2))) for m in PAIR.finditer(text)]


# ---------- 城池 ----------
src = read('assets/scripts/data/Provinces.ts')
provs = []
for ch in src.split("id: '")[1:]:
    cid = ch.split("'")[0]

    def grab(key):
        i = ch.find(key)
        if i < 0:
            return None
        m = re.match(r'\s*(-?[\d.]+)', ch[i + len(key):])
        return float(m.group(1)) if m else None

    def grab_str(key):
        i = ch.find(key)
        if i < 0:
            return ''
        m = re.match(r"\s*'([^']*)'", ch[i + len(key):])
        return m.group(1) if m else ''

    lat, lon = grab('lat:'), grab('lon:')
    if lat is None or lon is None:
        continue

    ci = ch.find('city:')
    city = ('true' in ch[ci:ci + 20]) if ci >= 0 else False

    borders = []
    bi = ch.find('borders:')
    if bi >= 0:
        seg = ch[bi:bi + 400]
        borders = re.findall(r"'([a-z_]+)'", seg[:seg.find(']') + 1])

    provs.append({'id': cid, 'name': grab_str('name:'),
                  'lat': lat, 'lon': lon, 'city': city, 'borders': borders})

print(f'城池：{len(provs)}')

owners = dict(re.findall(r"(\w+):\s*'([a-z_]+)'", src.split('INITIAL_OWNER')[1]))

fact_src = read('assets/scripts/data/Factions.ts')
factions = {}
for ch in fact_src.split("id: '")[1:]:
    fid = ch.split("'")[0]
    nm = re.search(r"name:\s*'([^']+)'", ch)
    col = re.search(r"color:\s*'(#[0-9a-fA-F]{6})'", ch)
    if nm and col:
        factions[fid] = {'name': nm.group(1), 'color': col.group(1)}

# ---------- 地理 ----------
geo_src = read('assets/scripts/data/Geography.ts')
COAST = parse_pairs(geo_src.split('COASTLINE')[1].split('];')[0])
LAKES = [(float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)))
         for m in QUAD.finditer(geo_src.split('LAKES')[1])]

render_src = read('assets/scripts/ui/MapRenderer.ts')


def parse_polylines(text):
    """按顶层折线分组：扫描方括号深度，取 depth 1→2 的每一段折线。

    旧实现按「没有坐标对的行」分组，遇到 `MOUNTAINS` 这种每条折线独占一行、
    行间没有空行的写法，会把 7 条山脉全部并成 1 条；多行折线也会在
    `],` 处被错切。这里不用嵌套正则（长文本上会灾难性回溯），只做线性扫描。
    传入的 text 已用 `.split('];')[0]` 截掉数组结尾，故末尾深度不会归零。
    """
    groups = []
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '[':
            depth += 1
            if depth == 2:
                start = i + 1
        elif ch == ']':
            if depth == 2 and start >= 0:
                pts = parse_pairs(text[start:i])
                if len(pts) >= 2:
                    groups.append(pts)
                start = -1
            depth -= 1
    return groups


MOUNTAINS = parse_polylines(render_src.split('const MOUNTAINS')[1].split('];')[0])
RIVERS = parse_polylines(render_src.split('const RIVERS')[1].split('];')[0])
print(f'海岸线 {len(COAST)} 点，山脉 {len(MOUNTAINS)} 条，河流 {len(RIVERS)} 条，湖泊 {len(LAKES)}')


def latitude_band_color(lat):
    if lat > 40:
        return (178, 172, 138)
    if lat > 35:
        return (198, 186, 148)
    if lat > 31:
        return (196, 196, 152)
    return (176, 196, 156)


def hex_color(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


# ---------- 绘制 ----------
# 右侧留出图例区，避免图例压住地图右上角的城池（蓟/北平/襄平一带）
LEGEND_W = 150
img = Image.new('RGB', (W + LEGEND_W, H), (18, 16, 13))
d = ImageDraw.Draw(img, 'RGBA')
# 地图区域底色（海洋）
d.rectangle([0, 0, W, H], fill=(74, 106, 128, 255))

# 陆地多边形：海岸线 + 左下角 + 左上角 + 北部边界回到海岸线首点
# （最后这段必须有，否则地图顶部会露海）
land_ll = COAST + [(LON_MIN, LAT_MIN), (LON_MIN, LAT_MAX), (COAST[0][0], LAT_MAX)]
land_px = [project(lat, lon) for lon, lat in land_ll]

# 陆地整块填充：单一颜色，不叠加任何分区着色
# （曾按纬度分 12 带、又按高原分 6 条竖带，都会被看成"地图分成好几块"）
d.polygon(land_px, fill=(200, 190, 156, 255))


def clip_half(poly, inside, inter):
    """单边 Sutherland–Hodgman 裁剪"""
    if not poly:
        return []
    out = []
    n = len(poly)
    for i in range(n):
        cur = poly[i]
        prev = poly[(i + n - 1) % n]
        ci, pi = inside(cur), inside(prev)
        if ci:
            if not pi:
                out.append(inter(prev, cur))
            out.append(cur)
        elif pi:
            out.append(inter(prev, cur))
    return out


def inter_y(a, b, yy):
    t = (yy - a[1]) / (b[1] - a[1])
    return (a[0] + t * (b[0] - a[0]), yy)


def inter_x(a, b, xx):
    t = (xx - a[0]) / (b[0] - a[0])
    return (xx, a[1] + t * (b[1] - a[1]))


def clip_y(poly, ymin, ymax):
    p = clip_half(poly, lambda q: q[1] >= ymin, lambda a, b: inter_y(a, b, ymin))
    p = clip_half(p, lambda q: q[1] <= ymax, lambda a, b: inter_y(a, b, ymax))
    return p


def clip_x_max(poly, xmax):
    return clip_half(poly, lambda q: q[0] <= xmax, lambda a, b: inter_x(a, b, xmax))


# 陆地已经是整块填充（见上方 d.polygon），这里不再叠加任何分区着色。

# 只描海岸线，不描西边界（否则左侧会出现一条贯穿上下的竖线）
coast_px2 = [project(lat, lon) for lon, lat in COAST]
d.line(coast_px2, fill=(44, 68, 86, 235), width=3)

# 山脉
for ridge in MOUNTAINS:
    d.line([project(lat, lon) for lon, lat in ridge], fill=(150, 138, 112, 150), width=5)
for ridge in MOUNTAINS:
    d.line([project(lat, lon) for lon, lat in ridge], fill=(214, 205, 180, 165), width=2)

# 河流
for river in RIVERS:
    d.line([project(lat, lon) for lon, lat in river], fill=(66, 114, 156, 235), width=4)
for river in RIVERS:
    d.line([project(lat, lon) for lon, lat in river], fill=(150, 190, 216, 180), width=1)

# 湖泊
for lon, lat, rlon, rlat in LAKES:
    c = project(lat, lon)
    rx = abs(project(lat, lon + rlon)[0] - c[0])
    ry = abs(project(lat + rlat, lon)[1] - c[1])
    d.ellipse([c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry], fill=(86, 132, 166, 240))

# 道路
by_id = {p['id']: p for p in provs}
drawn = set()
for p in provs:
    a = project(p['lat'], p['lon'])
    for bid in p['borders']:
        key = tuple(sorted([p['id'], bid]))
        if key in drawn or bid not in by_id:
            continue
        drawn.add(key)
        o = by_id[bid]
        b = project(o['lat'], o['lon'])
        same = owners.get(p['id']) == owners.get(bid)
        f = factions.get(owners.get(p['id']))
        if same and f:
            d.line([a, b], fill=hex_color(f['color']) + (165,), width=3)
        else:
            d.line([a, b], fill=(96, 82, 62, 115), width=2)


def load_font(size, bold=False):
    cands = [r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
             r'C:\Windows\Fonts\simhei.ttf', r'C:\Windows\Fonts\simsun.ttc']
    for c in cands:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


font_name = load_font(20, bold=True)
font_legend = load_font(17)

# 城池
for p in provs:
    cx, cy = project(p['lat'], p['lon'])
    r = 21 if p['city'] else 17
    d.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], fill=(36, 30, 22, 235))
    f = factions.get(owners.get(p['id']))
    fill = hex_color(f['color']) if f else (150, 145, 135)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    if p['city']:
        d.ellipse([cx - r + 6, cy - r + 6, cx + r - 6, cy + r - 6],
                  outline=(252, 244, 214, 235), width=2)

# 名称
for p in provs:
    cx, cy = project(p['lat'], p['lon'])
    r = 21 if p['city'] else 17
    label = p['name']
    bbox = d.textbbox((0, 0), label, font=font_name)
    tw = bbox[2] - bbox[0]
    ty = cy + r + 3
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-1, 0, 1):
            d.text((cx - tw / 2 + dx, ty + dy), label, font=font_name, fill=(252, 248, 236, 235))
    d.text((cx - tw / 2, ty), label, font=font_name, fill=(28, 22, 14, 255))

# 图例（放在右侧留白区，不遮挡地图）
lx = W + 12
ly = 16
d.rectangle([W, 0, W + LEGEND_W, H], fill=(18, 16, 13, 255))
for fid, f in factions.items():
    if ly + 26 > H:
        break
    d.rectangle([lx, ly, lx + 13, ly + 13], fill=hex_color(f['color']))
    d.text((lx + 20, ly - 4), f['name'], font=font_legend, fill=(228, 222, 210, 255))
    ly += 26

d.text((10, 8), '北 ↑', font=font_legend, fill=(245, 240, 225, 245))

out = os.path.join(ROOT, 'tools', 'map-preview.png')
img.save(out)
print(f'输出 {out}  {img.size}')
