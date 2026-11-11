/**
 * 地图相机（纯逻辑，无引擎依赖）
 *
 * 把「屏幕坐标 <-> 地图坐标」的换算、缩放、拖拽边界、命中检测
 * 全部集中在这里，好处是：
 *   1. MapInput 只负责接收触摸事件，逻辑可以单测；
 *   2. 可以脱离引擎「模拟试玩」——用真实屏幕坐标去点每一座城，
 *      验证它到底点不点得到。
 *
 * 坐标约定与 Cocos 一致：屏幕/地图坐标都是 y 轴向上为正。
 */
import { Geo } from './Geo';

/** 屏幕（设计分辨率）尺寸 */
export interface ViewSize {
    width: number;
    height: number;
}

/** 一座城的屏幕相关信息 */
export interface CityPoint {
    id: string;
    lat: number;
    lon: number;
    city: boolean;
}

/** 命中半径（地图局部坐标，未缩放） */
const BASE_HIT_RADIUS = 26;
const CITY_HIT_RADIUS = 32;

/**
 * 命中判定的屏幕最小半径（像素）
 *
 * 手指标定：手指接触面积约 40-50px，可接受的命中圈至少 22px 半径。
 * 这里保证**屏幕上的命中圈不小于这个值**，避免缩小地图后点不中。
 */
const MIN_SCREEN_HIT_RADIUS = 22;

export class MapCamera {
    /** 地图根节点的位置（屏幕中心为原点） */
    public x = 0;
    public y = 0;
    /** 缩放 */
    public zoom = 1;

    public readonly view: ViewSize;

    /** 缩放上下限 */
    public static readonly ZOOM_MIN = 0.45;
    public static readonly ZOOM_MAX = 2.2;

    constructor(view: ViewSize) {
        this.view = view;
    }

    /** 地图在屏幕上的显示宽度（像素） */
    public get displayWidth(): number {
        return Geo.width * this.zoom;
    }

    public get displayHeight(): number {
        return Geo.height * this.zoom;
    }

    /**
     * 缩放下限：填满屏幕高度
     *
     * 竖屏下地图宽高比 0.93、屏幕 0.56，形状不同无法同时填满宽高。
     * 取下限 = 填满高度，保证任何时候都不会出现"地图比屏幕矮、上下露白"。
     * 更小的缩放会让地图缩成中间一小块，玩家看不清也点不准。
     */
    public get minZoom(): number {
        const fillHeight = this.view.height / Geo.height;
        return Math.max(MapCamera.ZOOM_MIN, fillHeight);
    }

    /** 铺满高度的缩放（作为「查看全图」的参考值） */
    public get fillHeightZoom(): number {
        return this.view.height / Geo.height;
    }

    /**
     * 设置缩放，并保持某个屏幕点对应的地图点不动
     *
     * @param target 新缩放值
     * @param anchorScreen 以屏幕上的哪个点为锚（默认屏幕中心）
     */
    public setZoom(target: number, anchorScreen?: { x: number; y: number }): void {
        const lo = this.minZoom;
        const next = Math.min(MapCamera.ZOOM_MAX, Math.max(lo, target));
        if (Math.abs(next - this.zoom) < 1e-6) {
            return;
        }
        const anchor = anchorScreen ?? { x: 0, y: 0 };
        // 锚点当前对应的地图坐标
        const mapPt = this.screenToMap(anchor.x, anchor.y);
        this.zoom = next;
        // 保持该地图点仍在锚点屏幕位置
        this.x = anchor.x - mapPt.x * next;
        this.y = anchor.y - mapPt.y * next;
        this.clamp();
    }

    /** 拖动：按屏幕位移平移地图 */
    public panBy(dxScreen: number, dyScreen: number): void {
        this.x += dxScreen;
        this.y += dyScreen;
        this.clamp();
    }

