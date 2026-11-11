import { EventTouch, Node, UITransform, Vec2, Vec3, input, Input, EventMouse, view } from 'cc';
import { Geo } from '../core/Geo';
import { MapCamera, CityPoint } from '../core/MapCamera';
import { ProvinceState } from '../data/Types';

/**
 * 地图交互控制
 *
 * 只负责「把触摸事件转成相机操作」，所有几何逻辑在 core/MapCamera 里，
 * 那部分可以脱离引擎做模拟试玩（tools/sim-play.ts）。
 *
 * 交互约定：
 *   - 单指拖动平移
 *   - 双指捏合缩放（以双指中点为锚，符合直觉）
 *   - 滚轮缩放（编辑器/PC 调试）
 *   - 点击（位移小于阈值）命中城池
 */
export class MapInput {
    private mapRoot: Node;
    private provinces: ProvinceState[];
    private camera: MapCamera;

    /**
     * 拖动判定阈值（屏幕像素）
     *
     * 真机上手指点击时会有 3~8px 的抖动，12px 太严会把点击误判成拖动，
     * 表现为「点了没反应」。放宽到 22px 更稳，同时仍然能区分真正的拖动。
     */
    private static readonly DRAG_THRESHOLD = 22;

    private dragging = false;
    private dragMoved = false;
    private startPos = new Vec2();
    private lastPos = new Vec2();
    private pinchDist = 0;

    /** 点击回调 */
    public onPick: ((p: ProvinceState | null) => void) | null = null;
    /** 缩放变化回调 */
    public onZoom: ((scale: number) => void) | null = null;

    /** 版图命中回调（点色块任意位置即可选中，比点小圆点顺手） */
    private territoryPicker: ((mx: number, my: number) => ProvinceState | null) | null = null;

    constructor(mapRoot: Node, provinces: ProvinceState[]) {
        this.mapRoot = mapRoot;
        this.provinces = provinces;
        // 用真实设计分辨率构造相机
        const vs = view.getVisibleSize();
        this.camera = new MapCamera({ width: vs.width, height: vs.height });
        // 从节点现状同步一次（GameController 已经设好初始缩放与位置）
        this.syncFromNode();
        this.bind();
    }

    /** 当前缩放值 */
    public get scale(): number {
        return this.camera.zoom;
    }

    /** 从场景节点读取当前缩放/位置到相机 */
    private syncFromNode(): void {
        const s = this.mapRoot.scale.x;
        this.camera.zoom = s;
        this.camera.x = this.mapRoot.position.x;
        this.camera.y = this.mapRoot.position.y;
    }

    /** 把相机状态写回场景节点 */
    private applyToNode(): void {
        this.mapRoot.setScale(new Vec3(this.camera.zoom, this.camera.zoom, 1));
        this.mapRoot.setPosition(new Vec3(this.camera.x, this.camera.y, this.mapRoot.position.z));
    }

    /** 更新省份引用（重开一局时调用） */
    public setProvinces(list: ProvinceState[]): void {
        this.provinces = list;
    }

    private cityPoints(): CityPoint[] {
        return this.provinces.map((p) => ({
            id: p.id, lat: p.lat, lon: p.lon, city: p.def.city,
        }));
    }

