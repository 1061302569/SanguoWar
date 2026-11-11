"""检查西北区域为何缺少版图覆盖"""
import io
import math
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COS = math.cos(math.radians(31))
S = 52
LON_MIN, LAT_MIN = 99, 19
MAP_W = (125 - 99) * COS * S
MAP_H = 24 * S


def proj(lat, lon):
    return ((lon - LON_MIN) * COS * S - MAP_W / 2,
            (lat - LAT_MIN) * S - MAP_H / 2)


src = io.open(os.path.join(ROOT, 'assets/scripts/data/Provinces.ts'), encoding='utf-8').read()
pts = []
for ch in src.split("id: '")[1:]:
    cid = ch.split("'")[0]

    def g(k):
        i = ch.find(k)
        if i < 0:
            return None
        m = re.match(r'\s*(-?[\d.]+)', ch[i + len(k):])
        return float(m.group(1)) if m else None

    lat, lon = g('lat:'), g('lon:')
    if lat and lon:
        pts.append((cid, *proj(lat, lon)))

print(f'地图 x 范围 {-MAP_W/2:.0f} ~ {MAP_W/2:.0f}')
print(f'地图 y 范围 {-MAP_H/2:.0f} ~ {MAP_H/2:.0f}')

xs = [p[1] for p in pts]
ys = [p[2] for p in pts]
print(f'城池 x 范围 {min(xs):.0f} ~ {max(xs):.0f}')
print(f'城池 y 范围 {min(ys):.0f} ~ {max(ys):.0f}')

print('\n西北区域 (x<-150, y>150) 的城池：')
found = False
for p in pts:
    if p[1] < -150 and p[2] > 150:
        print(f'  {p[0]}: ({p[1]:.0f},{p[2]:.0f})')
        found = True
if not found:
    print('  无')

print('\n注意：Voronoi 版图会铺满整个陆地多边形。')
print('如果西北角出现空白，说明该处【没有陆地多边形覆盖】，')
print('而不是版图缺失 —— 因为版图是从陆地多边形裁剪出来的。')
print(f'\n陆地多边形最左 x = {-MAP_W/2:.0f}（地图左边缘）')
print(f'最右 x = {max(p[1] for p in pts):.0f}（最东城池）')
