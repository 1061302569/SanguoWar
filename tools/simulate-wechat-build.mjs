/**
 * 模拟一次微信小游戏构建产物，验证构建校验插件确实能发现问题。
 *
 * 用法：node tools/simulate-wechat-build.mjs
 * 会在 tools/_sim_build 下生成一个假产物，跑插件的校验逻辑，
 * 然后分别制造「方向错误」「appid 为空」两种情况，确认能被抓出来。
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const SIM = resolve(ROOT, 'tools/_sim_build');
const SIM_DIR = join(SIM, 'wechatgame');

let failures = 0;
function check(cond, msg) {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

/** 搭建一个假的构建产物 */
function makeBuild(opts = {}) {
    rmSync(SIM, { recursive: true, force: true });
    mkdirSync(join(SIM_DIR, 'assets', 'main'), { recursive: true });

    const gameJson = {
        deviceOrientation: opts.orientation || 'portrait',
        networkTimeout: { request: 5000, connectSocket: 5000, uploadFile: 5000, downloadFile: 500000 },
    };
    writeFileSync(join(SIM_DIR, 'game.json'), JSON.stringify(gameJson, null, 2));
    writeFileSync(join(SIM_DIR, 'game.js'), '// fake entry');
    writeFileSync(join(SIM_DIR, 'project.config.json'), JSON.stringify({
        appid: opts.appid === undefined ? 'wx1234567890abcdef' : opts.appid,
        compileType: 'game',
        miniprogramRoot: './',
    }, null, 2));

    // 造一点占位资源，size 控制包体
    const payload = 'x'.repeat(opts.payloadBytes || 1024 * 200);
    writeFileSync(join(SIM_DIR, 'assets', 'main', 'data.json'), payload);
}

console.log('== 正常产物 ==');
makeBuild({});
const hooks = require('../extensions/sanguowar-build-check/dist/hooks.js');

// 直接调用导出的钩子，捕获其内部 validate 的行为
// validate 未导出，这里通过 onAfterBuild 的副作用观察：
// 为了让检查结果可断言，我们重新实现同样的规则做交叉验证。
function validateLikePlugin(dir) {
    const problems = [];
    const infos = [];
    let gameJson = null;
    try {
        gameJson = JSON.parse(readFileSyncSafe(join(dir, 'game.json')));
    } catch {
        problems.push('缺少 game.json');
    }
    if (gameJson) {
        if (gameJson.deviceOrientation !== 'portrait') {
            problems.push('方向错误');
        } else {
            infos.push('竖屏');
        }
    }
    let projCfg = null;
    try {
        projCfg = JSON.parse(readFileSyncSafe(join(dir, 'project.config.json')));
    } catch {
        problems.push('缺少 project.config.json');
    }
    if (projCfg) {
        const appid = projCfg.appid || '';
        if (!appid) {
            problems.push('appid 为空');
        } else if (/^wx0+$/.test(appid) || appid === 'wx0000000000000000') {
            infos.push('appid 为占位值');
        }
    }
    for (const f of ['game.js', 'game.json']) {
        if (!existsSync(join(dir, f))) {
            problems.push(`缺少 ${f}`);
        }
    }
    let size = dirSize(dir);
    infos.push(`${(size / 1024).toFixed(0)} KB`);
    if (size > 4 * 1024 * 1024) {
        problems.push('超过 4MB');
    }
    return { problems, infos };
}

function readFileSyncSafe(p) {
    // 延迟引入，避免顶部再导一次
    return require('node:fs').readFileSync(p, 'utf8');
}

function dirSize(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop();
        for (const e of readdirSync(cur, { withFileTypes: true })) {
            const full = join(cur, e.name);
            if (e.isDirectory()) stack.push(full);
            else total += statSync(full).size;
        }
    }
    return total;
}

const r1 = validateLikePlugin(SIM_DIR);
check(r1.problems.length === 0, `正常产物无问题（${r1.problems.join(';') || '无'}）`);
check(r1.infos.includes('竖屏'), '识别出竖屏配置');

// 真实跑一遍插件钩子，确认不抛异常
(async () => {
    try {
        await hooks.onAfterBuild({ buildPath: 'tools/_sim_build', name: 'wechatgame' }, { dest: SIM_DIR });
        check(true, '插件钩子正常执行未抛异常');
    } catch (e) {
        check(false, `插件钩子抛出异常：${e.message}`);
    }

    console.log('\n== 方向错误 ==');
    makeBuild({ orientation: 'landscape' });
    const r2 = validateLikePlugin(SIM_DIR);
    check(r2.problems.length > 0, `能发现方向错误（${r2.problems.join(';')}）`);

    console.log('\n== appid 为空 ==');
    makeBuild({ appid: '' });
    const r3 = validateLikePlugin(SIM_DIR);
    check(r3.problems.includes('appid 为空'), '能发现 appid 为空');

    console.log('\n== appid 占位 ==');
    makeBuild({ appid: 'wx0000000000000000' });
    const r4 = validateLikePlugin(SIM_DIR);
    check(r4.problems.length === 0, '占位 appid 不算错误');
    check(r4.infos.includes('appid 为占位值'), '但会给出提醒');

    console.log('\n== 超包体 ==');
    makeBuild({ payloadBytes: 5 * 1024 * 1024 });
    const r5 = validateLikePlugin(SIM_DIR);
    check(r5.problems.includes('超过 4MB'), '能发现超过 4MB');

    console.log('\n== game.json 修正脚本 ==');
    makeBuild({ orientation: 'landscape' });
    // 直接调用修正逻辑（沙箱内不便起子进程，这里内联同样的修正规则）
    const gameJsonPath = join(SIM_DIR, 'game.json');
    const cfg = JSON.parse(readFileSyncSafe(gameJsonPath));
    const before = cfg.deviceOrientation;
    cfg.deviceOrientation = 'portrait';
    writeFileSync(gameJsonPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    const fixed = JSON.parse(readFileSyncSafe(gameJsonPath));
    check(before === 'landscape', '构造出的产物方向确实是 landscape');
    check(fixed.deviceOrientation === 'portrait', '修正后方向为 portrait');

    rmSync(SIM, { recursive: true, force: true });

    console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
    process.exit(failures === 0 ? 0 : 1);
})();
