import { Color, Graphics } from 'cc';
import { Geo } from '../core/Geo';
import { ProvinceState } from '../data/Types';
import { FACTION_MAP, NEUTRAL } from '../data/Factions';
import { buildLandPolygon, LAKES } from '../data/Geography';
import { buildTerritories, Pt } from '../core/Territory';
import {
    Route, RoutePoint, RouteKind, buildRoutes, routeKind, routeAttackDirection,
    routeIsActive, trimSegment, arrowTriangle,
} from '../core/Routes';

/**
 * 地图渲染器（历史政治地图风格）
 *
 * 与之前「孤立圆点」的根本区别：每座城拥有一片**色块版图**，
 * 像史书上的割据图那样铺满陆地。这样既能一眼看出势力范围，
 * 点击时也只需判断「落在哪个色块里」，比点小圆点容易得多。
 *
 * ⚠ 版图色块（Voronoi 几何相邻）**不等于**可进攻关系（borders 显式声明）。
 * 因此路网单独占一个 Graphics 层，按 borders 原样画出**全部**通路：
 * 橙红带箭头 = 能进攻，绿色 = 只能调兵，浅色 = 现在打不了。
 *
 * ⚠ 所有路**常驻完整清晰显示**，选中城池只加粗相关路、不淡化其余路；
 * 再加常驻的「可攻目标靶环 / 可出兵城标记」，玩家不点任何城池也能
 * 一眼看出哪里能打、哪里不能打。别把「选中时淡化其余」改回来 ——
 * 那会让玩家误以为路是点击之后才画出来的。
 *
 * 绘制顺序（也是节点层级顺序）：
 *   1. Terrain：海洋 / 陆地 / 版图色块 / 湖泊 / 城池圆点
 *   2. Routes ：常驻路网  ← 整张地图上唯一的「线」
 *   3. Glow   ：选中脉冲光晕（仅选中城，非选中时为空）
 *   4. Highlight：模式目标描边（仅进攻 / 调兵模式）
 *   5. 城池文字标签（Label 节点，最上层）
 *
 * ⚠ 底图**不画任何装饰线**。山脉、河流、州界、版图边界曾和路网叠在一起，
 * 玩家反馈「除了路网还有别的线，看起来太乱」，已全部从绘制流程移除。
 * 数据仍保留在文件顶部（tools/render_real_map.py 还要解析它做地形参考图），
 * 便于以后做「可开关的地形层」；湖泊是色块不是线，保留。
 *
 * ⚠ 开局身份：己方版图提亮一档、己方城池套一圈常驻金环，
 * 让 18 个势力色块里能一眼认出「哪片是我的」。只增强己方、不淡化其余；
 * 金环属于城池标记，不算新增装饰线。
 */

/** 主要山脉 */
const MOUNTAINS: Array<Array<[number, number]>> = [
    [[104.5, 34.2], [106.5, 34.1], [108.0, 33.9], [109.5, 33.9], [111.0, 33.7]],
    [[113.0, 35.6], [113.6, 36.5], [114.0, 37.4], [114.3, 38.5]],
    [[106.0, 32.5], [107.5, 31.8], [109.0, 31.3], [110.2, 31.0]],
    [[114.0, 31.5], [115.2, 31.2], [116.2, 31.0]],
    [[110.5, 25.2], [112.0, 25.4], [113.5, 25.3], [115.0, 25.0]],
    [[107.0, 41.2], [109.5, 41.3], [111.5, 41.0]],
    [[98.0, 38.5], [100.0, 38.2], [101.5, 37.7], [102.6, 37.2]],
];

