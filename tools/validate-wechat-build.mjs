/**
 * 微信小游戏构建配置校验
 *
 * 检查：构建配置结构、场景 uuid、设计分辨率、模块列表、包体预估，
 * 以及工程里是否存在小游戏不兼容的用法。
 *
 * 运行：node tools/validate-wechat-build.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let fail = 0;
let warn = 0;

function check(cond, msg) {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) fail++;
}

function warnIf(cond, msg) {
    if (cond) {
        console.log(`  warn  ${msg}`);
        warn++;
    }
}

const ROOT = process.cwd();

console.log('== 构建配置 ==');
const builderPath = 'settings/v2/packages/builder.json';
check(existsSync(builderPath), '存在 builder.json');
const builder = JSON.parse(readFileSync(builderPath, 'utf8'));

const queue = builder.BuildTaskManager && builder.BuildTaskManager.queue;
check(Array.isArray(queue) && queue.length > 0, '构建任务队列非空');

const task = (queue || []).find((t) => t.options && t.options.platform === 'wechatgame');
check(!!task, '存在 wechatgame 构建任务');
if (task) {
    const o = task.options;

    // 场景配置
    const sceneUuid = JSON.parse(readFileSync('assets/scenes/Main.scene.meta', 'utf8')).uuid;
    check(o.startScene === sceneUuid, `startScene 与场景 uuid 一致（${o.startScene}）`);
    check(Array.isArray(o.scenes) && o.scenes.length === 1, 'scenes 配置含且仅含主场景');
    if (o.scenes && o.scenes[0]) {
        check(o.scenes[0].uuid === sceneUuid, 'scenes[0].uuid 正确');
        check(o.scenes[0].url === 'db://assets/scenes/Main.scene', 'scenes[0].url 正确');
    }

    // 方向与分辨率
    check(o.orientation === 'portrait', `竖屏方向（${o.orientation}）`);
    check(o.designResolution && o.designResolution.width === 720 && o.designResolution.height === 1280,
        `设计分辨率 720x1280（${o.designResolution && o.designResolution.width}x${o.designResolution && o.designResolution.height}）`);
    check(o.designResolution && o.designResolution.fitHeight === true && o.designResolution.fitWidth === false,
        '适配方式为 fitHeight（竖屏常用）');

    // 发布质量
    check(o.debug === false, '发布构建关闭 debug');
    check(o.sourceMaps === false, '发布构建关闭 sourceMaps（减小包体）');
    check(o.md5Cache === true, '开启 md5Cache（利于 CDN 缓存）');

    // appid
    check(typeof o.appid === 'string', '已配置 appid 字段');
    warnIf(o.appid === 'wx0000000000000000', 'appid 仍是占位值，上线前需替换为真实 AppID');

    // 模块
    const mods = o.includeModules || [];
    check(mods.length > 0, `includeModules 非空（${mods.length} 个）`);
    check(mods.includes('base'), '包含 base 模块');
    check(mods.includes('2d'), '包含 2d 模块');
    check(mods.includes('ui'), '包含 ui 模块');
    check(mods.includes('graphics'), '包含 graphics 模块（本游戏地图绘制依赖）');
    const heavy = ['spine-3.8', 'dragon-bones', 'physics-2d-box2d', 'video', 'webview', 'tiled-map', '3d', 'terrain'];
    for (const h of heavy) {
        check(!mods.includes(h), `未引入重型模块 ${h}`);
    }
}

console.log('\n== 项目设置 ==');
const proj = JSON.parse(readFileSync('settings/v2/packages/project.json', 'utf8'));
const sceneUuid2 = JSON.parse(readFileSync('assets/scenes/Main.scene.meta', 'utf8')).uuid;
check(proj.general && proj.general.startScene === sceneUuid2, 'project.json 启动场景正确');
check(proj.general.designResolution.width === 720 && proj.general.designResolution.height === 1280,
    'project.json 设计分辨率一致');

console.log('\n== 引擎模块裁剪 ==');
const engine = JSON.parse(readFileSync('settings/v2/packages/engine.json', 'utf8'));
const mods = engine.modules.configs[engine.modules.globalConfigKey].includeModules;
console.log(`  当前启用 ${mods.length} 个模块: ${mods.join(', ')}`);
check(mods.includes('graphics'), '启用 graphics');
check(!mods.includes('spine-3.8'), '未启用 spine');
check(!mods.includes('dragon-bones'), '未启用 dragon-bones');
check(!mods.includes('video'), '未启用 video');
check(!mods.includes('webview'), '未启用 webview');
check(!mods.includes('physics-2d-box2d'), '未启用 2D 物理');
check(!mods.includes('tiled-map'), '未启用 TiledMap');

// 裁剪前后对比
const original = 22;
check(mods.length < original, `模块数从 ${original} 减少到 ${mods.length}`);

console.log('\n== 小游戏兼容性扫描 ==');
const scripts = [];
function walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            walk(full);
        } else if (name.endsWith('.ts')) {
            scripts.push(full);
        }
    }
}
walk(join(ROOT, 'assets/scripts'));
console.log(`  扫描 ${scripts.length} 个脚本`);

let domUsage = 0;
let evalUsage = 0;
let wxDirect = 0;
for (const f of scripts) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    // 去掉注释再做检测，避免「文档里提到 wx.」被误判成真实调用
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // 小游戏没有 DOM，检查是否直接用了 document/window 操作
    if (/document\.(getElementById|createElement|body|querySelector)/.test(code)) {
        console.log(`  FAIL  ${rel} 直接操作 DOM`);
        domUsage++;
    }
    if (/\beval\s*\(/.test(code)) {
        console.log(`  warn  ${rel} 使用了 eval（小游戏不支持）`);
        evalUsage++;
    }
    // wx 只应出现在适配层
    if (/\bwx\./g.test(code) && !rel.includes('platform/WeChatAdapter')) {
        const hits = (code.match(/\bwx\./g) || []).length;
        console.log(`  warn  ${rel} 直接使用 wx（${hits} 处），应集中在 WeChatAdapter`);
        wxDirect++;
    }
}
check(domUsage === 0, '没有直接操作 DOM');
check(evalUsage === 0, '没有使用 eval');
check(wxDirect === 0, 'wx 调用集中在平台适配层');

console.log('\n== 包体预估 ==');
let codeBytes = 0;
for (const f of scripts) {
    codeBytes += statSync(f).size;
}
const assetDir = join(ROOT, 'assets');
let assetBytes = 0;
function walkAssets(dir) {
    for (const name of readdirSync(dir)) {
        if (name.endsWith('.meta')) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            walkAssets(full);
        } else {
            assetBytes += statSync(full).size;
        }
    }
}
walkAssets(assetDir);
console.log(`  源码 ${(codeBytes / 1024).toFixed(1)} KB，资源 ${(assetBytes / 1024).toFixed(1)} KB`);
// 微信小游戏主包上限 4MB，首包更严格；本项目几乎无美术资源，应远低于上限
check(codeBytes + assetBytes < 4 * 1024 * 1024, '源码+资源远小于 4MB 主包上限');

console.log(`\n结果：${fail === 0 ? '全部通过' : fail + ' 项失败'}${warn ? `，${warn} 项提醒` : ''}`);
process.exit(fail === 0 ? 0 : 1);
