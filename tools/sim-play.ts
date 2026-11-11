/**
 * 地图操作「模拟试玩」
 *
 * 用真实的屏幕坐标模拟玩家操作，检查：
 *   1. 初始视野里，所有城池是否都在屏幕内（不在的能否拖到）
 *   2. 每一座城，用手指点它正中心，能否命中自己
 *   3. 城池圆点在初始缩放下有多大（手指目标够不够大）
 *   4. 城池名标签是否会重叠（看不清）
 *   5. 拖动到边界时，是否会露太多空白
 *   5b. 缩放时视野是否合理
 *   6. 相邻城池之间，点中间会不会误判成别人
 *
 * 运行：node tools/bundle-test.mjs tools/sim-play.ts
 *       node --experimental-strip-types --no-warnings tools/.bundle.sim-play.ts
 */
import { Geo } from '../assets/scripts/core/Geo.ts';
import { MapCamera, CityPoint } from '../assets/scripts/core/MapCamera.ts';
import { GameState } from '../assets/scripts/core/GameState.ts';

let problems = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) problems++;
}
function info(msg: string): void {
    console.log(`        ${msg}`);
}

// ---- 模拟 iPhone 竖屏（设计分辨率 720x1280）----
const VIEW = { width: 720, height: 1280 };

const gs = new GameState();
const cities: CityPoint[] = [];
const provById = new Map<string, any>();
gs.provinces.forEach((p) => {
    cities.push({ id: p.id, lat: p.lat, lon: p.lon, city: p.def.city });
    provById.set(p.id, p);
});

console.log('=========================================');
console.log(' 模拟试玩：720x1280 竖屏');
console.log('=========================================');
console.log(`城池数：${cities.length}`);
console.log(`地图投影：${Geo.width.toFixed(0)} x ${Geo.height.toFixed(0)}\n`);

// ---- 按游戏里的方式初始化相机（共用同一个入口，避免两边不一致）----
const cam = new MapCamera(VIEW);
cam.resetToStartView(34.4, 113.0, 17 * 2);
const fitScale = cam.zoom;

// 初始视野对准中原（与 GameController 一致）
cam.resetToStartView(34.4, 113.0, 17 * 2);

console.log('== 1. 初始视野 ==');
info(`缩放 ${cam.zoom.toFixed(3)}，地图显示 ${cam.displayWidth.toFixed(0)}x${cam.displayHeight.toFixed(0)}`);
const onScreen0 = cities.filter((c) => cam.isOnScreen(c));
info(`屏幕内城池：${onScreen0.length}/${cities.length}`);
check(onScreen0.length >= 20, `开局能看到足够多城池（${onScreen0.length} 座）`);

// 玩家自己的城必须在视野内
const mine = gs.provincesOf(gs.playerFaction);
const mineVisible = mine.filter((p) => cam.isOnScreen({ id: p.id, lat: p.lat, lon: p.lon, city: p.def.city }));
check(mineVisible.length === mine.length,
    `玩家全部 ${mine.length} 座城都在初始视野内（实际 ${mineVisible.length}）`);
if (mineVisible.length < mine.length) {
    const missing = mine.filter((p) => !mineVisible.some((v) => v.id === p.id));
    info(`看不到：${missing.map((p) => p.name).join('、')}`);
}

console.log('\n== 2. 每个城池圆点在屏幕上多大（手指目标）==');
let tooSmall = 0;
let minSize = Infinity;
for (const c of cities) {
    const d = cam.cityScreenRadius(c) * 2;
    minSize = Math.min(minSize, d);
    // 可点击目标建议 >= 24px
    if (d < 24) tooSmall++;
}
info(`最小圆点直径 ${minSize.toFixed(1)}px`);
check(tooSmall === 0, `所有城池圆点 >= 24px（${tooSmall} 座过小）`);

console.log('\n== 3. 点击每座城的正中心能否命中它自己 ==');
let missSelf = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    const s = cam.cityScreen(c);
    const hit = cam.pick(s.x, s.y, cities);
    if (!hit || hit.id !== c.id) {
        missSelf++;
        if (missSelf <= 5) {
            info(`点不中：${provById.get(c.id).name} (期望 ${c.id}，实际 ${hit ? hit.id : 'null'})`);
        }
    }
}
check(missSelf === 0, `每座城点中心都能命中自己（${missSelf} 座失败）`);