/** 主要河流 */
const RIVERS: Array<Array<[number, number]>> = [
    [
        [96.5, 35.0], [99.5, 34.8], [101.5, 36.0], [103.0, 36.1],
        [104.5, 37.5], [106.5, 39.5], [108.5, 40.5], [110.5, 40.3],
        [111.0, 38.5], [110.5, 36.5], [110.3, 35.0], [111.0, 34.8],
        [112.5, 34.8], [114.0, 35.0], [115.5, 35.6], [117.0, 36.5],
        [118.5, 37.4], [119.1, 37.8],
    ],
    [
        [91.0, 33.5], [96.0, 32.0], [99.0, 28.5], [101.0, 27.0],
        [102.7, 26.5], [104.2, 28.8], [105.5, 28.9], [106.6, 29.6],
        [108.4, 30.8], [110.5, 30.8], [112.2, 30.4], [114.3, 30.6],
        [116.0, 29.7], [117.5, 30.5], [118.8, 32.0], [120.5, 31.9],
        [121.8, 31.5],
    ],
    [[106.5, 33.1], [107.5, 32.9], [109.0, 32.7], [110.5, 32.6],
        [111.5, 32.4], [112.1, 32.0], [112.6, 31.2], [113.5, 30.8], [114.3, 30.6]],
    [[113.5, 32.5], [115.0, 32.6], [116.5, 32.6], [117.8, 32.9],
        [118.9, 33.3], [120.2, 33.6]],
    [[104.5, 24.5], [106.5, 23.8], [108.5, 23.2], [110.5, 23.1],
        [112.5, 23.1], [113.6, 22.4]],
];

/** 陆地底色（未被版图覆盖的兜底色） */
const LAND_COLOR = new Color(200, 190, 156, 255);
/** 中立/无主版图色 */
const NEUTRAL_COLOR = new Color(178, 172, 158, 255);

/**
 * 路网配色：每条路画「深色外描边 + 亮色内芯」两遍，
 * 这样无论压在深色势力版图还是浅色中立版图上都能看清。
 */
interface RoutePalette {
    outer: [number, number, number];
    inner: [number, number, number];
}
const ROUTE_COLORS: Record<RouteKind, RoutePalette> = {
    front: { outer: [126, 44, 26], inner: [255, 166, 92] },   // 可进攻前线
    supply: { outer: [30, 82, 52], inner: [156, 228, 166] },  // 己方补给/调兵
    other: { outer: [62, 52, 40], inner: [238, 226, 198] },   // 与玩家无关
};
/** 前线箭头：亮金芯 + 深棕边 */
const ARROW_FILL = new Color(255, 226, 138, 255);
const ARROW_EDGE = new Color(96, 40, 20, 255);
/** 常驻「可攻目标 / 可出兵城」标记 */
const ATTACK_MARK = new Color(226, 74, 40, 240);
/** 我方城池的常驻金环（只画在己方城池上，不是贯穿地图的装饰线） */
const OWN_RING = new Color(255, 226, 138, 255);
const OWN_RING_EDGE = new Color(96, 64, 20, 255);

function hexToColor(hex: string): Color {
    const c = new Color();
    Color.fromHEX(c, hex);
    return c;
}

/** 调整亮度：f>1 变亮，f<1 变暗 */
function shade(c: Color, f: number): Color {
    return new Color(
        Math.min(255, Math.round(c.r * f)),
        Math.min(255, Math.round(c.g * f)),
        Math.min(255, Math.round(c.b * f)),
        c.a,
    );
}

/** 路网当前聚焦状态 */
interface RouteFocus {
    selectedId: string | null;
    targetIds: string[];
}

export class MapRenderer {
    private g: Graphics;
    private routes: Graphics;
    private glow: Graphics;
    private highlights: Graphics;

    /** 城池标记半径 */
    public static readonly NODE_RADIUS = 17;
    public static readonly CITY_RADIUS = 21;

    /** 城 id -> 版图多边形（地图坐标），构建一次后复用 */
    private territories: Map<string, Pt[]> = new Map();

    /** 最近一次 draw() 的省份数组（路网单独重绘时要用） */
    private lastProvinces: ProvinceState[] = [];
    /** 玩家势力 id（路网按它区分前线/补给线） */
    private playerFaction = '';
    private routeFocus: RouteFocus = { selectedId: null, targetIds: [] };
    private routesVisible = true;
    /** mapRoot 的缩放；线宽按它取倒数，保持屏幕上的粗细恒定 */
    private routeScale = 1;

    constructor(g: Graphics, routes: Graphics, glow: Graphics, highlights: Graphics) {
        this.g = g;
        this.routes = routes;
        this.glow = glow;
        this.highlights = highlights;
    }

    /** 构建版图（省份变化后需重建） */
    private ensureTerritories(provinces: ProvinceState[]): void {
        if (this.territories.size === provinces.length) {
            return;
        }
        const landLL = buildLandPolygon(Geo.lonMin, Geo.latMin, Geo.latMax);
        const landPoly: Pt[] = landLL.map(([lon, lat]) => {
            const p = Geo.project(lat, lon);
            return { x: p.x, y: p.y };
        });
        const cities = provinces.map((p) => {
            const pt = Geo.project(p.lat, p.lon);
            return { id: p.id, x: pt.x, y: pt.y };
        });
        this.territories = buildTerritories(cities, landPoly);
    }

