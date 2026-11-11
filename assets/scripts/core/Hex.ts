/**
 * 【已废弃】六边形网格几何
 *
 * 本项目早期使用六边形棋盘，相邻关系由网格几何推导。
 * 现在地图已改为「真实经纬度 + 显式相邻关系」，本文件不再被任何代码引用。
 *
 * 保留原因：删除文件受当前环境权限限制。
 * 你可以直接在资源管理器里删除本文件（连同 Hex.ts.meta），
 * 删除后不会影响构建——Cocos 只打包被引用到的模块。
 *
 * 如果需要恢复六边形棋盘玩法，这份实现仍然可用。
 */

export interface Axial {
    q: number;
    r: number;
}

export interface PixelState {
    x: number;
    y: number;
}

export interface Offset {
    col: number;
    row: number;
}

const AXIAL_DIRS: Axial[] = [
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: -1, r: 1 },
];

export class Hex {
    public static size = 34;

    public static get stepX(): number {
        return Math.sqrt(3) * Hex.size;
    }

    public static get stepY(): number {
        return 1.5 * Hex.size;
    }

    public static toAxial(col: number, row: number): Axial {
        return { q: col - Math.floor(row / 2), r: row };
    }

    public static toOffset(q: number, r: number): Offset {
        return { col: q + Math.floor(r / 2), row: r };
    }

    public static toPixel(col: number, row: number): PixelState {
        const a = Hex.toAxial(col, row);
        return {
            x: (a.q + a.r / 2) * Hex.stepX,
            y: -a.r * Hex.stepY,
        };
    }

    public static neighbors(col: number, row: number): Offset[] {
        const a = Hex.toAxial(col, row);
        const out: Offset[] = [];
        for (const d of AXIAL_DIRS) {
            out.push(Hex.toOffset(a.q + d.q, a.r + d.r));
        }
        return out;
    }

    public static distance(c1: number, r1: number, c2: number, r2: number): number {
        const a = Hex.toAxial(c1, r1);
        const b = Hex.toAxial(c2, r2);
        const dq = a.q - b.q;
        const dr = a.r - b.r;
        return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    }

    public static isAdjacent(c1: number, r1: number, c2: number, r2: number): boolean {
        return Hex.distance(c1, r1, c2, r2) === 1;
    }

    public static polygonPoints(cx: number, cy: number, size?: number): PixelState[] {
        const s = size === undefined ? Hex.size : size;
        const pts: PixelState[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i - 30);
            pts.push({ x: cx + s * Math.cos(angle), y: cy + s * Math.sin(angle) });
        }
        return pts;
    }

    public static insetPoints(cx: number, cy: number, inset: number): PixelState[] {
        return Hex.polygonPoints(cx, cy, Hex.size - inset);
    }
}