console.log('\n== 4. 手指稍微偏移（模拟真实手指）还能点中吗 ==');
let missOffset = 0;
const OFFSET = 10;   // 10px 偏移，很常见的误差
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    const s = cam.cityScreen(c);
    // 四个方向的偏移
    for (const [dx, dy] of [[OFFSET, 0], [-OFFSET, 0], [0, OFFSET], [0, -OFFSET]]) {
        const hit = cam.pick(s.x + dx, s.y + dy, cities);
        if (!hit || hit.id !== c.id) {
            missOffset++;
            break;
        }
    }
}
check(missOffset === 0, `偏移 10px 仍能点中（${missOffset} 座失败）`);

console.log('\n== 5. 相邻城池中间位置会不会误点 ==');
let ambiguous = 0;
for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i];
        const b = cities[j];
        const sa = cam.cityScreen(a);
        const sb = cam.cityScreen(b);
        const dist = Math.hypot(sa.x - sb.x, sa.y - sb.y);
        // 屏幕上距离过近的两城，中间点会分不清
        if (dist < 28) {
            ambiguous++;
            if (ambiguous <= 5) {
                info(`${provById.get(a.id).name} - ${provById.get(b.id).name}：屏幕距离仅 ${dist.toFixed(0)}px`);
            }
        }
    }
}
check(ambiguous === 0, `没有屏幕上重叠的城池（${ambiguous} 对过近）`);

console.log('\n== 6. 拖动边界（不能露出空白）==');
cam.x = 0; cam.y = 0; cam.clamp();
cam.panBy(100000, 0);
let leftEdge = cam.mapToScreen(-Geo.width / 2, 0).x;
let rightEdge = leftEdge + cam.displayWidth;
info(`向右猛拖后：地图左边缘=${leftEdge.toFixed(0)}，右边缘=${rightEdge.toFixed(0)}`);
check(rightEdge >= VIEW.width - 1, '地图右边缘不会拖到屏幕内（右侧不露空白）');
check(leftEdge <= 1, '地图左边缘不会拖出屏幕左侧');

cam.x = 0; cam.y = 0; cam.clamp();
cam.panBy(-100000, 0);
leftEdge = cam.mapToScreen(-Geo.width / 2, 0).x;
rightEdge = leftEdge + cam.displayWidth;
info(`向左猛拖后：地图左边缘=${leftEdge.toFixed(0)}，右边缘=${rightEdge.toFixed(0)}`);
check(leftEdge <= 1, '地图左边缘不会拖到屏幕内（左侧不露空白）');

// 垂直方向：地图比屏幕高时应可上下拖动且不露空白；比屏幕矮时应居中
cam.x = 0; cam.y = 0; cam.clamp();
cam.panBy(0, 100000);
let bottom = cam.mapToScreen(0, -Geo.height / 2).y;
let top = bottom + cam.displayHeight;
info(`向上猛拖后：地图下沿=${bottom.toFixed(0)}，上沿=${top.toFixed(0)}（屏幕高 ${VIEW.height}）`);
if (cam.displayHeight > VIEW.height) {
    check(bottom <= 1, '地图下沿不会拖入屏幕（下方不露空白）');
} else {
    check(Math.abs(cam.y) < 1,
        `地图比屏幕矮时居中锁定（y=${cam.y.toFixed(0)}，期望 0）`);
}

cam.x = 0; cam.y = 0; cam.clamp();
cam.panBy(0, -100000);
bottom = cam.mapToScreen(0, -Geo.height / 2).y;
if (cam.displayHeight > VIEW.height) {
    check(bottom >= VIEW.height - 1, '地图上沿不会拖入屏幕（上方不露空白）');
} else {
    check(Math.abs(cam.y) < 1, '地图比屏幕矮时位置稳定');
}

// 地图比屏幕小时应当被夹在「顶边贴屏幕顶」的位置
cam.x = 0; cam.y = 0; cam.clamp();
cam.panBy(500, 300);
if (cam.displayHeight <= VIEW.height) {
    check(Math.abs(cam.y) < 1,
        `地图比屏幕矮时居中（y=${cam.y.toFixed(0)}，期望 0）`);
} else {
    // 地图比屏幕高：应当保持铺满，不出现空白
    const bottom = cam.mapToScreen(0, 0).y;
    check(bottom <= VIEW.height / 2 - VIEW.height / 2 + 1 || Math.abs(cam.y - (-VIEW.height / 2)) < 1,
        '地图比屏幕高时垂直方向铺满、无空白');
}