    /** 屏幕坐标 -> 地图局部坐标 */
    public screenToMap(sx: number, sy: number): { x: number; y: number } {
        return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom };
    }

    /** 地图局部坐标 -> 屏幕坐标 */
    public mapToScreen(mx: number, my: number): { x: number; y: number } {
        return { x: mx * this.zoom + this.x, y: my * this.zoom + this.y };
    }

    /** 某座城在屏幕上的位置 */
    public cityScreen(c: CityPoint): { x: number; y: number } {
        const p = Geo.project(c.lat, c.lon);
        return this.mapToScreen(p.x, p.y);
    }

    /**
     * 限制地图位置，避免把地图拖出屏幕外
     *
     * 坐标关系（全项目统一为「中心为原点」）：
     *   - 地图内容以自身中心为原点，范围 [-mw/2, +mw/2]
     *   - mapRoot 的本地坐标 = 地图坐标 * zoom + cam
     *   - 屏幕可见范围 [-屏宽/2, +屏宽/2]
     *
     * 想让地图铺满屏幕，需要：
     *   地图左边缘 cam.x - mw/2 <= -屏宽/2
     *   地图右边缘 cam.x + mw/2 >= +屏宽/2
     * => cam.x ∈ [屏宽/2 - mw/2, -屏宽/2 + mw/2]
     */
    public clamp(): void {
        const mw = this.displayWidth;
        const mh = this.displayHeight;
        const halfW = this.view.width / 2;
        const halfH = this.view.height / 2;
        const mapHalfW = mw / 2;
        const mapHalfH = mh / 2;

        if (mw <= this.view.width) {
            // 地图比屏幕窄：居中
            this.x = 0;
        } else {
            const limitX = mapHalfW - halfW;   // 可移动的最大偏移
            this.x = Math.min(limitX, Math.max(-limitX, this.x));
        }

        if (mh <= this.view.height) {
            this.y = 0;
        } else {
            const limitY = mapHalfH - halfH;
            this.y = Math.min(limitY, Math.max(-limitY, this.y));
        }
    }

    /**
     * 判定某屏幕坐标点中的是哪座城
     *
     * 判定规则：
     *   1. 取屏幕上距离最近的一座城；
     *   2. 若手指落点在该城的「命中圈」内则命中。
     * 命中半径按缩放反算，保证放大后依然好点、缩小后不至于误点。
     */
    public pick(sx: number, sy: number, cities: CityPoint[]): CityPoint | null {
        const map = this.screenToMap(sx, sy);
        let best: CityPoint | null = null;
        let bestDist = Infinity;
        for (const c of cities) {
            const p = Geo.project(c.lat, c.lon);
            const dx = p.x - map.x;
            const dy = p.y - map.y;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                best = c;
            }
        }
        if (!best) {
            return null;
        }
        const baseR = best.city ? CITY_HIT_RADIUS : BASE_HIT_RADIUS;
        // 把「地图坐标的半径」换算成屏幕半径后，再保证不低于最小可点半径
        const screenR = Math.max(baseR * this.zoom, MIN_SCREEN_HIT_RADIUS);
        // 换回地图坐标比较
        const r = screenR / Math.max(MapCamera.ZOOM_MIN, this.zoom);
        return bestDist <= r * r ? best : null;
    }

    /** 该城在屏幕上的可见半径（像素） */
    public cityScreenRadius(c: CityPoint): number {
        const r = c.city ? 21 : 17;
        return r * this.zoom;
    }

    /**
     * 某座城当前是否在屏幕可视区域内
     *
     * 注意：屏幕坐标是**以屏幕中心为原点**的，
     * 范围是 [-宽/2, +宽/2] × [-高/2, +高/2]。
     * （这里曾误用 0..width，导致几乎所有城池都被判为"不在屏幕内"。）
     */
    public isOnScreen(c: CityPoint, margin = 0): boolean {
        const s = this.cityScreen(c);
        const halfW = this.view.width / 2 + margin;
        const halfH = this.view.height / 2 + margin;
        return s.x >= -halfW && s.x <= halfW
            && s.y >= -halfH && s.y <= halfH;
    }

    /** 把某座城移到屏幕中心 */
    public centerOn(c: CityPoint): void {
        const p = Geo.project(c.lat, c.lon);
        // 让该城落在屏幕中心：该城地图坐标 * zoom + cam = 0
        this.x = -p.x * this.zoom;
        this.y = -p.y * this.zoom;
        this.clamp();
    }

    /**
     * 按「初始视野」策略重置相机
     *
     * 这是**游戏和测试共用的唯一入口**，避免两边各写一套导致不同步。
     *
     * 策略：填满屏幕高度。
     *   竖屏下地图偏扁，若只填满宽度的 85%，地图会比屏幕矮 190px，
     *   下方留一条纯海色空白，看起来像"地图没铺满"。
     *   填满高度则上下严丝合缝，左右超出部分靠拖动查看——这是地图类应用的标准做法。
     *
     * 额外保证：城池圆点直径 >= 26px（手指点击下限）。
     */
    public resetToStartView(
        focusLat: number, focusLon: number, nodeSize = 34,
    ): void {
        const fillHeight = this.view.height / Geo.height;
        const minNodeScale = 26 / nodeSize;
        this.zoom = Math.min(
            MapCamera.ZOOM_MAX,
            Math.max(fillHeight, minNodeScale, MapCamera.ZOOM_MIN),
        );

        const f = Geo.project(focusLat, focusLon);
        this.x = -f.x * this.zoom;
        this.y = -f.y * this.zoom;
        this.clamp();
    }
}
