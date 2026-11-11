/**
 * 为 assets 下的目录与脚本生成 .meta 文件（若不存在）。
 * uuid 用内容+路径的确定性哈希生成，保证重复运行结果一致。
 *
 * 运行：node tools/gen-meta.mjs
 */
import { readdirSync, statSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const ASSETS = join(ROOT, 'assets');

const DIR_META_VER = '1.2.0';
const TS_META_VER = '1.0.0';
const SCENE_META_VER = '1.1.50';

function uuidFor(relPath) {
    // 确定性哈希 -> 形如 xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const h = createHash('sha1').update('cocos-sanguowar:' + relPath).digest('hex');
    const a = h.slice(0, 8);
    const b = h.slice(8, 12);
    const c = '4' + h.slice(13, 16);
    const d = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20);
    const e = h.slice(20, 32);
    return `${a}-${b}-${c}-${d}-${e}`;
}

function metaFor(relPath, type) {
    let ver = DIR_META_VER;
    let importer = 'directory';
    let files = '[]';
    if (type === 'ts') {
        ver = TS_META_VER;
        importer = '*';
        files = '["", ".json"]';
    } else if (type === 'scene') {
        ver = SCENE_META_VER;
        importer = 'scene';
        files = '[".json"]';
    }
    const uuid = uuidFor(relPath);
    return {
        content: `{
  "ver": "${ver}",
  "importer": "${importer}",
  "imported": true,
  "uuid": "${uuid}",
  "files": ${files},
  "subMetas": {},
  "userData": {}
}
`,
        uuid,
    };
}

// 已存在 meta 的保留原 uuid（例如 Main.scene 手动指定过）
function existingUuid(metaPath) {
    if (!existsSync(metaPath)) return null;
    try {
        return JSON.parse(readFileSync(metaPath, 'utf8')).uuid || null;
    } catch {
        return null;
    }
}

let created = 0;
let kept = 0;

function walk(dir) {
    for (const name of readdirSync(dir)) {
        if (name.startsWith('.') || name.endsWith('.meta')) continue;
        const full = join(dir, name);
        const st = statSync(full);
        const rel = relative(ROOT, full).replace(/\\/g, '/');

        if (st.isDirectory()) {
            const metaPath = full + '.meta';
            if (!existsSync(metaPath)) {
                writeFileSync(metaPath, metaFor(rel, 'dir').content, 'utf8');
                created++;
                console.log('dir meta  +', rel);
            } else {
                kept++;
            }
            walk(full);
        } else {
            const ext = extname(name).toLowerCase();
            let type = null;
            if (ext === '.ts') type = 'ts';
            else if (ext === '.scene') type = 'scene';
            if (!type) continue;
            const metaPath = full + '.meta';
            if (existsSync(metaPath)) {
                kept++;
                continue;
            }
            const m = metaFor(rel, type);
            writeFileSync(metaPath, m.content, 'utf8');
            created++;
            console.log(`${type.padEnd(5)} meta +`, rel, '->', m.uuid);
        }
    }
}

walk(ASSETS);
console.log(`\ncreated ${created}, kept ${kept}`);