    /**
     * 选势力预览：按传入的归属着色，且**不给任何城画玩家金环**。
     *
     * 为什么单独开一个方法，而不是让调用方写 `draw(list, '')`：
     * `tools/sim-faction-identity.ts` 有一条守卫要求「所有底图重绘都带
     * playerFaction」，那条守卫防的是正常游戏画面漏传、导致金环不跟着
     * 换势力走。选势力是唯一的例外（玩家还没执掌任何势力），
     * 把例外圈在这一处语义化方法里，守卫不必放宽。
     *
     * 路网也会按「无主视角」重画成不可进攻的浅色 —— 选势力阶段本来
     * 就不该出现进攻箭头，这正好是想要的效果。
     */
    public drawPreview(provinces: ProvinceState[]): void {
        const keep = this.playerFaction;
        this.draw(provinces, '');
        // 预览只影响这一次绘制：交互与后续重绘仍按真实玩家势力判断
        this.playerFaction = keep;
    }

    /** 绘制整张地图（含按当前归属重新着色的路网） */
    public draw(provinces: ProvinceState[], playerFaction: string = this.playerFaction): void {
        const g = this.g;
        g.clear();
        this.ensureTerritories(provinces);

        // 海洋
        g.fillColor = new Color(74, 106, 128, 255);
        g.rect(-Geo.width / 2, -Geo.height / 2, Geo.width, Geo.height);
        g.fill();

        // 陆地底色（兜底）
        const landLL = buildLandPolygon(Geo.lonMin, Geo.latMin, Geo.latMax);
        const landPts: Pt[] = landLL.map(([lon, lat]) => {
            const p = Geo.project(lat, lon);
            return { x: p.x, y: p.y };
        });
        g.fillColor = LAND_COLOR;
        this.fillPolygon(g, landPts);

        // 版图（按势力着色）
        for (const p of provinces) {
            const poly = this.territories.get(p.id);
            if (!poly) {
                continue;
            }
            const faction = FACTION_MAP[p.owner];
            if (faction && p.owner !== NEUTRAL) {
                const base = hexToColor(faction.color);
                // 版图用较浅的势力色，保证城池标记与文字清晰。
                // 己方再提亮一档：18 个势力混色时，不这样根本找不出哪片是自己的。
                // 只增强己方、绝不淡化其余（淡化会被玩家读成「没画」）。
                g.fillColor = shade(base, p.owner === playerFaction ? 1.45 : 1.25);
            } else {
                g.fillColor = NEUTRAL_COLOR;
            }
            this.fillPolygon(g, poly);
        }

        // ⚠ 底图不画任何装饰线：整张地图上只有 Routes 图层的路网是「线」。
        // 山脉 / 河流 / 州界 / 版图边界曾与路网叠在一起，玩家反馈太乱，已全部移除。
        // 版图靠色块本身区分归属；湖泊是色块不是线，保留。
        // 己方城池的金环属于「城池标记」而非装饰线，见 drawProvinces()。
        this.drawLakes(g);
        this.drawProvinces(g, provinces, playerFaction);

        // 归属变化后，前线与补给线的分类也要跟着变，所以路网必须一起重画
        this.lastProvinces = provinces;
        this.playerFaction = playerFaction;
        this.renderRoutes();
    }

    /** 湖泊 */
    private drawLakes(g: Graphics): void {
        for (const [lon, lat, rLon, rLat] of LAKES) {
            const c = Geo.project(lat, lon);
            const rx = Math.abs(Geo.project(lat, lon + rLon).x - c.x);
            const ry = Math.abs(Geo.project(lat + rLat, lon).y - c.y);
            g.fillColor = new Color(86, 132, 166, 230);
            g.ellipse(c.x, c.y, rx, ry);
            g.fill();
        }
    }

