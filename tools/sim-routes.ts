/**
 * 回归：地图上画出来的「路」必须和游戏真正认的相邻关系完全一致
 *
 * 背景：版图色块是 Voronoi 几何相邻，而进攻关系来自 ProvinceDef.borders
 * 显式声明。两者不一样，玩家看着挨着的色块以为能打，点了却提示「不接壤」。
 * 现在路网改成「只按 borders 画」的常驻图层，本测试守住三件事：
 *   1) 每条路都对应真实的 isAdjacent / attackTargets / moveTargets，反之亦然；
 *   2) 语义分类（前线/补给/其他）与进攻方向跟着 owner 变化；
 *   3) UI 接线没有漏掉「归属变化后重画路网」与「选中态聚焦」。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-routes.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-routes.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { Geo } from '../assets/scripts/core/Geo.ts';
import { NEUTRAL } from '../assets/scripts/data/Factions.ts';
import {
    Route, buildRoutes, routeKind, routeAttackDirection,
    routeIsActive, trimSegment, arrowTriangle,
} from '../assets/scripts/core/Routes.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

function keyOf(x: string, y: string): string {
    return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/** 点到线段的距离（用于统计「路穿过第三座城」的误读风险） */
function distToSegment(
    c: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.sqrt((c.x - a.x) ** 2 + (c.y - a.y) ** 2);
    let t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((c.x - (a.x + dx * t)) ** 2 + (c.y - (a.y + dy * t)) ** 2);
}

