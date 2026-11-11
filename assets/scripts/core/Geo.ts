/**
 * 地理投影
 *
 * 把真实的经纬度投影到屏幕坐标（等距圆柱投影 + 纬度余弦修正）。
 *
 * 为什么不用六边形网格：
 *   六边形网格的「邻居」是几何推导出来的，只能是规整铺满的棋盘；
 *   而真实城池的经纬度是稀疏、不规则的，塞进网格必然导致位置失真。
 *   因此本项目改为「真实经纬度 + 显式相邻关系（borders）」。
 */

/** 地图覆盖的经度范围（东经） */
const LON_MIN = 99;
const LON_MAX = 125;
/** 地图覆盖的纬度范围（北纬） */
const LAT_MIN = 19;
const LAT_MAX = 43;
/** 纬度中值，用于经度方向收缩（高纬度处经线更密） */
const MID_LAT = (LAT_MIN + LAT_MAX) / 2;
const COS_MID = Math.cos((MID_LAT * Math.PI) / 180);

/** 缩放系数：1 纬度 ≈ SCALE 像素 */
const SCALE = 52;

/** 投影后的像素点（y 轴向上为正，北方在上） */
export interface GeoPoint {
    x: number;
    y: number;
}

export class Geo {
    /** 地图经纬度范围（供地形绘制等使用） */
    public static readonly latMin = LAT_MIN;
    public static readonly latMax = LAT_MAX;
    public static readonly lonMin = LON_MIN;
    public static readonly lonMax = LON_MAX;

    /** 地图投影后的宽高（像素） */
    public static get width(): number {
        return (LON_MAX - LON_MIN) * COS_MID * SCALE;
    }

    public static get height(): number {
        return (LAT_MAX - LAT_MIN) * SCALE;
    }

    /**
     * 经纬度 -> 像素坐标
     *
     * 坐标系约定（**全项目统一**，必须严格遵守）：
     *   - 原点在地图**中心**
     *   - x 向东为正（经度越大越靠右）
     *   - y 向**北**为正（纬度越大越靠上）—— Cocos 的 y 轴向上为正
     *   - 范围：x ∈ [-width/2, +width/2]，y ∈ [-height/2, +height/2]
     *
     * ⚠ 这里曾经写成 `(LAT_MAX - lat) * SCALE`，那是「屏幕坐标 y 向下」的写法，
     * 在 Cocos（y 向上为正）里会导致**整张地图南北颠倒**：
     * 北方被画到屏幕下方，海洋跑到南边。
     */
    public static project(lat: number, lon: number): GeoPoint {
        return {
            x: (lon - LON_MIN) * COS_MID * SCALE - Geo.width * 0.5,
            y: (lat - LAT_MIN) * SCALE - Geo.height * 0.5,
        };
    }

    /** 像素坐标 -> 经纬度（调试与拾取用） */
    public static unproject(x: number, y: number): { lat: number; lon: number } {
        return {
            lat: LAT_MIN + (y + Geo.height * 0.5) / SCALE,
            lon: LON_MIN + (x + Geo.width * 0.5) / (COS_MID * SCALE),
        };
    }

    /** 两点间的像素距离 */
    public static distance(ax: number, ay: number, bx: number, by: number): number {
        const dx = ax - bx;
        const dy = ay - by;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /** 地图包围盒（用于居中与边界限制） */
    public static bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        return { minX: 0, maxX: Geo.width, minY: 0, maxY: Geo.height };
    }
}
