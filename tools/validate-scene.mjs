/**
 * 场景完整性静态校验（不依赖引擎运行时）
 *
 * 检查项：
 * 1. 场景 JSON 的所有 __id__ 引用都指向存在的元素
 * 2. 组件与节点的双向引用一致（node / _components）
 * 3. Canvas 的 _cameraComponent 指向真实存在的 cc.Camera
 * 4. 首次启动场景配置指向 Main.scene
 * 5. 脚本的 @ccclass 名称唯一，且与场景里可能出现的 __type__ 不冲突
 */

import { readFileSync, existsSync } from 'node:fs';

let fail = 0;
function check(cond, msg) {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) fail++;
}

const scene = JSON.parse(readFileSync('assets/scenes/Main.scene', 'utf8'));
console.log('== 场景结构 ==');
check(Array.isArray(scene), '场景是数组');
check(scene.length > 0, `元素数量 ${scene.length}`);

// 1. __id__ 引用完整性
let badRefs = 0;
function walk(node, path) {
    if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
        if ('__id__' in node) {
            const id = node.__id__;
            if (typeof id !== 'number' || id < 0 || id >= scene.length) {
                console.log(`  BAD REF at ${path}: __id__=${id}`);
                badRefs++;
            }
        }
        for (const [k, v] of Object.entries(node)) {
            walk(v, `${path}.${k}`);
        }
    }
}
walk(scene, '$');
check(badRefs === 0, '所有 __id__ 引用有效');

// 2. 组件 <-> 节点 双向一致
console.log('== 节点与组件引用 ==');
let mismatch = 0;
scene.forEach((el, i) => {
    if (!el || typeof el !== 'object') return;
    if (el.__type__ === 'cc.Node') {
        for (const c of el._components || []) {
            const comp = scene[c.__id__];
            if (!comp) {
                console.log(`  node ${el._name} 引用了不存在的组件 ${c.__id__}`);
                mismatch++;
            } else if (!comp.node || comp.node.__id__ !== i) {
                console.log(`  组件 ${comp.__type__} 的 node 未指回 ${el._name}`);
                mismatch++;
            }
        }
    }
});
check(mismatch === 0, '组件与节点双向引用一致');

// 3. Canvas 相机
console.log('== Canvas / Camera ==');
const canvasEl = scene.find((e) => e && e.__type__ === 'cc.Canvas');
check(!!canvasEl, '存在 cc.Canvas');
if (canvasEl) {
    const camId = canvasEl._cameraComponent && canvasEl._cameraComponent.__id__;
    const camEl = scene[camId];
    check(!!camEl && camEl.__type__ === 'cc.Camera', `Canvas 的相机有效（__id__=${camId}, type=${camEl && camEl.__type__}）`);
    if (camEl) {
        check(camEl._projection === 0, '相机为正交投影（_projection=0）');
        check(camEl._clearFlags === 7, '相机清屏标志为 SOLID_COLOR|DEPTH|STENCIL');
        const vis = camEl._visibility;
        check((vis & 33554432) !== 0 || (vis & 1108344832) !== 0, `相机可见层包含 UI_2D（_visibility=${vis}）`);
    }
}
// Scene 的 _globals 等关键字段
const sceneEl = scene.find((e) => e && e.__type__ === 'cc.Scene');
check(!!sceneEl, '存在 cc.Scene');
check(!!sceneEl._globals, 'Scene 有 _globals');
const globals = scene[sceneEl._globals.__id__];
check(globals && globals.__type__ === 'cc.SceneGlobals', '_globals 指向 cc.SceneGlobals');

// 4. 启动场景配置
console.log('== 启动场景 ==');
const projJson = JSON.parse(readFileSync('settings/v2/packages/project.json', 'utf8'));
const sceneUuid = JSON.parse(readFileSync('assets/scenes/Main.scene.meta', 'utf8')).uuid;
const startScene = projJson.general && projJson.general.startScene;
check(!!startScene, `project.json 已配置启动场景（${startScene}）`);
if (startScene) {
    check(startScene.includes(sceneUuid), '启动场景 uuid 与 Main.scene.meta 一致');
}

// 5. 脚本检查
console.log('== 脚本 ==');
const scriptFiles = [
    'assets/scripts/Boot.ts',
    'assets/scripts/GameController.ts',
    'assets/scripts/core/Hex.ts',
    'assets/scripts/core/Balance.ts',
    'assets/scripts/core/Combat.ts',
    'assets/scripts/core/GameState.ts',
    'assets/scripts/data/Types.ts',
    'assets/scripts/data/Factions.ts',
    'assets/scripts/data/Provinces.ts',
    'assets/scripts/data/Generals.ts',
    'assets/scripts/ui/UIKit.ts',
    'assets/scripts/ui/MapRenderer.ts',
    'assets/scripts/ui/MapInput.ts',
];
for (const f of scriptFiles) {
    check(existsSync(f), `存在 ${f}`);
}
const ccclasses = new Set();
for (const f of scriptFiles) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/@ccclass\('([^']+)'\)/g)) {
        if (ccclasses.has(m[1])) {
            console.log(`  DUPLICATE @ccclass: ${m[1]}`);
            fail++;
        }
        ccclasses.add(m[1]);
    }
}
console.log(`  @ccclass: ${[...ccclasses].join(', ') || '(无)'}`);

// 场景里不应有指向自定义脚本的 __type__（我们只保留 Canvas/Camera）
const customTypes = scene.filter((e) => e && typeof e.__type__ === 'string'
    && !e.__type__.startsWith('cc.'));
check(customTypes.length === 0,
    `场景中没有无法解析的自定义类型（${customTypes.map((e) => e.__type__).join(', ') || '无'}）`);

console.log(`\n结果：${fail === 0 ? '全部通过' : fail + ' 项失败'}`);
process.exit(fail === 0 ? 0 : 1);