    private bind(): void {
        const node = this.mapRoot;
        node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onWheel, this);
    }

    private onTouchStart(e: EventTouch): void {
        const loc = e.getUILocation();
        this.startPos.set(loc.x, loc.y);
        this.lastPos.set(loc.x, loc.y);
        this.dragging = true;
        this.dragMoved = false;
        const touches = e.getTouches();
        if (touches.length >= 2) {
            const p0 = touches[0].getUILocation();
            const p1 = touches[1].getUILocation();
            this.pinchDist = Math.sqrt((p0.x - p1.x) ** 2 + (p0.y - p1.y) ** 2);
        }
    }

    private onTouchMove(e: EventTouch): void {
        if (!this.dragging) {
            return;
        }
        const touches = e.getTouches();
        if (touches.length >= 2) {
            const p0 = touches[0].getUILocation();
            const p1 = touches[1].getUILocation();
            const dist = Math.sqrt((p0.x - p1.x) ** 2 + (p0.y - p1.y) ** 2);
            if (this.pinchDist > 0) {
                // 以双指中点为锚缩放，手指下的位置不会跑。
                // 锚点必须转成相机空间（中心原点），否则缩放会往右下角跳。
                const vs = view.getVisibleSize();
                const cx = (p0.x + p1.x) / 2 - vs.width * 0.5;
                const cy = (p0.y + p1.y) / 2 - vs.height * 0.5;
                this.camera.setZoom(this.camera.zoom * (dist / this.pinchDist), { x: cx, y: cy });
                this.applyToNode();
                if (this.onZoom) {
                    this.onZoom(this.camera.zoom);
                }
                this.pinchDist = dist;
            }
            return;
        }

        const loc = e.getUILocation();
        const dx = loc.x - this.lastPos.x;
        const dy = loc.y - this.lastPos.y;
        this.lastPos.set(loc.x, loc.y);
        const totalDx = loc.x - this.startPos.x;
        const totalDy = loc.y - this.startPos.y;
        if (Math.abs(totalDx) > MapInput.DRAG_THRESHOLD
            || Math.abs(totalDy) > MapInput.DRAG_THRESHOLD) {
            this.dragMoved = true;
        }
        this.camera.panBy(dx, dy);
        this.applyToNode();
    }

    private onTouchEnd(e: EventTouch): void {
        if (!this.dragging) {
            return;
        }
        this.dragging = false;
        if (!this.dragMoved) {
            const loc = e.getUILocation();
            const hit = this.pickAt(loc.x, loc.y);
            if (this.onPick) {
                this.onPick(hit);
            }
        }
        this.pinchDist = 0;
    }

    /**
     * 双击城池：放大并居中
     *
     * 手感和地图类 App 一致——玩家看到想细看的地方双击即可放大，
     * 不用慢慢地捏合。也顺带解决了「城池小、看不清名字」的问题。
     */
    public zoomInOn(city: ProvinceState, factor = 1.6): void {
        this.camera.setZoom(this.camera.zoom * factor, { x: 0, y: 0 });
        this.camera.centerOn({ id: city.id, lat: city.lat, lon: city.lon, city: city.def.city });
        this.applyToNode();
        if (this.onZoom) {
            this.onZoom(this.camera.zoom);
        }
    }

    /** 重置到全局视野 */
    public resetView(): void {
        this.camera.setZoom(this.camera.minZoom);
        this.camera.x = 0;
        this.camera.y = 0;
        this.camera.clamp();
        this.applyToNode();
        if (this.onZoom) {
            this.onZoom(this.camera.zoom);
        }
    }

    /**
     * 用当前节点的缩放/位置重算一次边界
     *
     * 用途：GameController 初始化时直接设置了 mapRoot 的位置，
     * 但没检查地图是否铺满屏幕（会出现底部露白）。
     * 这里把节点状态读进相机、做一次 clamp、再写回去。
     */
    public reclampView(): void {
        this.syncFromNode();
        this.camera.clamp();
        this.applyToNode();
    }

    private onWheel(e: EventMouse): void {
        const ratio = e.getScrollY() > 0 ? 0.9 : 1.1;
        this.camera.setZoom(this.camera.zoom * ratio);
        this.applyToNode();
        if (this.onZoom) {
            this.onZoom(this.camera.zoom);
        }
    }

    /**
     * UI 空间坐标 -> 相机空间坐标
     *
     * EventTouch.getUILocation() 的原点在屏幕**左下角**，
     * 而相机（以及 mapRoot 的本地坐标）原点在 **Canvas 中心**。
     * 所有需要与地图几何比较的地方都必须先过这个转换。
     */
    private uiToCamera(uiX: number, uiY: number): { x: number; y: number } {
        const vs = view.getVisibleSize();
        return { x: uiX - vs.width * 0.5, y: uiY - vs.height * 0.5 };
    }

    /** 命中检测：UI 空间坐标 -> 城池 */
    public pickAt(uiX: number, uiY: number): ProvinceState | null {
        if (!this.mapRoot.isValid) {
            return null;
        }
        // ⚠ 坐标系转换（这里曾是最大的 bug）
        // 不转换会整体偏移半个屏幕，表现为「点哪都没反应」。
        const p = this.uiToCamera(uiX, uiY);

        // ⚠ 这里**不要**调 syncFromNode()。
        //
        // 约定：相机是唯一真相源（single source of truth），
        // 只能「相机 -> 节点」单向写入，不能反读。
        //
        // 优先用**版图**命中：点色块任意位置都能选中，
        // 比"必须点中 35px 的小圆点"容易得多（这才是"点起来顺手"的关键）。
        if (this.territoryPicker) {
            // ⚠ 版图多边形存的是**地图局部坐标**（Geo.project 的结果），
            // 而 p 是屏幕（相机空间）坐标。必须先做一次 screenToMap。
            // 漏掉这一步时误差 = 地图坐标 * (zoom - 1) + cam，
            // 初始视野下就会「点 A 命中 B」，双击放大聚焦后更是全点错。
            const mapPt = this.camera.screenToMap(p.x, p.y);
            const hit = this.territoryPicker(mapPt.x, mapPt.y);
            if (hit) {
                return hit;
            }
        }

        // 兜底：版图没命中时（例如点到海里），退回到「最近城池 + 吸附半径」
        const hit = this.camera.pick(p.x, p.y, this.cityPoints());
        if (!hit) {
            return null;
        }
        return this.provinces.find((q) => q.id === hit.id) || null;
    }

    /**
     * 设置版图命中回调（由 GameController 注入，内部用 MapRenderer.territoryAt）
     *
     * ⚠ 回调收到的是**地图局部坐标**（已由 pickAt 做过 screenToMap），
     * 不是屏幕坐标；版图多边形也是这个坐标系。
     */
    public setTerritoryPicker(fn: ((mx: number, my: number) => ProvinceState | null) | null): void {
        this.territoryPicker = fn;
    }

    /** 把地图平移到以某城为中心 */
    public focusOn(p: ProvinceState, scale?: number): void {
        if (scale !== undefined) {
            this.camera.setZoom(scale);
        }
        this.camera.centerOn({ id: p.id, lat: p.lat, lon: p.lon, city: p.def.city });
        this.applyToNode();
    }
}
