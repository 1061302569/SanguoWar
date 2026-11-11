"""检查陆地多边形在新 y 方向下是否自相交，以及空洞位置"""
import math
import re
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COS = math.cos(math.radians(31))
S = 52
LON_MIN, LON_MAX = 99, 125
LAT_MIN, LAT_MAX = 19, 43
MAP_W = (LON_MAX - LON_MIN) * COS * S
MAP_H = (LAT_MAX - LAT_MIN) * S


def read_rel(p):
    with io.open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()


def project(lat, lon):
    return ((lon - LON_MIN) * COS * S - MAP_W / 2,
            (lat - LAT_MIN) * S - MAP_H / 2)


geo = read_rel('assets/scripts/data/Geography.ts')
COAST = [(float(m.group(1)), float(m.group(2)))
         for m in re.finditer(r'\[([\d.]+),\s*([\d.]+)\]',
                              geo.split('COASTLINE')[1].split('];')[0])]

land_ll = COAST + [(LON_MIN, LAT_MIN), (LON_MIN, LAT_MAX), (COAST[0][0], LAT_MAX)]
poly = [project(lat, lon) for lon, lat in land_ll]

print(f'海岸线 {len(COAST)} 点，陆地多边形 {len(poly)} 点')
print('\n前 3 个点（海岸线起点，东北）:')
for p in poly[:3]:
    print(f'  ({p[0]:.0f}, {p[1]:.0f})')
print('末 4 个点（闭合部分）:')
for p in poly[-4:]:
    print(f'  ({p[0]:.0f}, {p[1]:.0f})')


def seg_intersect(p1, p2, p3, p4):
    def d(x1, y1, x2, y2, x3, y3):
        return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
    d1 = d(p3[0], p3[1], p4[0], p4[1], p1[0], p1[1])
    d2 = d(p3[0], p3[1], p4[0], p4[1], p2[0], p2[1])
    d3 = d(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1])
    d4 = d(p1[0], p1[1], p2[0], p2[1], p4[0], p4[1])
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


print('\n=== 自相交检测 ===')
n = len(poly)
crosses = 0
for i in range(n):
    for j in range(i + 2, n):
        if i == 0 and j == n - 1:
            continue
        if seg_intersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]):
            crosses += 1
            if crosses <= 8:
                print(f'  边{i} 与 边{j} 相交: ({poly[i][0]:.0f},{poly[i][1]:.0f})-'
                      f'({poly[(i+1)%n][0]:.0f},{poly[(i+1)%n][1]:.0f})  X  '
                      f'({poly[j][0]:.0f},{poly[j][1]:.0f})-({poly[(j+1)%n][0]:.0f},{poly[(j+1)%n][1]:.0f})')
print(f'\n共 {crosses} 处自相交')

print('\n=== 各纬度陆地区间数 ===')


def spans(p, y):
    xs = []
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
            t = (y - a[1]) / (b[1] - a[1]) if (b[1] - a[1]) != 0 else 0
            xs.append(a[0] + t * (b[0] - a[0]))
    xs.sort()
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]


for lat in [42, 40, 38, 35, 30, 25, 20]:
    y = project(lat, LON_MIN)[1]
    s = spans(poly, y)
    desc = ' '.join(f'[{a:.0f},{b:.0f}]' for a, b in s)
    flag = '  <-- 有洞!' if len(s) > 1 else ''
    print(f'  lat={lat}: {len(s)} 段  {desc}{flag}')