async function main(): Promise<void> {
    const { readFileSync } = await import('node:fs');

    const gs = new GameState();
    const list: any[] = [];
    gs.provinces.forEach((p) => list.push(p));
    const byId = new Map<string, any>();
    for (const p of list) byId.set(p.id, p);
    const player = gs.playerFaction;

    console.log('== 1. 路网构建：去重、无自环、端点坐标 ==');
    const routes = buildRoutes(list);
    check(routes.length > 0, `构建出路网（${routes.length} 条）`);

    const declared = new Set<string>();
    for (const p of list) {
        for (const bid of p.borders) {
            if (bid === p.id || !byId.has(bid)) continue;
            declared.add(keyOf(p.id, bid));
        }
    }
    check(routes.length === declared.size,
        `路数 == borders 去重后的无向边数（${routes.length} / ${declared.size}）`);

    const keys = new Set<string>();
    let dup = 0; let selfLoop = 0; let badCoord = 0; let oneWay = 0;
    for (const r of routes) {
        const k = keyOf(r.aId, r.bId);
        if (keys.has(k)) dup++;
        keys.add(k);
        if (r.aId === r.bId) selfLoop++;
        const pa = byId.get(r.aId);
        const pb = byId.get(r.bId);
        const ea = Geo.project(pa.lat, pa.lon);
        const eb = Geo.project(pb.lat, pb.lon);
        if (Math.abs(r.a.x - ea.x) > 1e-6 || Math.abs(r.a.y - ea.y) > 1e-6
            || Math.abs(r.b.x - eb.x) > 1e-6 || Math.abs(r.b.y - eb.y) > 1e-6) {
            badCoord++;
        }
        // 端点按字典序固定，便于按 aId/bId 取 owner
        if (r.aId >= r.bId) badCoord++;
        if (!r.aDeclaresB || !r.bDeclaresA) oneWay++;
    }
    check(dup === 0, '没有重复画两遍的路（否则线会莫名变粗）');
    check(selfLoop === 0, '没有自环');
    check(badCoord === 0, '端点坐标与 Geo.project 一致且按字典序固定');
    check(oneWay === 0, 'borders 双向声明对称（与 logic-test 的对称性守卫一致）');

    console.log('== 2. 核心守卫：画出来的边 == 真正能进攻的边 ==');
    let declaredNotDrawn = 0;
    for (const p of list) {
        for (const b of list) {
            if (p.id !== b.id && gs.isAdjacent(p, b) && !keys.has(keyOf(p.id, b.id))) {
                declaredNotDrawn++;
            }
        }
    }
    check(declaredNotDrawn === 0, '每条 isAdjacent 关系都画成了路');

    let drawnNotDeclared = 0;
    for (const r of routes) {
        const a = byId.get(r.aId);
        const b = byId.get(r.bId);
        if (!gs.isAdjacent(a, b) && !gs.isAdjacent(b, a)) drawnNotDeclared++;
    }
    check(drawnNotDeclared === 0, '没有画出「看得见却打不了」的假路');

    let atkMismatch = 0; let moveMismatch = 0;
    let atkTotal = 0; let moveTotal = 0;
    for (const p of list) {
        if (p.owner !== player) continue;
        for (const t of gs.attackTargets(p)) {
            atkTotal++;
            const r = routes.find((x) => keyOf(x.aId, x.bId) === keyOf(p.id, t.id));
            if (!r) { atkMismatch++; continue; }
            const ownerA = byId.get(r.aId).owner;
            const ownerB = byId.get(r.bId).owner;
            if (routeKind(ownerA, ownerB, player) !== 'front') atkMismatch++;
            const dir = routeAttackDirection(r, ownerA, ownerB, player);
            if (!dir || dir.fromId !== p.id || dir.toId !== t.id) atkMismatch++;
        }
        for (const t of gs.moveTargets(p)) {
            moveTotal++;
            const r = routes.find((x) => keyOf(x.aId, x.bId) === keyOf(p.id, t.id));
            if (!r) { moveMismatch++; continue; }
            const ownerA = byId.get(r.aId).owner;
            const ownerB = byId.get(r.bId).owner;
            if (routeKind(ownerA, ownerB, player) !== 'supply') moveMismatch++;
            if (routeAttackDirection(r, ownerA, ownerB, player) !== null) moveMismatch++;
        }
    }
    check(atkMismatch === 0, `所有 attackTargets 都是橙色前线且箭头朝向敌方（${atkTotal} 个方向）`);
    check(moveMismatch === 0, `所有 moveTargets 都是绿色补给线且不画箭头（${moveTotal} 个方向）`);

    let frontCount = 0; let supplyCount = 0; let otherCount = 0;
    for (const r of routes) {
        const kind = routeKind(byId.get(r.aId).owner, byId.get(r.bId).owner, player);
        if (kind === 'front') frontCount++;
        else if (kind === 'supply') supplyCount++;
        else otherCount++;
    }
    check(frontCount + supplyCount + otherCount === routes.length, '三条分类覆盖全部路');
    check(frontCount === atkTotal,
        `橙红箭头数 == 玩家实际可攻方向数（${frontCount} / ${atkTotal}）`);
    check(supplyCount * 2 === moveTotal,
        `绿色补给线数 == 可调兵方向数 / 2（${supplyCount} / ${moveTotal}）`);
    console.log(`       └ 路网概览：${list.length} 城 / ${routes.length} 路，`
        + `前线 ${frontCount} · 补给 ${supplyCount} · 其他 ${otherCount}`);

    console.log('== 3. 归属变化后分类与箭头方向要跟着变（呼应回合刷新 bug） ==');
    const supplyRoute = routes.find((r) =>
        routeKind(byId.get(r.aId).owner, byId.get(r.bId).owner, player) === 'supply');
    if (supplyRoute) {
        const b = byId.get(supplyRoute.bId);
        const old = b.owner;
        b.owner = NEUTRAL;
        const kind = routeKind(byId.get(supplyRoute.aId).owner, b.owner, player);
        const dir = routeAttackDirection(
            supplyRoute, byId.get(supplyRoute.aId).owner, b.owner, player);
        check(kind === 'front', '己方城失守后，原本的绿路变成橙红前线');
        check(!!dir && dir.fromId === supplyRoute.aId && dir.toId === supplyRoute.bId,
            '箭头翻转成「玩家城 -> 失守城」');
        b.owner = old;
        check(routeKind(byId.get(supplyRoute.aId).owner, b.owner, player) === 'supply',
            '恢复归属后分类回到补给线');
    } else {
        check(false, '找到一条己方补给线用于翻转测试');
    }

    console.log('== 4. 端点留白与箭头几何 ==');
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const seg = trimSegment(a, b, 21, 21);
    check(!!seg, '正常距离能裁出可见线段');
    if (seg) {
        check(seg.a.x > a.x && seg.b.x < b.x, '两端都让开了城池圆点半径');
        check(seg.a.x < seg.b.x, '裁完仍是正向线段');
        check(Math.abs(seg.a.x - 21) < 1e-6 && Math.abs(seg.b.x - 79) < 1e-6,
            '留白距离精确等于给定半径（21px）');
    }
    const near = trimSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 40, 40);
    check(!!near && near.b.x > near.a.x, '两城极近时仍保留中间可见的一小段');
    check(trimSegment(a, a, 20, 20) === null, '重合端点不画线');

    const tri = arrowTriangle(a, b, 0.62, 14, 5.5);
    check(tri.length === 3, '箭头是三角形');
    if (tri.length === 3) {
        check(tri[0].x > tri[1].x && tri[0].x > tri[2].x, '尖端朝向目标端');
        check(Math.abs(tri[1].y + tri[2].y) < 1e-6, '两翼关于线段对称');
        check(tri[1].y > 0 && tri[2].y < 0, '两翼分列法线两侧');
    }
    check(arrowTriangle(a, a, 0.62, 14, 5.5).length === 0, '零长线段不画箭头');
    const back = arrowTriangle(b, a, 0.62, 14, 5.5);
    check(back.length === 3 && back[0].x < back[1].x, '方向反转时箭头跟着反转');

    console.log('== 4b. 隔城打城诊断：通路不能从第三座城身上穿过去 ==');
    const crossList: string[] = [];
    for (const r of routes) {
        const ra = (byId.get(r.aId).def.city ? 21 : 17) + 4;
        const rb = (byId.get(r.bId).def.city ? 21 : 17) + 4;
        const seg = trimSegment(r.a, r.b, ra, rb);
        if (!seg) continue;
        for (const p of list) {
            if (p.id === r.aId || p.id === r.bId) continue;
            const c = Geo.project(p.lat, p.lon);
            // 圆点半径之外再留 20px：抓「城压在路上」的情况，
            // 又不误伤城池密集区里正常的三角邻接（旁城通常 50~70px 开外）。
            const rad = (p.def.city ? 21 : 17) + 20;
            const d = distToSegment(c, seg.a, seg.b);
            if (d < rad) {
                crossList.push(`${byId.get(r.aId).name}-${byId.get(r.bId).name}`
                    + ` 经过 ${p.name}（${d.toFixed(0)}px）`);
                break;
            }
        }
    }
    for (const s of crossList) console.log(`       ! ${s}`);
    console.log(`       └ ${crossList.length}/${routes.length} 条路穿过第三座城`);

    const lens = routes.map((r) => Geo.distance(r.a.x, r.a.y, r.b.x, r.b.y));
    const sorted = lens.slice().sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`       └ 路长中位数 ${median.toFixed(0)}px；超过 2 倍中位数的长边：`);
    routes.forEach((r, i) => {
        if (lens[i] > median * 2) {
            console.log(`         ${byId.get(r.aId).name}-${byId.get(r.bId).name}`
                + ` ${lens[i].toFixed(0)}px`);
        }
    });
    check(crossList.length === 0, '不存在「隔着一座城还能直达」的通路');

    // 用户实际反馈的两个案例，锁成具体断言，避免以后被当成「史实路线」补回去
    const xy = byId.get('xiangyang');
    const cs = byId.get('changsha');
    const jl = byId.get('jiangling');
    check(!!(xy && cs && jl), '襄阳 / 江陵 / 长沙 都在城池表里');
    if (xy && cs && jl) {
        check(!gs.isAdjacent(xy, cs) && !gs.isAdjacent(cs, xy),
            '襄阳不能越过江陵直接打长沙');
        check(gs.isAdjacent(xy, jl) && gs.isAdjacent(jl, cs),
            '改走 襄阳 → 江陵 → 长沙，两段都连通');
    }
    const gz = byId.get('guzang');
    const ts = byId.get('tianshui');
    const jc = byId.get('jincheng');
    check(!!(gz && ts && jc)
        && !gs.isAdjacent(gz, ts) && !gs.isAdjacent(ts, gz)
        && gs.isAdjacent(gz, jc) && gs.isAdjacent(jc, ts),
    '姑臧不能越过金城直达天水，改走 姑臧 → 金城 → 天水');

    console.log('== 5. 选中 / 模式聚焦 ==');
    const sample: Route = routes[0];
    check(routeIsActive(sample, sample.aId, [sample.bId]), '选中一端且另一端在目标集合 -> 点亮');
    check(routeIsActive(sample, sample.bId, [sample.aId]), '反过来选中另一端同样点亮');
    check(!routeIsActive(sample, sample.aId, []), '目标集合为空 -> 不点亮');
    check(!routeIsActive(sample, 'not_a_city', [sample.bId]), '选中别的城 -> 不点亮');
    check(!routeIsActive(sample, null, [sample.bId]), '未选中 -> 不做聚焦（全路正常显示）');

    console.log('== 6. UI 接线静态守卫 ==');
    const renderer = readFileSync('assets/scripts/ui/MapRenderer.ts', 'utf8');
    const controller = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const logic = readFileSync('assets/scripts/core/Routes.ts', 'utf8');

    const src = readFileSync('assets/scripts/GameController.ts', 'utf8');
    check(src.indexOf("makeNode('Routes', this.mapRoot)") >= 0, '控制器创建了独立 Routes 图层');
    check(src.indexOf('new MapRenderer(terrainG, routesG, glowG, hiG)') >= 0,
        'Routes Graphics 已接入 MapRenderer');
    check(src.indexOf('this.mapRenderer.draw(list, this.state.playerFaction)') >= 0,
        'draw 传入玩家势力（否则前线与补给线会分错色）');
    check(src.indexOf('this.mapRenderer.setRouteScale(scale)') >= 0, '缩放时补偿路网线宽');
    check(src.indexOf('this.mapRenderer.setRoutesVisible(this.routesVisible)') >= 0,
        '顶栏开关接到了渲染器');
    check((src.match(/this\.syncRouteFocus\(\)/g) || []).length >= 6,
        '选中 / 取消 / 进攻 / 调兵 / 刷新等入口都同步了路网聚焦');
    check(src.indexOf('RouteLegend') >= 0, '地图上有三色图例');
    check(src.indexOf('橙红路可进攻') >= 0, '默认提示条解释了路色含义');

    check(logic.indexOf('p.borders') >= 0, '路网数据源是 borders（不是 Voronoi 几何）');
    check(renderer.indexOf('buildRoutes(this.lastProvinces)') >= 0, '渲染器按 borders 构建路网');
    check(renderer.indexOf('this.renderRoutes();') >= 0, 'draw() 与开关都会重画路网');
    check(renderer.indexOf('setRouteFocus(') >= 0 && renderer.indexOf('setRoutesVisible(') >= 0,
        '渲染器暴露聚焦与显隐接口');
    check(renderer.indexOf('routeAttackDirection(') >= 0, '前线绘制了方向箭头');
    check(renderer.indexOf('dashedLine') < 0,
        '已移除与新路网重叠的旧虚线（避免两层线叠在一起）');
    check(controller.indexOf('MapRenderer(terrainG, glowG, hiG)') < 0,
        '不存在漏传 routes 图层的旧构造调用');

    console.log('== 6b. 常驻可见性守卫：别把「点击才看到路」改回来 ==');
    // 用户负反馈：初版把非前线压成淡底纹、选中又淡化其余路，
    // 视觉上等于「点了城池才画路」。这里锁死「所有路常驻完整显示」。
    check(!/\bdim\b/i.test(renderer), 'MapRenderer 里不再有 dim 淡化参数');
    check(renderer.indexOf('hasFocus') < 0, 'renderRoutes 不再按 hasFocus 淡化其余路');
    check(renderer.indexOf('private drawAttackMarks(') >= 0
        && renderer.indexOf('this.drawAttackMarks(g, routes, owners, radii, inv);') >= 0,
    'renderRoutes 末尾常驻画「可攻目标靶环 / 可出兵城」标记（不点城池也能看）');
    check(/if \(dir\) \{/.test(renderer), '前线箭头无条件常驻绘制');
    check(renderer.indexOf('所有路') >= 0 && renderer.indexOf('别再改回去') >= 0,
        '渲染器保留「所有路常驻、别再淡化」的设计注释');
    check(controller.indexOf('▲ 能进攻') >= 0
        && controller.indexOf('现在打不了') >= 0,
    '图例直接回答「能进攻 / 现在打不了」');
    check(controller.indexOf('不能打') >= 0, '提示文案直说哪些路不能进攻');

    console.log('== 6c. 底图只有路网一层线：别把地形装饰线加回来 ==');
    // 用户反馈：山脉 / 河流 / 州界 / 版图边界与路网叠在一起，地图显得很乱。
    // 数据常量保留（地形参考图脚本还要解析），但绘制流程里不能再出现这些线。
    const drawStart = renderer.indexOf('public draw(');
    const drawEnd = renderer.indexOf('this.renderRoutes();', drawStart);
    const drawBody = renderer.slice(drawStart, drawEnd);
    check(drawStart >= 0 && drawEnd > drawStart, '能定位到 draw() 主体');
    check(drawBody.indexOf('drawRivers') < 0
        && drawBody.indexOf('drawMountains') < 0
        && drawBody.indexOf('drawRegionBorders') < 0,
    'draw() 不再绘制河流 / 山脉 / 州界装饰线');
    check(drawBody.indexOf('strokePolygon') < 0, 'draw() 不再描版图边界细线');
    check(drawBody.indexOf('drawLakes') >= 0, '湖泊色块保留（不是线，不干扰路网）');
    check(renderer.indexOf('private drawRivers(') < 0
        && renderer.indexOf('private drawMountains(') < 0
        && renderer.indexOf('private drawRegionBorders(') < 0,
    '装饰线绘制方法已删除，不留死代码');
    check(renderer.indexOf('strokePolyline') < 0, '折线描边工具随装饰线一起移除');
    check(renderer.indexOf('const MOUNTAINS') >= 0
        && renderer.indexOf('const RIVERS') >= 0,
    '山河数据常量保留（供地形参考图与以后可开关地形层使用）');

    console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
    if (failures > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
