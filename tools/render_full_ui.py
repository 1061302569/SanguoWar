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
font_log = load_font(16)


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

# 顶栏右侧 2x2 按钮区 + 俘虏营入口（x=168 下排）
# 顶栏子节点坐标相对栏中心，四个按钮都收在 96px 高的栏内
top_buttons = [
    (292, 22, '声', False),
    (292, -22, '全图', False),
    (230, 22, '新局', False),
    (230, -22, '路网', False),
    # 营里有俘虏时亮底金边，这里按「有俘虏」的状态画
    (168, -22, '俘虏', True),
]
for bx, by, text, lit in top_buttons:
    b = (bx - 26, bar_cy + by - 20, bx + 26, bar_cy + by + 20)
    draw_rect(b, (146, 106, 38, 255) if lit else (50, 44, 34, 230),
              (255, 226, 138, 255) if lit else (170, 145, 95, 200),
              3 if lit else 2)
    draw_text_at(bx, bar_cy + by, text, font_small,
                 (255, 240, 200, 255) if lit else (240, 225, 190, 255))

# 结束回合（面板上方右侧）
eb = widget_box(150, 60, right=20, bottom=316)
draw_rect(eb, (150, 60, 45, 255), (230, 190, 110, 255))
draw_text_at((eb[0] + eb[2]) / 2, (eb[1] + eb[3]) / 2, '结束回合', font_big, (255, 240, 210, 255))

# 提示条（面板上方左侧）：示意选中被图谋的城时给出的对策
hb = widget_box(520, 30, left=24, bottom=316)
draw_text_at(hb[0] + 4, (hb[1] + hb[3]) / 2, '! 敌军图谋 洛阳，可调兵回防', font_mid,
             (255, 235, 180, 255), 'lm')

# 常驻身份牌（顶栏下方 44px，战报据此下移到 top=156）
fb = widget_box(300, 44, left=16, top=104)
draw_rect(fb, (28, 24, 18, 235), (210, 178, 108, 230))
draw_rect((fb[0] + 6, fb[1] + 9, fb[0] + 32, fb[1] + 35), (190, 40, 20, 255))
draw_text_at(fb[0] + 44, (fb[1] + fb[3]) / 2, '我方 曹操 · 3 城', font_small,
             (240, 225, 190, 255), 'lm')

# 战报：340x140、顶部对齐 + CLAMP，5 行。要闻（! 开头）钉在最上面，
# 普通日志补位；这里按真实 recentLogs(3,5) 的排法画一帧。
lb = widget_box(340, 140, left=16, top=156)
draw_rect(lb, (22, 19, 15, 190), (120, 105, 78, 140), 1)
draw_text_at((lb[0] + lb[2]) / 2, lb[3] - 12, '战报 340x140', font_log, (120, 200, 255, 200))
log_lines = [
    ('! 袁绍 自后方集结 8751 兵于 长安，图谋 洛阳', True),
    ('! 长安 进攻 洛阳 失利', True),
    ('  招募 400 · 补 320 · 内政3城（自动2）', False),
    ('  孙策 治理 建业（发展度 +8）', False),
    ('  刘表 进攻 江陵 失利', False),
]
for k, (line, hi) in enumerate(log_lines):
    draw_text_at(lb[0] + 8, lb[3] - 30 - k * 22, line, font_log,
                 (255, 214, 170, 255) if hi else (210, 225, 235, 220), 'lm')

# 敌情预警条：紧贴战报下方，只在有敌情时出现，留到玩家整个回合
tb = widget_box(340, 66, left=16, top=302)
draw_rect(tb, (74, 30, 24, 238), (236, 138, 92, 235))
draw_text_at(tb[0] + 8, tb[3] - 14, '! 图谋 洛阳：袁绍 集结 8751 兵于 长安', font_log,
             (255, 214, 170, 255), 'lm')
draw_text_at(tb[0] + 8, tb[3] - 34, '点选该城，用「调兵」把后方兵力堆回前线', font_log,
             (255, 190, 150, 235), 'lm')
draw_text_at(tb[0] + 8, tb[3] - 54, '敌情预警（每回合 AI 阶段刷新）', font_tiny,
             (236, 138, 92, 255), 'lm')

# 任务式引导 / 阶段目标条：top=374，与 GameController 的 GoalBox 一致。
# 引导期第一行是「下一步做什么」，引导完成后换成「目标 · 立足 3/5 城」。
gb = widget_box(340, 72, left=16, top=374)
draw_rect(gb, (30, 26, 18, 235), (214, 180, 110, 230))
draw_text_at(gb[0] + 8, gb[3] - 16, '目标 · 立足　3/5 城', font_log,
             (255, 236, 190, 255), 'lm')
draw_text_at(gb[0] + 8, gb[3] - 42, '占据 5 座城池，站稳脚跟', font_log,
             (225, 210, 175, 235), 'lm')