    /** 城池标记：小圆点 + 内环；己方城池再加一圈常驻金环 */
    private drawProvinces(g: Graphics, provinces: ProvinceState[], playerFaction: string): void {
        for (const p of provinces) {
            const pt = Geo.project(p.lat, p.lon);
            const r = p.def.city ? MapRenderer.CITY_RADIUS : MapRenderer.NODE_RADIUS;
            const faction = FACTION_MAP[p.owner];

            // 外描边
            g.fillColor = new Color(36, 30, 22, 235);
            g.circle(pt.x, pt.y, r + 2.5);
            g.fill();

            if (faction && p.owner !== NEUTRAL) {
                const c = hexToColor(faction.color);
                g.fillColor = shade(c, 0.85);
            } else {
                g.fillColor = NEUTRAL_COLOR;
            }
            g.circle(pt.x, pt.y, r);
            g.fill();

            // 大城加内环
            if (p.def.city) {
                g.lineWidth = 2;
                g.strokeColor = new Color(250, 240, 210, 220);
                g.circle(pt.x, pt.y, r - 6);
                g.stroke();
            }

            // 己方城池：再套一圈常驻金环。开局要一眼找到自己的势力，
            // 18 种势力色混在一起时，光靠颜色认不出来。金环是城池标记
            // 的一部分、只画在己方城上，不是贯穿地图的装饰线，
            // 也不会和路网抢视线。
            if (p.owner === playerFaction) {
                const ring = r + 6.5;
                g.lineWidth = 4.5;
                g.strokeColor = OWN_RING_EDGE;
                g.circle(pt.x, pt.y, ring);
                g.stroke();
                g.lineWidth = 2.5;
                g.strokeColor = OWN_RING;
                g.circle(pt.x, pt.y, ring);
                g.stroke();
            }
        }
    }

    // ==================================================================
    // 常驻路网
    // ==================================================================

    /** 设置选中城与其可用目标；只重画 routes 层，不动地形 */
    public setRouteFocus(selectedId: string | null, targetIds: string[]): void {
        this.routeFocus = { selectedId, targetIds };
        this.renderRoutes();
    }

    /** 顶栏「路网」开关 */
    public setRoutesVisible(visible: boolean): void {
        this.routesVisible = visible;
        this.renderRoutes();
    }

    /** 地图缩放时回调：线宽取倒数，避免放大后驿道粗得盖住城池 */
    public setRouteScale(scale: number): void {
        const s = Math.max(0.5, Math.min(3, scale));
        if (Math.abs(s - this.routeScale) < 0.001) {
            return;
        }
        this.routeScale = s;
        this.renderRoutes();
    }

    /**
     * 重画全部通路。
     *
     * ⚠ 所有路**常驻完整显示**，不随选中态变淡 —— 玩家不点任何城池，
     * 也要能看清整张图的连接关系，以及哪些路能打、哪些不能打。
     * 之前把非前线压成淡底纹、选中又淡化其余，实际效果就是
     * 「好像点了城池才画路」，这是设计失误，别再改回去。
     * 选中只做加粗 + 放大箭头，两遍绘制保证聚焦路压在最上层。
     */
    private renderRoutes(): void {
        const g = this.routes;
        g.clear();
        if (!this.routesVisible || this.lastProvinces.length === 0) {
            return;
        }

        const owners = new Map<string, string>();
        const radii = new Map<string, number>();
        for (const p of this.lastProvinces) {
            owners.set(p.id, p.owner);
            radii.set(p.id, p.def.city ? MapRenderer.CITY_RADIUS : MapRenderer.NODE_RADIUS);
        }

        const routes = buildRoutes(this.lastProvinces);
        const inv = 1 / this.routeScale;

        for (let pass = 0; pass < 2; pass++) {
            for (const r of routes) {
                const active = routeIsActive(r, this.routeFocus.selectedId, this.routeFocus.targetIds);
                if ((pass === 1) !== active) {
                    continue;
                }
                this.drawOneRoute(
                    g, r,
                    owners.get(r.aId) || NEUTRAL,
                    owners.get(r.bId) || NEUTRAL,
                    radii.get(r.aId) || MapRenderer.NODE_RADIUS,
                    radii.get(r.bId) || MapRenderer.NODE_RADIUS,
                    active,
                    inv,
                );
            }
        }

        this.drawAttackMarks(g, routes, owners, radii, inv);
    }

