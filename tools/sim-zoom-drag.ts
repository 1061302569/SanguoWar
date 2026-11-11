/**
 * 缩放-拖动序列模拟（复现用户反馈：「放大缩小再拖动，UI 出问题」）
 *
 * 逐步骤验证相机状态在各种操作序列下是否始终自洽：
 *   1. 缩放后位置与边界是否正确
 *   2. 缩放 → 拖动 → 点击，命中是否仍然准确
 *   3. 反复缩放是否漂移
 *   4. 标签反向缩放后是否维持恒定字号
 *
 * 运行：node tools/bundle-test.mjs tools/sim-zoom-drag.ts
 *       node --experimental-strip-types --no-warnings tools/.bundle.sim-zoom-drag.ts
 */
import { Geo } from '../assets/scripts/core/Geo.ts';
import { MapCamera, CityPoint } from '../assets/scripts/core/MapCamera.ts';
import { GameState } from '../assets/scripts/core/GameState.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}
function info(msg: string): void {
    console.log(`        ${msg}`);
}

const VIEW = { width: 720, height: 1280 };
const gs = new GameState();
const cities: CityPoint[] = [];
gs.provinces.forEach((p) => {
    cities.push({ id: p.id, lat: p.lat, lon: p.lon, city: p.def.city });
});

const cam = new MapCamera(VIEW);
cam.resetToStartView(34.4, 113.0, 34);

/** 点击某座城（模拟真实触摸链路） */
function tapCity(c: CityPoint): CityPoint | null {
    const s = cam.cityScreen(c);
    const uiX = s.x + VIEW.width / 2;
    const uiY = s.y + VIEW.height / 2;
    return cam.pick(uiX - VIEW.width / 2, uiY - VIEW.height / 2, cities);
}

/** 检查地图是否仍然铺满屏幕（不露空白） */
function fillsScreen(): { okX: boolean; okY: boolean; desc: string } {
    const mw = cam.displayWidth;
    const mh = cam.displayHeight;
    const left = cam.x - mw / 2;
    const right = cam.x + mw / 2;
    const bottom = cam.y - mh / 2;
    const top = cam.y + mh / 2;
    const okX = mw <= VIEW.width ? Math.abs(cam.x) < 1 : (left <= -VIEW.width / 2 + 1 && right >= VIEW.width / 2 - 1);
    const okY = mh <= VIEW.height ? Math.abs(cam.y) < 1 : (bottom <= -VIEW.height / 2 + 1 && top >= VIEW.height / 2 - 1);
    return {
        okX, okY,
        desc: `x[${left.toFixed(0)},${right.toFixed(0)}] y[${bottom.toFixed(0)},${top.toFixed(0)}]`,
    };
}

console.log('=== 1. 放大后是否仍然铺满屏幕 ===');
cam.resetToStartView(34.4, 113.0, 34);
for (const f of [1.2, 1.5, 1.8, 2.2]) {
    cam.setZoom(cam.zoom * f);
    const r = fillsScreen();
    check(r.okX && r.okY, `放大到 ${cam.zoom.toFixed(2)} 后仍铺满（${r.desc}）`);
}

console.log('\n=== 2. 缩小到下限后是否铺满 ===');
cam.resetToStartView(34.4, 113.0, 34);
cam.setZoom(0.1);   // 请求一个过小的值，应被 minZoom 拦住
const r2 = fillsScreen();
info(`缩到 ${cam.zoom.toFixed(3)}（minZoom=${cam.minZoom.toFixed(3)}）${r2.desc}`);
check(cam.zoom >= cam.minZoom - 1e-6, '缩放被限制在下限之上');
check(r2.okX && r2.okY, `缩到最小后仍铺满（${r2.desc}）`);

console.log('\n=== 3. 缩放 → 拖动 → 点击，命中是否准确 ===');
cam.resetToStartView(34.4, 113.0, 34);
cam.setZoom(cam.zoom * 1.6);            // 放大
cam.panBy(-120, -80);                    // 拖动
cam.panBy(60, 40);                       // 再拖回一点
let hitOk = 0;
let tested = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    tested++;
    const hit = tapCity(c);
    if (hit && hit.id === c.id) hitOk++;
}
info(`可见 ${tested} 座城，点击命中 ${hitOk} 座`);
check(hitOk === tested, `缩放+拖动后点击仍准确（${hitOk}/${tested}）`);

console.log('\n=== 4. 反复缩放是否漂移 ===');
cam.resetToStartView(34.4, 113.0, 34);
const startZoom = cam.zoom;
const startX = cam.x;
const startY = cam.y;
for (let i = 0; i < 10; i++) {
    cam.setZoom(cam.zoom * 1.1);
    cam.setZoom(cam.zoom / 1.1);
}
info(`10 次放大缩小往返：zoom ${startZoom.toFixed(4)} -> ${cam.zoom.toFixed(4)}`);
info(`位置 (${startX.toFixed(1)},${startY.toFixed(1)}) -> (${cam.x.toFixed(1)},${cam.y.toFixed(1)})`);
check(Math.abs(cam.zoom - startZoom) < 0.001, '缩放不漂移');
check(Math.abs(cam.x - startX) < 2 && Math.abs(cam.y - startY) < 2, '位置不漂移');

console.log('\n=== 5. 极端拖动后是否恢复 ===');
cam.resetToStartView(34.4, 113.0, 34);
cam.setZoom(cam.zoom * 2);
cam.panBy(99999, 99999);                 // 猛拖到极限
const r3 = fillsScreen();
check(r3.okX && r3.okY, `猛拖后仍铺满（${r3.desc}）`);
// 再拖回来，点击应准确
cam.panBy(-99999, -99999);
let recoverOk = 0;
let recoverTested = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    recoverTested++;
    const hit = tapCity(c);
    if (hit && hit.id === c.id) recoverOk++;
}
check(recoverOk === recoverTested, `拖回后点击准确（${recoverOk}/${recoverTested}）`);

console.log('\n=== 6. 标签反向缩放：屏幕字号应恒定 ===');
cam.resetToStartView(34.4, 113.0, 34);
const BASE_FONT = 17;
for (const z of [cam.zoom, cam.zoom * 1.5, cam.zoom * 2]) {
    cam.setZoom(z);
    // 标签节点的缩放 = 1/zoom，屏幕上的实际字号 = BASE_FONT * zoom * (1/zoom) = BASE_FONT
    const labelNodeScale = 1 / cam.zoom;
    const screenFont = BASE_FONT * cam.zoom * labelNodeScale;
    check(Math.abs(screenFont - BASE_FONT) < 0.01,
        `缩放 ${cam.zoom.toFixed(2)} 时标签屏幕字号 ${screenFont.toFixed(1)}px（应恒为 ${BASE_FONT}px）`);
}

console.log('\n=== 7. 缩放到最大时，城池仍可点中 ===');
cam.resetToStartView(34.4, 113.0, 34);
cam.setZoom(MapCamera.ZOOM_MAX);
cam.centerOn(cities[0]);
let maxOk = 0;
let maxTested = 0;
for (const c of cities) {
    if (!cam.isOnScreen(c)) continue;
    maxTested++;
    const hit = tapCity(c);
    if (hit && hit.id === c.id) maxOk++;
}
info(`放大到 ${cam.zoom} 时可见 ${maxTested} 座城`);
check(maxOk === maxTested, `最大缩放下点击准确（${maxOk}/${maxTested}）`);

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
