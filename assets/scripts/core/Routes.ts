import { Geo } from './Geo';
import { ProvinceState } from '../data/Types';

/**
 * 路网：把「哪些城池之间可以进攻 / 调兵」变成地图上看得见的线
 *
 * ⚠ 这是本文件存在的根本原因：
 *   地图上的**色块**是 Voronoi 版图（按城池坐标算出来的几何相邻），
 *   而游戏里的**通行关系**是 ProvinceDef.borders 显式声明的（按史实地理接壤）。
 *   两者并不一致 —— 玩家看着两块挨着的色块以为能打，点了却提示「不接壤」。
 *   所以必须把 borders 原样画成路网，且**只能用同一份数据**，
 *   不能从版图多边形去推导，否则又会画出「看得见却打不了」的路。
 *
 * 本文件只做纯几何/纯逻辑，不依赖 cc，方便 tools 里的 Node 回归测试直接跑。
 * 画线由 ui/MapRenderer.ts 负责。
 */

export interface RoutePoint {
    x: number;
    y: number;
}

/** 一条无向通路（已按 id 去重、端点按字典序固定） */
export interface Route {
    aId: string;
    bId: string;
    /** 地图局部坐标（Geo.project 的结果） */
    a: RoutePoint;
    b: RoutePoint;
    /** a 的 borders 里是否写了 b（数据对称性自检用） */
    aDeclaresB: boolean;
    /** b 的 borders 里是否写了 a */
    bDeclaresA: boolean;
}

/** 通路语义：玩家前线（可进攻）/ 己方补给线（可调兵）/ 与玩家无关 */
export type RouteKind = 'front' | 'supply' | 'other';

export interface RouteSegment {
    a: RoutePoint;
    b: RoutePoint;
}

/** 进攻方向（仅前线有意义） */
export interface AttackDirection {
    fromId: string;
    toId: string;
    from: RoutePoint;
    to: RoutePoint;
}

function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 从 borders 构建去重后的无向路网。
 *
 * - 脏数据（指向不存在的城、自环）直接跳过，不会画出鬼线。
 * - 同一对城只产出一条路；双向声明分别记在 aDeclaresB / bDeclaresA 上，
 *   便于测试验证数据对称性，也避免 A→B 与 B→A 画两遍导致线变粗。
 */
export function buildRoutes(provinces: ProvinceState[]): Route[] {
    const byId = new Map<string, ProvinceState>();
    for (const p of provinces) {
        byId.set(p.id, p);
    }

    const pairs = new Map<string, Route & { aDeclaresB: boolean; bDeclaresA: boolean }>();
    for (const p of provinces) {
        for (const bid of p.borders) {
            if (bid === p.id || !byId.has(bid)) {
                continue;
            }
            const aId = p.id < bid ? p.id : bid;
            const bId = p.id < bid ? bid : p.id;
            const key = pairKey(p.id, bid);
            let e = pairs.get(key);
            if (!e) {
                const pa = byId.get(aId)!;
                const pb = byId.get(bId)!;
                e = {
                    aId, bId,
                    a: Geo.project(pa.lat, pa.lon),
                    b: Geo.project(pb.lat, pb.lon),
                    aDeclaresB: false,
                    bDeclaresA: false,
                };
                pairs.set(key, e);
            }
            if (p.id === aId) {
                e.aDeclaresB = true;
            } else {
                e.bDeclaresA = true;
            }
        }
    }

    const out: Route[] = [];
    pairs.forEach((e) => out.push(e));
    // 固定顺序，保证多次刷新时绘制顺序稳定
    out.sort((x, y) => (x.aId + x.bId < y.aId + y.bId ? -1 : 1));
    return out;
}

/** 按两端归属给通路分类，决定它在地图上用什么颜色 */
export function routeKind(ownerA: string, ownerB: string, playerFaction: string): RouteKind {
    const mineA = ownerA === playerFaction;
    const mineB = ownerB === playerFaction;
    if (mineA !== mineB) {
        return 'front';
    }
    return mineA ? 'supply' : 'other';
}

/**
 * 前线通路的进攻方向：玩家一端 -> 非玩家一端。
 * 非前线返回 null（不画箭头，避免误导）。
 */
export function routeAttackDirection(
    route: Route,
    ownerA: string,
    ownerB: string,
    playerFaction: string,
): AttackDirection | null {
    if (routeKind(ownerA, ownerB, playerFaction) !== 'front') {
        return null;
    }
    if (ownerA === playerFaction) {
        return { fromId: route.aId, toId: route.bId, from: route.a, to: route.b };
    }
    return { fromId: route.bId, toId: route.aId, from: route.b, to: route.a };
}

/**
 * 把线段两端各裁掉一个城池半径，避免驿道压在城池圆点/标签上。
 * 城靠得极近时仍保留中间一小段（至少 20% 长度），保证这条路看得见。
 */
export function trimSegment(
    a: RoutePoint,
    b: RoutePoint,
    ra: number,
    rb: number,
): RouteSegment | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) {
        return null;
    }
    const t0 = Math.min(0.4, ra / len);
    const t1 = Math.max(0.6, 1 - rb / len);
    return {
        a: { x: a.x + dx * t0, y: a.y + dy * t0 },
        b: { x: a.x + dx * t1, y: a.y + dy * t1 },
    };
}

/**
 * 生成一个指向 to 的实心三角箭头（三个顶点，地图局部坐标）。
 * t 为箭头中心在线段上的比例位置，0.6 表示略偏向目标端。
 */
export function arrowTriangle(
    from: RoutePoint,
    to: RoutePoint,
    t: number,
    length: number,
    halfWidth: number,
): RoutePoint[] {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) {
        return [];
    }
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    const tipX = cx + ux * length * 0.5;
    const tipY = cy + uy * length * 0.5;
    const tailX = cx - ux * length * 0.5;
    const tailY = cy - uy * length * 0.5;
    return [
        { x: tipX, y: tipY },
        { x: tailX + nx * halfWidth, y: tailY + ny * halfWidth },
        { x: tailX - nx * halfWidth, y: tailY - ny * halfWidth },
    ];
}

/** 某条路是否与选中城相连，且另一端在给定目标集合里（选中/模式高亮用） */
export function routeIsActive(
    route: Route,
    selectedId: string | null,
    targetIds: string[],
): boolean {
    if (!selectedId || (route.aId !== selectedId && route.bId !== selectedId)) {
        return false;
    }
    const other = route.aId === selectedId ? route.bId : route.aId;
    return targetIds.indexOf(other) >= 0;
}