console.log('\n== 7. 缩放 ==');
cam.x = 0; cam.y = 0; cam.zoom = fitScale; cam.clamp();
cam.setZoom(MapCamera.ZOOM_MAX);
info(`放大到 ${cam.zoom}：显示 ${cam.displayWidth.toFixed(0)}x${cam.displayHeight.toFixed(0)}`);
// 放大后点城应当仍然命中
let zoomMiss = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    const s = cam.cityScreen(c);
    const hit = cam.pick(s.x, s.y, cities);
    if (!hit || hit.id !== c.id) zoomMiss++;
}
check(zoomMiss === 0, `放大后仍能点中（${zoomMiss} 座失败）`);

cam.setZoom(cam.minZoom);
info(`缩到最小 ${cam.zoom.toFixed(3)}（minZoom=${cam.minZoom.toFixed(3)}）：显示 ${cam.displayWidth.toFixed(0)}x${cam.displayHeight.toFixed(0)}`);
let zoomOutMiss = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    const s = cam.cityScreen(c);
    const hit = cam.pick(s.x, s.y, cities);
    if (!hit || hit.id !== c.id) zoomOutMiss++;
}
check(zoomOutMiss === 0, `缩小后仍能点中（${zoomOutMiss} 座失败）`);

console.log('\n== 8. 缩放到最小时，地图能否覆盖屏幕 ==');
info(`最小缩放显示尺寸 ${cam.displayWidth.toFixed(0)}x${cam.displayHeight.toFixed(0)}，屏幕 ${VIEW.width}x${VIEW.height}`);
// 竖屏下地图偏扁，无法同时填满宽高，但必须填满高度（上下不留空白）
check(cam.displayHeight >= VIEW.height - 1,
    `缩到最小时地图填满屏幕高度（实际 ${cam.displayHeight.toFixed(0)}px / 需要 ${VIEW.height}px）`);
check(cam.displayWidth >= VIEW.width - 1,
    `缩到最小时地图也不窄于屏幕（实际 ${cam.displayWidth.toFixed(0)}px / 需要 ${VIEW.width}px）`);

console.log('\n== 8b. 缩小后缩放点是否会把城池挤出屏幕 ==');
cam.setZoom(fitScale);
cam.x = 0; cam.y = 0; cam.clamp();
cam.setZoom(cam.minZoom, { x: 100, y: 100 });
const anyVisible = cities.some((c) => cam.isOnScreen(c));
check(anyVisible, '以角落为锚缩放后，画面上仍有城池可见');

console.log('\n== 9. 玩家视角下的战场可达性 ==');
// 重置到初始视野
cam.resetToStartView(34.4, 113.0, 17 * 2);
let unreachable = 0;
for (const c of cities) {
    // 试着把它居中，然后看能否点中
    const savedX = cam.x, savedY = cam.y;
    cam.centerOn(c);
    const s = cam.cityScreen(c);
    const hit = cam.pick(s.x, s.y, cities);
    if (!hit || hit.id !== c.id) {
        unreachable++;
        info(`居中后仍点不中：${provById.get(c.id).name}`);
    }
    cam.x = savedX; cam.y = savedY;
    cam.clamp();
}
check(unreachable === 0, `任何城池居中后都能点中（${unreachable} 座失败）`);

console.log('\n== 10. 玩家能否方便地在自己的城池间跳转 ==');
// 玩家有 3 座城，模拟：先看 A，能否拖到 B
cam.resetToStartView(34.4, 113.0, 17 * 2);

for (const p of mine) {
    const c = { id: p.id, lat: p.lat, lon: p.lon, city: p.def.city };
    const before = cam.isOnScreen(c);
    // 模拟玩家拖动，试图把这座城拖到视野里
    if (!before) {
        cam.centerOn(c);
        const after = cam.isOnScreen(c);
        check(after, `${p.name} 原本不可见，居中后可见`);
    } else {
        check(true, `${p.name} 初始就在视野内`);
    }
}

