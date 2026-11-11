"""
渲染完整游戏界面预览（地图 + HUD）

按 GameController 里的真实 Widget/坐标绘制，用于检查 UI 布局。

坐标系说明（这是第一版出错的地方）：
  - Canvas 720x1280，原点在屏幕中心，y 向上为正
  - Widget top:0 的元素，其上边缘在 y=+640
  - 顶栏(y 从 544 到 640)内的子节点坐标是**相对顶栏中心**的
  - 因此「日期标签本地 (-250, 18)」实际屏幕 y = 592 + 18 = 610

用法：python tools/render_full_ui.py
输出：tools/ui-preview.png
"""
import io
import math
import os
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEW_W, VIEW_H = 720, 1280


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
    # 与 core/Geo.ts 一致：原点在地图中心
    return ((lon - LON_MIN) * COS_MID * SCALE - MAP_W / 2,
            (LAT_MAX - lat) * SCALE - MAP_H / 2)


def load_font(size, bold=False):
    for c in [r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
              r'C:\Windows\Fonts\simhei.ttf', r'C:\Windows\Fonts\simsun.ttc']:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ---------- 读取城池 / 势力 ----------
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
    lat, lon = grab('lat:'), grab('lon:')
    if lat is None or lon is None or not nm:
        continue
    ci = ch.find('city:')
    city = ('true' in ch[ci:ci + 20]) if ci >= 0 else False
    provs.append({'id': cid, 'name': nm.group(1), 'lat': lat, 'lon': lon, 'city': city})

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


# ---------- 画布（PIL 坐标：y 向下）----------
img = Image.new('RGB', (VIEW_W, VIEW_H), (74, 106, 128))
d = ImageDraw.Draw(img, 'RGBA')


def px(cx):
    """Cocos 屏幕 x -> PIL x"""
    return cx + VIEW_W / 2


def py(cy):
    """Cocos 屏幕 y -> PIL y"""
    return VIEW_H / 2 - cy


def box_pil(x0, y0, x1, y1):
    """Cocos 矩形 -> PIL 矩形"""
    return [px(x0), py(y1), px(x1), py(y0)]


# ---------- 地图 ----------
# 与游戏共用同一策略：填满高度（resetToStartView）
fill_h = VIEW_H / MAP_H
min_node = 26 / (17 * 2)
fit = min(2.2, max(fill_h, min_node, 0.45))
focus = project(34.4, 113.0)
cam_x = -focus[0] * fit
cam_y = -focus[1] * fit

mw, mh = MAP_W * fit, MAP_H * fit
halfW, halfH = VIEW_W / 2, VIEW_H / 2
# clamp（与 MapCamera.clamp 一致）：地图以中心为原点，范围 [cam-mw/2, cam+mw/2]
if mw <= VIEW_W:
    cam_x = 0
else:
    limit_x = mw / 2 - halfW
    cam_x = min(limit_x, max(-limit_x, cam_x))
if mh <= VIEW_H:
    cam_y = 0
else:
    limit_y = mh / 2 - halfH
    cam_y = min(limit_y, max(-limit_y, cam_y))
print(f'相机 ({cam_x:.0f}, {cam_y:.0f})，地图显示 {mw:.0f}x{mh:.0f}，缩放 {fit:.3f}')
print(f'  地图范围 x[{cam_x-mw/2:.0f},{cam_x+mw/2:.0f}] y[{cam_y-mh/2:.0f},{cam_y+mh/2:.0f}]')
print(f'  屏幕范围 x[{-halfW:.0f},{halfW:.0f}] y[{-halfH:.0f},{halfH:.0f}]')

cam = (cam_x, cam_y)


def m2s(mx, my):
    """地图局部坐标 -> Cocos 屏幕坐标"""
    return (mx * fit + cam[0], my * fit + cam[1])


coast_txt = read_rel('assets/scripts/data/Geography.ts')
COAST = [(float(m.group(1)), float(m.group(2)))
         for m in re.finditer(r'\[([\d.]+),\s*([\d.]+)\]',
                              coast_txt.split('COASTLINE')[1].split('];')[0])]

land_ll = COAST + [(LON_MIN, LAT_MIN), (LON_MIN, LAT_MAX), (COAST[0][0], LAT_MAX)]
d.polygon([(px(s[0]), py(s[1])) for s in
           [m2s(*project(lat, lon)) for lon, lat in land_ll]],
          fill=(200, 190, 156, 255))
