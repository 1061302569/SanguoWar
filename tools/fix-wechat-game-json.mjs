/**
 * 微信小游戏构建产物：补齐 / 修正 game.json
 *
 * Cocos 构建模板里的 game.json 默认就是 portrait，但如果有人改过模板、
 * 或构建参数被改动，方向可能不一致。这个小脚本用于构建后手动兜底，
 * 也可以接入 CI。
 *
 * 用法：
 *   node tools/fix-wechat-game-json.mjs build/wechatgame
 *   node tools/fix-wechat-game-json.mjs            # 自动在 build/ 下查找
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 期望的 game.json 配置 */
const DESIRED = {
    deviceOrientation: 'portrait',
    networkTimeout: {
        request: 5000,
        connectSocket: 5000,
        uploadFile: 5000,
        downloadFile: 500000,
    },
};

/** 在 build 目录下寻找包含 game.json 的产物目录 */
function autoFind() {
    const base = resolve(process.cwd(), 'build');
    if (!existsSync(base)) {
        return null;
    }
    const stack = [base];
    while (stack.length) {
        const cur = stack.shift();
        let entries;
        try {
            entries = readdirSync(cur);
        } catch {
            continue;
        }
        if (entries.includes('game.json')) {
            return cur;
        }
        for (const e of entries) {
            const full = join(cur, e);
            try {
                if (statSync(full).isDirectory()) {
                    stack.push(full);
                }
            } catch {
                // 忽略
            }
        }
    }
    return null;
}

const argDir = process.argv[2];
const dir = argDir ? resolve(process.cwd(), argDir) : autoFind();

if (!dir) {
    console.error('未找到包含 game.json 的构建产物目录。请先构建，或传入目录路径。');
    process.exit(1);
}

const gameJsonPath = join(dir, 'game.json');
if (!existsSync(gameJsonPath)) {
    console.error(`目录中没有 game.json：${dir}`);
    process.exit(1);
}

let cfg;
try {
    cfg = JSON.parse(readFileSync(gameJsonPath, 'utf8'));
} catch (e) {
    console.error(`game.json 解析失败：${e.message}`);
    process.exit(1);
}

const before = JSON.stringify(cfg);
let changed = false;

if (cfg.deviceOrientation !== DESIRED.deviceOrientation) {
    console.log(`修正 deviceOrientation: ${cfg.deviceOrientation} -> ${DESIRED.deviceOrientation}`);
    cfg.deviceOrientation = DESIRED.deviceOrientation;
    changed = true;
}
if (!cfg.networkTimeout) {
    cfg.networkTimeout = DESIRED.networkTimeout;
    changed = true;
    console.log('补齐 networkTimeout');
}

if (!changed) {
    console.log(`无需修改：${gameJsonPath}`);
    process.exit(0);
}

writeFileSync(gameJsonPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
console.log(`已更新 ${gameJsonPath}`);