    /**
     * 常驻标记：不用点城池，也能一眼看出「哪几座城现在能被打 / 从哪能出兵」。
     * 目标城画橙红靶环，可出兵的己方城在右上角点一个橙红实心点。
     */
    private drawAttackMarks(
        g: Graphics,
        routes: Route[],
        owners: Map<string, string>,
        radii: Map<string, number>,
        inv: number,
    ): void {
        const targets = new Map<string, RoutePoint>();
        const launches = new Map<string, RoutePoint>();
        for (const r of routes) {
            const dir = routeAttackDirection(
                r,
                owners.get(r.aId) || NEUTRAL,
                owners.get(r.bId) || NEUTRAL,
                this.playerFaction,
            );
            if (dir) {
                targets.set(dir.toId, dir.to);
                launches.set(dir.fromId, dir.from);
            }
        }

        // 可攻目标：城池圆点外一圈橙红靶环
        g.lineWidth = 3 * inv;
        g.strokeColor = ATTACK_MARK;
        targets.forEach((pt, id) => {
            const r = radii.get(id) || MapRenderer.NODE_RADIUS;
            g.circle(pt.x, pt.y, r + 8);
            g.stroke();
        });

        // 可出兵的己方城：右上角一个橙红实心点
        g.fillColor = ATTACK_MARK;
        launches.forEach((pt, id) => {
            const r = radii.get(id) || MapRenderer.NODE_RADIUS;
            g.circle(pt.x + r * 0.78, pt.y + r * 0.78, 4.2 * inv);
            g.fill();
        });
    }

    /** 画一条路：外描边 + 内芯 + 端点 + 前线箭头 */
    private drawOneRoute(
        g: Graphics,
        route: Route,
        ownerA: string,
        ownerB: string,
        radiusA: number,
        radiusB: number,
        active: boolean,
        inv: number,
    ): void {
        const kind = routeKind(ownerA, ownerB, this.playerFaction);
        const pal = ROUTE_COLORS[kind];
        // 所有路都清晰常驻。「能不能进攻」靠颜色 + 箭头区分，
        // 不靠把其余路压成看不见的底纹（那样等于没画路网）。
        const alphaOuter = active ? 255 : kind === 'other' ? 185 : 250;
        const alphaInner = active ? 255 : kind === 'other' ? 210 : 255;
        // 两端各让出 4px，驿道从城池圆点外缘起笔，不压住圆点
        const seg = trimSegment(route.a, route.b, radiusA + 4, radiusB + 4);
        if (!seg) {
            return;
        }

        const outerW = (active ? 9
            : kind === 'front' ? 6.2 : kind === 'supply' ? 5 : 4.2) * inv;
        const innerW = (active ? 4.2
            : kind === 'front' ? 2.9 : kind === 'supply' ? 2.2 : 2) * inv;

        g.lineWidth = outerW;
        g.strokeColor = new Color(pal.outer[0], pal.outer[1], pal.outer[2], alphaOuter);
        g.moveTo(seg.a.x, seg.a.y);
        g.lineTo(seg.b.x, seg.b.y);
        g.stroke();

        g.lineWidth = innerW;
        g.strokeColor = new Color(pal.inner[0], pal.inner[1], pal.inner[2], alphaInner);
        g.moveTo(seg.a.x, seg.a.y);
        g.lineTo(seg.b.x, seg.b.y);
        g.stroke();

        // 两端各点一个「路口」，明确线是接到哪两座城的
        g.fillColor = new Color(pal.inner[0], pal.inner[1], pal.inner[2], alphaInner);
        const dot = 2.6 * inv;
        g.circle(seg.a.x, seg.a.y, dot);
        g.fill();
        g.circle(seg.b.x, seg.b.y, dot);
        g.fill();

        // 只有前线画箭头，方向固定为「玩家城 -> 非玩家城」。
        // 常驻画出全部箭头：不点城池也知道「哪几条路现在能打」。
        const dir = routeAttackDirection(route, ownerA, ownerB, this.playerFaction);
        if (dir) {
            const tri = arrowTriangle(
                dir.from, dir.to, 0.62,
                (active ? 19 : 14) * inv,
                (active ? 7.5 : 5.5) * inv,
            );
            // 用「深色大三角 + 亮金小三角」两次纯填充做描边效果：
            // 不依赖 Graphics 在 fill() 之后是否还保留路径，跨版本更稳。
            const edgeTri = arrowTriangle(
                dir.from, dir.to, 0.62,
                (active ? 23 : 17) * inv,
                (active ? 9.5 : 7) * inv,
            );
            if (tri.length === 3 && edgeTri.length === 3) {
                this.fillTriangle(g, edgeTri,
                    new Color(ARROW_EDGE.r, ARROW_EDGE.g, ARROW_EDGE.b, alphaOuter));
                this.fillTriangle(g, tri,
                    new Color(ARROW_FILL.r, ARROW_FILL.g, ARROW_FILL.b, alphaInner));
            }
        }
    }