d.line([(px(s[0]), py(s[1])) for s in [m2s(*project(lat, lon)) for lon, lat in COAST]],
       fill=(44, 68, 86, 235), width=2)

font_city = load_font(17, bold=True)
for p in provs:
    s = m2s(*project(p['lat'], p['lon']))
    cx, cy = px(s[0]), py(s[1])
    r = (21 if p['city'] else 17) * fit
    f = factions.get(owners.get(p['id']))
    fill = hex_color(f['color']) if f else (150, 145, 135)
    d.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], fill=(36, 30, 22, 235))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    if p['city']:
        d.ellipse([cx - r + 6, cy - r + 6, cx + r - 6, cy + r - 6],
                  outline=(252, 244, 214, 235), width=2)
    bbox = d.textbbox((0, 0), p['name'], font=font_city)
    tw = bbox[2] - bbox[0]
    ty = cy + r + 3
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            d.text((cx - tw / 2 + dx, ty + dy), p['name'], font=font_city,
                   fill=(252, 248, 236, 235))
    d.text((cx - tw / 2, ty), p['name'], font=font_city, fill=(28, 22, 14, 255))

# ---------- HUD ----------
font_big = load_font(26, bold=True)
font_mid = load_font(22, bold=True)
font_small = load_font(20, bold=True)
font_tiny = load_font(18)


def widget_box(w, h, left=None, right=None, top=None, bottom=None, hcenter=None):
    """返回 Cocos 屏幕坐标矩形 (x0,y0,x1,y1)"""
    if left is not None:
        x0 = -VIEW_W / 2 + left
    elif right is not None:
        x0 = VIEW_W / 2 - right - w
    elif hcenter is not None:
        x0 = hcenter - w / 2
    else:
        x0 = -w / 2
    if top is not None:
        y1 = VIEW_H / 2 - top
    elif bottom is not None:
        y1 = -VIEW_H / 2 + bottom + h
    else:
        y1 = h / 2
    return (x0, y1 - h, x0 + w, y1)


def draw_rect(b, fill, outline=None, width=2):
    d.rectangle(box_pil(*b), fill=fill, outline=outline, width=width)


def draw_text_at(cx, cy, text, font, color, anchor='mm'):
    d.text((px(cx), py(cy)), text, font=font, fill=color, anchor=anchor)


# 顶栏
bar = widget_box(720, 96, top=0)
draw_rect(bar, (28, 24, 18, 235), (180, 150, 90, 200))
bar_cy = (bar[1] + bar[3]) / 2
# 左列 -330，右列 -70（与 GameController 一致）
draw_text_at(-330, bar_cy + 22, '194年1月 第1回合', font_big,
             (240, 220, 170, 255), 'lm')
draw_text_at(-330, bar_cy - 20, '金币 800', font_mid, (245, 205, 90, 255), 'lm')
draw_text_at(-160, bar_cy - 20, '粮草 400', font_mid, (198, 232, 150, 255), 'lm')
draw_text_at(-70, bar_cy + 22, '兵力 3073', font_mid, (200, 220, 255, 255), 'lm')
draw_text_at(0, bar_cy - 20, '据点 3 / 35', font_mid, (200, 255, 200, 255), 'lm')

# 静音 / 全图（顶栏子节点 x=292，y=±22，均在栏内）
mb = (292 - 26, bar_cy + 22 - 20, 292 + 26, bar_cy + 22 + 20)
draw_rect(mb, (50, 44, 34, 230), (170, 145, 95, 200))
draw_text_at(292, bar_cy + 22, '声', font_mid, (240, 225, 190, 255))

rb = (292 - 26, bar_cy - 22 - 20, 292 + 26, bar_cy - 22 + 20)
draw_rect(rb, (50, 44, 34, 230), (170, 145, 95, 200))
draw_text_at(292, bar_cy - 22, '全图', font_small, (240, 225, 190, 255))

# 结束回合（面板上方右侧）
eb = widget_box(150, 60, right=20, bottom=316)
draw_rect(eb, (150, 60, 45, 255), (230, 190, 110, 255))
draw_text_at((eb[0] + eb[2]) / 2, (eb[1] + eb[3]) / 2, '结束回合', font_big, (255, 240, 210, 255))

