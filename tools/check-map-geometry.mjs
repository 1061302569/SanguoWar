/**
 * 地图几何自检
 *
 * 检查项：
 *   1. 陆地多边形是否自相交（自交会导致填充出错）
 *   2. 各纬度处陆地形态是否正常（有无异常碎段）
 *   3. 所有城池是否落在陆地范围内
 *   4. 海面点是否判为海、陆地关键点是否判为陆
 *   5. 陆地是否覆盖画布边界（顶部/底部不能露海）
 *
 * 运行：node tools/check-map-geometry.mjs
 */
import { readFileSync } from 'node:fs';

const COS = Math.cos((31 * Math.PI) / 180);
const SCALE = 78;
const LON_MIN = 99, LON_MAX = 125, LAT_MIN = 19, LAT_MAX = 43;

function project(lat, lon) {
    return { x: (lon - LON_MIN) * COS * SCALE, y: (LAT_MAX - lat) * SCALE };
}

let failures = 0;
function check(cond, msg) {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

// ---------- 读数据 ----------
const src = readFileSync('assets/scripts/data/Geography.ts', 'utf8');
const COAST = [...src.split('COASTLINE')[1].split('];')[0]
    .matchAll(/\[([\d.]+),\s*([\d.]+)\]/g)]
    .map((m) => [parseFloat(m[1]), parseFloat(m[2])]);

console.log(`海岸线：${COAST.length} 点\n`);

// 陆地多边形：海岸线 + 左下角 + 左上角 + 北部边界回到海岸线首点
// 最后这段北部边界必须存在，否则地图顶部（42.5~43N）会露海
const landLL = [
    ...COAST,
    [LON_MIN, LAT_MIN],
    [LON_MIN, LAT_MAX],
    [COAST[0][0], LAT_MAX],
];
const poly = landLL.map(([lon, lat]) => project(lat, lon));

/** 求多边形在给定 y 处的所有水平区间 */
function spans(p, y) {
    const xs = [];
    for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            const t = (y - a.y) / (b.y - a.y);
            xs.push(a.x + t * (b.x - a.x));
        }
    }
    xs.sort((m, n) => m - n);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
}

function insideLand(lat, lon) {
    const y = project(lat, LON_MIN).y;
    const x = project(lat, lon).x;
    return spans(poly, y).some(([a, b]) => x >= a && x <= b);
}

function segIntersect(p1, p2, p3, p4) {
    const d = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    const d1 = d(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
    const d2 = d(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
    const d3 = d(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    const d4 = d(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
        && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ---------- 1. 自相交 ----------
console.log('== 多边形自相交 ==');
let crosses = 0;
const n = poly.length;
for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) {
            crosses++;
            if (crosses <= 5) console.log(`    自交：边 ${i} 与边 ${j}`);
        }
    }
}
check(crosses === 0, `陆地多边形无自交（${crosses} 处）`);

// ---------- 2. 各纬度形态 ----------
console.log('\n== 各纬度陆地形态 ==');
let fragmented = 0;
for (let lat = LAT_MIN + 1; lat < LAT_MAX; lat += 0.5) {
    const y = project(lat, LON_MIN).y;
    const s = spans(poly, y).filter(([a, b]) => b - a > 1);
    if (s.length === 0) {
        console.log(`    lat=${lat.toFixed(1)}: 该纬度完全没有陆地（异常）`);
        fragmented++;
        continue;
    }
    for (const [a, b] of s) {
        if (b - a < 3) {
            console.log(`    lat=${lat.toFixed(1)}: 存在过窄碎段`);
            fragmented++;
        }
    }
}
check(fragmented === 0, `各纬度陆地形态正常（${fragmented} 处异常）`);

// ---------- 3. 城池 ----------
console.log('\n== 城池位置 ==');
const provSrc = readFileSync('assets/scripts/data/Provinces.ts', 'utf8');
const provs = [];
for (const ch of provSrc.split("id: '").slice(1)) {
    const id = ch.split("'")[0];
    const latM = /lat:\s*([\d.]+)/.exec(ch);
    const lonM = /lon:\s*([\d.]+)/.exec(ch);
    if (latM && lonM) provs.push({ id, lat: +latM[1], lon: +lonM[1] });
}
const outside = provs.filter((p) => !insideLand(p.lat, p.lon)).map((p) => p.id);
check(outside.length === 0,
    `全部 ${provs.length} 座城在陆地内${outside.length ? '，越界：' + outside.join(', ') : ''}`);

// ---------- 4. 海陆抽查 ----------
console.log('\n== 海面点应为海 ==');
const SEA_POINTS = [
    ['渤海', 38.8, 119.5], ['黄海', 35.0, 123.0], ['东海', 28.0, 123.0],
    ['南海', 20.0, 114.0], ['长江口外', 31.0, 122.5], ['胶东外海', 36.5, 122.0],
];
let seaWrong = 0;
for (const [name, lat, lon] of SEA_POINTS) {
    if (insideLand(lat, lon)) {
        console.log(`    ✗ ${name} 被判为陆地`);
        seaWrong++;
    }
}
check(seaWrong === 0, `海面点都判为海（${seaWrong} 处错误）`);

console.log('\n== 陆地关键点应为陆 ==');
const LAND_POINTS = [
    ['长安', 34.27, 108.94], ['洛阳', 34.62, 112.45], ['成都', 30.57, 104.07],
    ['建业', 32.06, 118.80], ['襄平', 41.27, 123.17], ['北平', 39.90, 119.30],
    ['蓟', 39.90, 116.40], ['交趾', 21.03, 105.85],
];
let landWrong = 0;
for (const [name, lat, lon] of LAND_POINTS) {
    if (!insideLand(lat, lon)) {
        console.log(`    ✗ ${name} 被判为海`);
        landWrong++;
    }
}
check(landWrong === 0, `陆地关键点都判为陆（${landWrong} 处错误）`);

// ---------- 5. 画布边界覆盖 ----------
console.log('\n== 陆地必须覆盖画布边界（不能露海）==');
const EDGE_SAMPLES = [
    ['上边界', LAT_MAX - 0.01, (LON_MIN + COAST[0][0]) / 2],
    ['左边界', (LAT_MIN + LAT_MAX) / 2, LON_MIN + 0.01],
    ['下边界', LAT_MIN + 0.01, (LON_MIN + COAST[COAST.length - 1][0]) / 2],
];
let edgeSea = 0;
for (const [name, lat, lon] of EDGE_SAMPLES) {
    if (!insideLand(lat, lon)) {
        console.log(`    ✗ ${name} (${lat.toFixed(2)}, ${lon.toFixed(2)}) 落在海里`);
        edgeSea++;
    } else {
        console.log(`    ok ${name}`);
    }
}
check(edgeSea === 0, `陆地覆盖画布边界（${edgeSea} 处露海）`);

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