    /** 填充一个三角形（每次都从新的 moveTo 起一条子路径） */
    private fillTriangle(g: Graphics, tri: RoutePoint[], color: Color): void {
        g.fillColor = color;
        g.moveTo(tri[0].x, tri[0].y);
        g.lineTo(tri[1].x, tri[1].y);
        g.lineTo(tri[2].x, tri[2].y);
        g.close();
        g.fill();
    }

    /** 高亮目标（沿版图描边，比小圆环更醒目） */
    public drawHighlights(
        targets: ProvinceState[],
        mode: 'move' | 'attack' | 'select',
        origin?: ProvinceState,
    ): void {
        const h = this.highlights;
        h.clear();
        if (targets.length === 0) {
            return;
        }
        const color = mode === 'attack'
            ? new Color(235, 60, 45, 255)
            : mode === 'move'
                ? new Color(50, 190, 110, 255)
                : new Color(255, 215, 110, 255);

        // 连接关系已经由常驻路网（实线 + 箭头）表达，这里不再重复画虚线，
        // 只给出发城加一圈「起兵」标记，避免两层线叠在一起显脏。
        if (origin) {
            const a = Geo.project(origin.lat, origin.lon);
            const r0 = origin.def.city ? MapRenderer.CITY_RADIUS : MapRenderer.NODE_RADIUS;
            h.lineWidth = 3;
            h.strokeColor = new Color(color.r, color.g, color.b, 220);
            h.circle(a.x, a.y, r0 + 7);
            h.stroke();
        }

        // 版图描边 + 城池靶环
        for (const t of targets) {
            const poly = this.territories.get(t.id);
            h.lineWidth = 4;
            h.strokeColor = color;
            if (poly) {
                this.strokePolygon(h, poly);
            }
            const pt = Geo.project(t.lat, t.lon);
            const r = t.def.city ? MapRenderer.CITY_RADIUS : MapRenderer.NODE_RADIUS;
            h.lineWidth = 3;
            h.circle(pt.x, pt.y, r + 9);
            h.stroke();
        }
    }

    public clearHighlights(): void {
        this.highlights.clear();
    }

    /** 选中脉冲光晕 */
    public drawGlow(provinces: ProvinceState[], t: number): void {
        const g = this.glow;
        g.clear();
        const alpha = Math.floor(110 + 70 * Math.sin(t * 3));
        g.lineWidth = 4 + Math.sin(t * 3) * 1.5;
        g.strokeColor = new Color(255, 235, 170, alpha);
        for (const p of provinces) {
            const poly = this.territories.get(p.id);
            if (poly) {
                this.strokePolygon(g, poly);
            }
        }
    }

    private fillPolygon(g: Graphics, pts: Pt[]): void {
        if (pts.length < 3) {
            return;
        }
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            g.lineTo(pts[i].x, pts[i].y);
        }
        g.close();
        g.fill();
    }

    private strokePolygon(g: Graphics, pts: Pt[]): void {
        if (pts.length < 3) {
            return;
        }
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            g.lineTo(pts[i].x, pts[i].y);
        }
        g.close();
        g.stroke();
    }

    /**
     * 查询某点落在哪座城的版图内（供点击使用）
     *
     * ⚠ 参数是**地图局部坐标**（Geo.project 的坐标系，中心为原点、未缩放）。
     * MapInput.pickAt 会先把屏幕坐标经 MapCamera.screenToMap 换算后再传进来；
     * 直接传屏幕坐标会导致「点 A 命中 B」。
     */
    public territoryAt(provinces: ProvinceState[], mx: number, my: number): ProvinceState | null {
        this.ensureTerritories(provinces);
        for (const p of provinces) {
            const poly = this.territories.get(p.id);
            if (!poly) {
                continue;
            }
            // 射线法
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i].x;
                const yi = poly[i].y;
                const xj = poly[j].x;
                const yj = poly[j].y;
                if ((yi > my) !== (yj > my)
                    && mx < ((xj - xi) * (my - yi)) / (yj - yi || 1e-9) + xi) {
                    inside = !inside;
                }
            }
            if (inside) {
                return p;
            }
        }
        return null;
    }
}
