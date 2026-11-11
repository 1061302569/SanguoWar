/**
 * 版图（Voronoi 领地）计算
 *
 * 历史/政治地图的形态是「每座城拥有一片色块版图」，而不是孤立的点。
 * 本项目用真实城池经纬度做 Voronoi 划分，再裁剪到陆地多边形内，
 * 得到互不重叠、完整覆盖陆地的版图——这正是史书地图上郡县割据的样子。
 *
 * 算法：对每座城 A，用「与所有其他城市的中垂线」逐条裁剪陆地多边形。
 *   中垂线条件（保留离 A 更近的半平面）：
 *     |p-A|² <= |p-B|²  =>  2p·(B-A) <= |B|²-|A|²
 *   即半平面法线 n = B-A，阈值 c = (|B|²-|A|²)/2，保留 n·p <= c。
 *
 * 复杂度 O(n²)，n=35 时约 1200 次裁剪，加载时计算一次即可，开销可忽略。
 */

export interface Pt {
    x: number;
    y: number;
}

export interface TerritoryInput {
    id: string;
    lat: number;
    lon: number;
}

/**
 * 用半平面裁剪多边形（Sutherland–Hodgman 单边版本）
 * 保留满足 nx*px + ny*py <= c 的部分
 */
export function clipHalfPlane(poly: Pt[], nx: number, ny: number, c: number): Pt[] {
    if (poly.length === 0) {
        return [];
    }
    const out: Pt[] = [];
    const inside = (p: Pt): boolean => nx * p.x + ny * p.y <= c;

    for (let i = 0; i < poly.length; i++) {
        const cur = poly[i];
        const prev = poly[(i + poly.length - 1) % poly.length];
        const curIn = inside(cur);
        const prevIn = inside(prev);
        if (curIn) {
            if (!prevIn) {
                out.push(intersect(prev, cur, nx, ny, c));
            }
            out.push(cur);
        } else if (prevIn) {
            out.push(intersect(prev, cur, nx, ny, c));
        }
    }
    return out;
}

/** 求线段与直线 nx*x + ny*y = c 的交点 */
function intersect(a: Pt, b: Pt, nx: number, ny: number, c: number): Pt {
    const da = nx * a.x + ny * a.y - c;
    const db = nx * b.x + ny * b.y - c;
    const t = da / (da - db || 1e-9);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 生成每座城的版图
 *
 * @param cities 城池（含投影后的坐标）
 * @param landPoly 陆地多边形（版图会被裁剪到这个范围内）
 * @returns 城 id -> 版图多边形
 */
export function buildTerritories(
    cities: Array<{ id: string; x: number; y: number }>,
    landPoly: Pt[],
): Map<string, Pt[]> {
    const result = new Map<string, Pt[]>();

    for (const a of cities) {
        let poly = landPoly.slice();

        for (const b of cities) {
            if (a.id === b.id) {
                continue;
            }
            // 方向向量 B-A
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < 1e-6) {
                continue;
            }
            // 保留离 A 更近的一侧：2p·(B-A) <= |B|²-|A|²
            const c = ((b.x * b.x + b.y * b.y) - (a.x * a.x + a.y * a.y)) / 2;
            poly = clipHalfPlane(poly, dx, dy, c);
            if (poly.length === 0) {
                break;
            }
        }

        if (poly.length >= 3) {
            result.set(a.id, poly);
        }
    }

    return result;
}

/** 点在多边形内（射线法） */
export function pointInPolygon(poly: Pt[], x: number, y: number): boolean {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;
        const intersectY = (yi > y) !== (yj > y);
        if (intersectY && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/** 多边形面积（用于判断版图是否退化） */
export function polygonArea(poly: Pt[]): number {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
}