# 省份面板：底部抽屉 720x300
pb = widget_box(720, 300, hcenter=0, bottom=0)
draw_rect(pb, (28, 24, 18, 248), (190, 160, 100, 220))
x0, y0, x1, y1 = pb
draw_text_at(x0 + 18, y1 - 22, '洛阳 ★　归属：曹操　! 敌军图谋此城', font_big,
             (255, 230, 170, 255), 'lm')

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
# 右栏末两行：本城君威加成与守将忠诚（君主驻哪座城、哪座城才吃加成，
# 所以这里报的是「本城君主」，不是「势力君主」）。
# 第 3 行按最新 UI 写：每个目标后挂战前胜算档位，且这座城本回合已出征时
# 必须写明「本回合已出征」，否则玩家点进攻没反应会以为卡了。
right_col = ['自动：治理 · 点内政键换', '待执行：治理（结束回合结算）',
             '可攻 邺·优（本回合已出征）', '可调兵：许昌',
             '君威 曹操·唯才是举 降+15%', '忠诚 君曹操100、武夏侯惇95 等3人']
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

# ---------- 俘虏营弹窗预览（同一张底图 + 模态遮罩）----------
# 三个弹窗共用一层遮罩，这里单独画一张，用来目视检查行距 / 按钮是否挤出面板。
prison_img = img.copy()
d = ImageDraw.Draw(prison_img, 'RGBA')

font_rule = load_font(17)
font_row = load_font(19)
font_row_bold = load_font(20, bold=True)

# 遮罩
d.rectangle([0, 0, VIEW_W, VIEW_H], fill=(10, 8, 6, 205))
pp = widget_box(640, 780, hcenter=0)
draw_rect(pp, (30, 25, 18, 252), (190, 160, 100, 230))
draw_text_at(0, 342, '俘虏营 · 招降 / 放归', font_big, (255, 230, 170, 255))
for j, line in enumerate([
        '招降率 (100-忠诚)/100 + 君威；在位君主不可招降，失去所有城池后可招。',
        '放归降 25 忠诚（旧主猜忌），下次被俘更好招。',
        '招降失败反升 10 点，越劝越硬。 我方君威 降+15%']):
    draw_text_at(-290, 306 - j * 26, line, font_rule, (215, 200, 170, 255), 'lm')

# 按忠诚从低到高排，在位君主（100）沉底、亡国君主（70）浮上来；
# 第 3 行就是「亡国后可招」的样子：身份变「旧主」，显示成功率与加成。
# 第 4 行用敌方君主（袁绍）而不是玩家自己的曹操 —— 自家君主不可能被自己关进营里。
sample = [
    ('蔡瑁', '文官', '刘表', 55, '招降 45%', True),
    ('张郃', '武将', '袁绍', 65, '招降 35%', True),
    ('公孙度', '旧主', '辽东自守 守+20%', 70, '招降 45%', True),
    ('袁绍', '君主', '四世三公 金+20%', 100, '不可招降', False),
]
for i, (name, role, sub, loyalty, chance, can_recruit) in enumerate(sample):
    cy = 183 - i * 108
    row = (-300, cy - 48, 300, cy + 48)
    draw_rect(row, (48, 40, 30, 255), (150, 125, 80, 220))
    color = (235, 205, 160, 255) if role in ('君主', '旧主') else (235, 230, 215, 255)
    draw_text_at(-290, cy + 15, f'{name} · {role} · {sub}', font_row, color, 'lm')
    draw_text_at(-290, cy - 15, f'忠诚 {loyalty} / 100 · {chance}', font_row, color, 'lm')
    for bx, label, lit in [(150, '招降', can_recruit), (252, '放归', True)]:
        b = (bx - 48, cy - 22, bx + 48, cy + 22)
        draw_rect(b, (110, 76, 34, 255) if lit else (52, 48, 42, 255),
                  (230, 190, 110, 255) if lit else (110, 105, 95, 200),
                  2 if lit else 1)
        draw_text_at(bx, cy, label, font_row_bold,
                     (255, 240, 210, 255) if lit else (130, 125, 115, 255))

draw_text_at(0, -215, '在押 4 人　第 1/1 页', font_small, (255, 230, 170, 255))
for bx, label in [(-70, '< 上页'), (70, '下页 >')]:
    b = (bx - 50, -285, bx + 50, -245)
    draw_rect(b, (60, 50, 38, 255), (150, 125, 80, 220))
    draw_text_at(bx, -265, label, font_tiny, (240, 225, 190, 255))
cb = (-110, -363, 110, -307)
draw_rect(cb, (70, 58, 42, 255), (190, 160, 100, 220))
draw_text_at(0, -335, '返回战场', font_mid, (240, 225, 190, 255))

prison_out = os.path.join(ROOT, 'tools', 'ui-prison-preview.png')
prison_img.save(prison_out)
print(f'输出 {prison_out}  {prison_img.size}')
print(f'地图 {MAP_W:.0f}x{MAP_H:.0f}，初始缩放 {fit:.3f}')