# 提示条（面板上方左侧）
hb = widget_box(520, 30, left=24, bottom=316)
draw_text_at(hb[0] + 4, (hb[1] + hb[3]) / 2, '橙红路可进攻 · 绿/浅色不能打 · 全图常显', font_mid,
             (255, 235, 180, 255), 'lm')

# 战报（左上，顶栏下方）
lb = widget_box(340, 96, left=16, top=108)
d.rectangle(box_pil(*lb), outline=(120, 200, 255, 100), width=1)
draw_text_at((lb[0] + lb[2]) / 2, lb[3] - 12, '战报 340x96', font_tiny, (120, 200, 255, 200))

# 省份面板：底部抽屉 720x300
pb = widget_box(720, 300, hcenter=0, bottom=0)
draw_rect(pb, (28, 24, 18, 248), (190, 160, 100, 220))
x0, y0, x1, y1 = pb
draw_text_at(x0 + 18, y1 - 22, '洛阳 ★　归属：曹操', font_big, (255, 230, 170, 255), 'lm')

# 内政只留一套按钮：标题行不再摆第二套「治理/屯田/筑城/征兵」
# 自动开关（内政行最左，66x50，Widget left=142 bottom=64）
AUTO_ON = True
AUTO_ORDER = 0  # 自动重复的是第 0 个内政指令（治理）
ab = (x0 + 142, y0 + 64, x0 + 142 + 66, y0 + 64 + 50)
draw_rect(ab, (146, 106, 38, 255) if AUTO_ON else (52, 46, 36, 235),
          (255, 226, 138, 255) if AUTO_ON else (120, 105, 78, 200), 2 if AUTO_ON else 1)
draw_text_at((ab[0] + ab[2]) / 2, (ab[1] + ab[3]) / 2, '自动',
             font_tiny, (255, 240, 200, 255) if AUTO_ON else (150, 140, 122, 255))

# 两栏正文（6 行，行高 22）
left_col = ['兵力 1800 / 2480', '人口 34　工事 4', '发展度 62 / 100',
            '月收 184 金 · 粮 41', '月募兵 +120 / 回合',
            '守将 曹操(1)、夏侯惇(1)、典韦(1)']
# 右栏第一行是全局自动方针（手动点内政键会改它，必须常驻可见）；
# 第二行写清「选了还没执行」：内政只在结束回合统一结算。
right_col = ['自动：治理 · 点内政键换', '待执行：治理（结束回合结算）',
             '可攻：邺、南皮', '可调兵：许昌']
ly = y1 - 56
for i in range(max(len(left_col), len(right_col))):
    if i < len(left_col):
        draw_text_at(x0 + 18, ly, left_col[i], font_tiny, (235, 230, 215, 255), 'lm')
    if i < len(right_col):
        draw_text_at(x0 + 390, ly, right_col[i], font_tiny, (255, 200, 120, 255), 'lm')
    ly -= 22

# 面板按钮：上排内政、下排军事（靠右，Widget left + bottom）
# 当前这座城 effectiveOrder() 指向的指令亮底 + 金边（词只出现一次）；
# 有手动登记时高亮登记的那道，否则高亮自动方针。
btn_w, gap = 112, 10
total = btn_w * 4 + gap * 3
left0 = 720 - 18 - total
btn_rows = [
    (64, ['治理', '屯田', '筑城', '征兵']),
    (8, ['进攻', '调兵', '取消']),
]
for bottom, texts in btn_rows:
    for i, txt in enumerate(texts):
        bl = x0 + left0 + i * (btn_w + gap)
        b = (bl, y0 + bottom, bl + btn_w, y0 + bottom + 50)
        on = AUTO_ON and bottom == 64 and i == AUTO_ORDER
        draw_rect(b, (120, 90, 32, 255) if on else (70, 58, 42, 255),
                  (255, 226, 138, 255) if on else (190, 160, 100, 220), 3 if on else 2)
        draw_text_at((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, txt, font_mid, (250, 235, 200, 255))

out = os.path.join(ROOT, 'tools', 'ui-preview.png')
img.save(out)
print(f'输出 {out}  {img.size}')
print(f'地图 {MAP_W:.0f}x{MAP_H:.0f}，初始缩放 {fit:.3f}')
