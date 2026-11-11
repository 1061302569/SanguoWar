/**
 * 验证版图划分算法
 *
 * 检查：
 *   1. 每个版图非空、面积合理
 *   2. 版图互不重叠（这是 Voronoi 的基本性质）
 *   3. 版图覆盖整块陆地（无缝隙）
 *   4. 每座城是否落在自己的版图内
 *
 * 运行：node tools/bundle-test.mjs tools/verify-territory.ts
 *       node --experimental-strip-types --no-warnings tools/.bundle.verify-territory.ts
 */
import { Geo } from '../assets/scripts/core/Geo.ts';
import { GameState } from '../assets/scripts/core/GameState.ts';
import { buildTerritories, polygonArea, pointInPolygon, Pt } from '../assets/scripts/core/Territory.ts';
import { buildLandPolygon } from '../assets/scripts/data/Geography.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

const gs = new GameState();

// 陆地多边形
const landLL = buildLandPolygon(Geo.lonMin, Geo.latMin, Geo.latMax);
const landPoly: Pt[] = landLL.map(([lon, lat]) => {
    const p = Geo.project(lat, lon);
    return { x: p.x, y: p.y };
});
const landArea = polygonArea(landPoly);
console.log(`陆地多边形：${landPoly.length} 顶点，面积 ${(landArea / 1000).toFixed(1)} 千像素²\n`);

// 城池
const cities: Array<{ id: string; x: number; y: number }> = [];
gs.provinces.forEach((p) => {
    const pt = Geo.project(p.lat, p.lon);
    cities.push({ id: p.id, x: pt.x, y: pt.y });
});

const t0 = Date.now();
const territories = buildTerritories(cities, landPoly);
const elapsed = Date.now() - t0;

console.log('=== 1. 版图基本完整性 ===');
check(territories.size === cities.length,
    `每座城都有版图（${territories.size}/${cities.length}）`);
console.log(`        计算耗时 ${elapsed}ms`);

let empty = 0;
let tiny = 0;
let totalArea = 0;
for (const [id, poly] of territories) {
    const a = polygonArea(poly);
    totalArea += a;
    if (poly.length < 3) empty++;
    if (a < 100) tiny++;
}
check(empty === 0, `没有空版图（${empty}）`);
check(tiny === 0, `没有过小的版图（${tiny} 个面积<100px²）`);

console.log('\n=== 2. 版图总面积应约等于陆地面积 ===');
const ratio = totalArea / landArea;
console.log(`        版图合计 ${(totalArea / 1000).toFixed(1)}，陆地 ${(landArea / 1000).toFixed(1)}，比值 ${ratio.toFixed(3)}`);
check(ratio > 0.99 && ratio < 1.01, `版图完整覆盖陆地（比值 ${ratio.toFixed(3)}）`);

console.log('\n=== 3. 每座城都在自己的版图内 ===');
// 采样检查：城中心必须落在自己的多边形内
let outside = 0;
for (const c of cities) {
    const poly = territories.get(c.id);
    if (!poly) continue;
    // 城中心点可能正好在边界上，稍微偏移测试四周
    const near = pointInPolygon(poly, c.x, c.y);
    const nearX = pointInPolygon(poly, c.x + 0.5, c.y);
    if (!near && !nearX) {
        outside++;
        if (outside <= 3) console.log(`        ${c.id} 不在自己的版图内`);
    }
}
check(outside === 0, `所有城池落在自己的版图内（${outside} 个例外）`);

console.log('\n=== 4. 版图互不重叠（抽样验证）===');
// 对每个版图的质心，检查只属于一个版图
let overlaps = 0;
for (const [id, poly] of territories) {
    // 质心
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p.x; cy += p.y; }
    cx /= poly.length;
    cy /= poly.length;

    let owners = 0;
    for (const [, other] of territories) {
        if (pointInPolygon(other, cx, cy)) owners++;
    }
    if (owners > 1) {
        overlaps++;
        if (overlaps <= 3) console.log(`        ${id} 的质心被 ${owners} 个版图包含`);
    }
}
check(overlaps === 0, `版图互不重叠（${overlaps} 个重叠）`);

console.log('\n=== 5. 版图面积分布（合理性）===');
const areas = [...territories.entries()].map(([id, poly]) => ({
    id, area: polygonArea(poly),
})).sort((a, b) => b.area - a.area);
const big = areas[0];
const small = areas[areas.length - 1];
console.log(`        最大：${big.id} ${(big.area / 1000).toFixed(1)} 千px²`);
console.log(`        最小：${small.id} ${(small.area / 1000).toFixed(1)} 千px²`);
console.log(`        中位：${(areas[Math.floor(areas.length / 2)].area / 1000).toFixed(1)} 千px²`);
check(small.area > 200, `最小版图不至于小到点不中（${(small.area / 1000).toFixed(2)} 千px²）`);

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
