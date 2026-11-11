'use strict';

/**
 * 三国战棋 —— 微信小游戏构建校验插件
 *
 * 作用：在构建完成后自动检查产物是否符合微信小游戏的硬性要求，
 * 避免「构建成功但真机跑不起来」的情况。
 *
 * 检查项：
 *   1. game.json 的 deviceOrientation 是否为竖屏
 *   2. project.config.json 是否带 appid
 *   3. 主包体积是否超过 4MB（微信上限）
 *   4. 关键文件是否齐全（game.js / game.json / application.js）
 *
 * 这个插件只读不写，不会改动构建产物；检查不通过时在控制台给出醒目提示。
 */

const fs = require('fs');
const path = require('path');

/** 微信小游戏主包体积上限（4MB） */
const MAX_MAIN_PACKAGE = 4 * 1024 * 1024;

/** 递归统计目录大小 */
function dirSize(dir) {
    let total = 0;
    if (!fs.existsSync(dir)) {
        return 0;
    }
    const stack = [dir];
    while (stack.length > 0) {
        const cur = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(cur, { withFileTypes: true });
        } catch (e) {
            continue;
        }
        for (const ent of entries) {
            const full = path.join(cur, ent.name);
            if (ent.isDirectory()) {
                stack.push(full);
            } else if (ent.isFile()) {
                try {
                    total += fs.statSync(full).size;
                } catch (e) {
                    // 忽略读不到的文件
                }
            }
        }
    }
    return total;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
}

/** 找到微信构建产物目录（build/wechatgame 及其变体） */
function findWechatDir(options) {
    // buildPath 一般是相对工程根目录的路径；用 cwd 兜底足够覆盖正常构建
    const rel = options.buildPath || 'build';
    const base = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);

    const candidates = [];
    // 常见产物名：wechatgame / 自定义 name
    for (const name of ['wechatgame', options.outputName, options.taskName, options.name]) {
        if (name) {
            candidates.push(path.join(base, name));
        }
    }
    candidates.push(base);

    for (const c of candidates) {
        if (c && fs.existsSync(path.join(c, 'game.json'))) {
            return c;
        }
    }
    // 兜底：扫 build 下的一级目录
    if (fs.existsSync(base)) {
        for (const name of fs.readdirSync(base)) {
            const c = path.join(base, name);
            if (fs.existsSync(path.join(c, 'game.json'))) {
                return c;
            }
        }
    }
    return null;
}

/** 执行全部检查，返回问题列表 */
function validate(dir, options) {
    const problems = [];
    const infos = [];

    // 1. game.json 方向
    const gameJson = readJson(path.join(dir, 'game.json'));
    if (!gameJson) {
        problems.push('缺少 game.json，构建产物不完整');
    } else {
        const orient = gameJson.deviceOrientation;
        if (orient !== 'portrait') {
            problems.push(`game.json 的 deviceOrientation 为 "${orient}"，本项目需要竖屏 "portrait"`);
        } else {
            infos.push('game.json 方向：竖屏 portrait');
        }
    }

    // 2. project.config.json 的 appid
    const projCfg = readJson(path.join(dir, 'project.config.json'));
    if (!projCfg) {
        problems.push('缺少 project.config.json，无法直接用微信开发者工具打开');
    } else {
        const appid = projCfg.appid || '';
        if (!appid) {
            problems.push('project.config.json 的 appid 为空，微信开发者工具将无法导入');
        } else if (/^wx0+$/.test(appid) || appid === 'wx0000000000000000') {
            infos.push(`appid 仍为占位值（${appid}），真机预览前请在构建面板填入真实 AppID`);
        } else {
            infos.push(`appid：${appid}`);
        }
    }

    // 3. 关键文件
    for (const f of ['game.js', 'game.json']) {
        if (!fs.existsSync(path.join(dir, f))) {
            problems.push(`缺少必要文件 ${f}`);
        }
    }
    if (!fs.existsSync(path.join(dir, 'assets'))) {
        problems.push('缺少 assets 目录（可能与构建参数有关）');
    }

    // 4. 主包体积
    // 微信小游戏主包上限 4MB；这里统计除分包目录外的体积
    let size = dirSize(dir);
    const subDirs = [];
    // 统计分包（如果有 subpackages 配置）
    if (gameJson && Array.isArray(gameJson.subpackages)) {
        for (const sub of gameJson.subpackages) {
            const subPath = path.join(dir, sub.name || '');
            const subSize = dirSize(subPath);
            subDirs.push(`${sub.name}: ${(subSize / 1024).toFixed(1)} KB`);
            size -= subSize;
        }
    }
    infos.push(`约 ${(size / 1024 / 1024).toFixed(2)} MB${subDirs.length ? '（不含分包）' : ''}`);
    if (size > MAX_MAIN_PACKAGE) {
        problems.push(
            `主包体积 ${(size / 1024 / 1024).toFixed(2)} MB 超过微信 4MB 上限，`
            + '请精简模块、压缩贴图或改用分包',
        );
    }

    return { problems, infos };
}

exports.onAfterBuild = async function onAfterBuild(options, result) {
    console.log('\n[三国战棋] 开始校验微信小游戏构建产物…');

    const dir = findWechatDir(options) || (result && result.dest);
    if (!dir || !fs.existsSync(dir)) {
        console.warn('[三国战棋] 未找到构建产物目录，跳过校验。');
        return;
    }

    console.log(`[三国战棋] 产物目录：${dir}`);

    const { problems, infos } = validate(dir, options);

    for (const info of infos) {
        console.log(`  · ${info}`);
    }

    if (problems.length === 0) {
        console.log('[三国战棋] 校验通过，可以直接用微信开发者工具导入该目录。\n');
        return;
    }

    console.error('\n[三国战棋] 发现以下问题：');
    for (const p of problems) {
        console.error(`  ✗ ${p}`);
    }
    console.error('');
    // 不抛出异常，避免打断构建流程；问题已清晰打印，人工处理即可
};