console.log('\n== 11. 拖动是否正常（双向）==');
cam.zoom = fitScale;
cam.x = 0; cam.y = 0; cam.clamp();
const canPanH = cam.displayWidth > VIEW.width + 1;
info(`地图宽 ${cam.displayWidth.toFixed(0)}px / 屏幕 ${VIEW.width}px，可水平拖动=${canPanH}`);
if (canPanH) {
    // 初始 x=0 已在右边界，向左拖应当能动
    const startX = cam.x;
    cam.panBy(-200, 0);
    info(`向左拖 200px 后 x: ${startX.toFixed(0)} -> ${cam.x.toFixed(0)}`);
    check(cam.x < startX, '向左拖动有效（地图能移动）');

    // 再向右拖回
    const midX = cam.x;
    cam.panBy(100, 0);
    check(cam.x > midX, '向右拖动有效');

    // 拖到左边界后不应继续（新规则：minX = halfW - mw）
    cam.panBy(-100000, 0);
    const leftLimit = cam.x;
    const expectLeft = -(cam.displayWidth / 2 - VIEW.width / 2);
    check(Math.abs(leftLimit - expectLeft) < 2,
        `能一直拖到左边界（x=${leftLimit.toFixed(0)}，期望 ${expectLeft.toFixed(0)}）`);
    cam.panBy(-200, 0);
    check(Math.abs(cam.x - leftLimit) < 1, '到达左边界后不再继续移动（不会露出空白）');
} else {
    check(true, '地图不比屏幕宽，水平方向锁定（正确）');
}

console.log('\n== 12. 点击空白处应当取消选中 ==');
cam.x = 0; cam.y = 0; cam.clamp();
// 找一个屏幕上没有城池的位置
let blankFound = false;
let blankHit: any = null;
for (let sx = 20; sx < VIEW.width && !blankFound; sx += 40) {
    for (let sy = 20; sy < VIEW.height && !blankFound; sy += 40) {
        const hit = cam.pick(sx, sy, cities);
        if (!hit) {
            blankFound = true;
            blankHit = { x: sx, y: sy };
        }
    }
}
check(blankFound, '屏幕上存在未命中城池的空白区域（用于取消选中）');
if (blankFound) {
    info(`空白点示例：(${blankHit.x}, ${blankHit.y})`);
}

console.log('\n== 13. 双击聚焦后的体验 ==');
cam.zoom = fitScale;
cam.x = 0; cam.y = 0; cam.clamp();
const someCity = cities.find((c) => c.city) || cities[0];
cam.setZoom(cam.zoom * 1.6, { x: 0, y: 0 });
cam.centerOn(someCity);
const focusedSize = cam.cityScreenRadius(someCity) * 2;
info(`聚焦 ${provById.get(someCity.id).name} 后，该城直径 ${focusedSize.toFixed(0)}px`);
check(focusedSize >= 44, `聚焦后城池达到舒适点击尺寸 44px（实际 ${focusedSize.toFixed(0)}px）`);
// 聚焦后周围城池应当仍可点
let neighborOk = 0;
let neighborTotal = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    neighborTotal++;
    const s = cam.cityScreen(c);
    const hit = cam.pick(s.x, s.y, cities);
    if (hit && hit.id === c.id) neighborOk++;
}
check(neighborOk === neighborTotal, `聚焦后视野内 ${neighborTotal} 座城仍可点中（${neighborOk} 成功）`);

console.log('\n== 14. 缩到最小时，命中圈是否仍然够大 ==');
cam.setZoom(cam.minZoom);
cam.x = 0; cam.y = 0; cam.clamp();
// 取一座可见城，测试偏离中心 20px 能否命中
let tinyHitOk = 0;
let tinyTotal = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    tinyTotal++;
    const s = cam.cityScreen(c);
    // 偏移 18px（真实手指误差）
    const hit = cam.pick(s.x + 18, s.y + 18, cities);
    if (hit && hit.id === c.id) tinyHitOk++;
}
if (tinyTotal > 0) {
    const ratio = tinyHitOk / tinyTotal;
    info(`最小缩放下，偏移 18px 仍命中率 ${(ratio * 100).toFixed(0)}%（${tinyHitOk}/${tinyTotal}）`);
    check(ratio >= 0.95, `最小缩放下点击容错足够（${(ratio * 100).toFixed(0)}%）`);
}

console.log(`\n结果：${problems === 0 ? '全部通过' : problems + ' 项问题'}`);
process.exit(problems === 0 ? 0 : 1);
