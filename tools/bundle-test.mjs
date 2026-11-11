/**
 * 把 tools/logic-test.ts 与游戏逻辑源码打包成单个 ESM 文件，便于用 node 直接运行。
 * 只处理相对导入，并把无扩展名的 .ts 引用补全——Cocos 源码里必须保持无扩展名。
 *
 * 运行：node tools/bundle-test.mjs && node tools/.logic-test.bundle.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const root = resolve(process.cwd());
// 入口可用命令行参数指定，默认是自测脚本
const entryArg = process.argv[2] || 'tools/logic-test.ts';
const entry = resolve(root, entryArg);
const outName = 'tools/.bundle.' + entryArg.split('/').pop().replace(/\.ts$/, '') + '.ts';
const out = [];
const emitted = new Set();
const moduleIds = new Map();
let idCounter = 0;

function resolveImport(fromFile, spec) {
    if (!spec.startsWith('.')) {
        return null; // 外部包，原样保留
    }
    const base = resolve(dirname(fromFile), spec);
    // spec 可能已带 .ts 扩展名，也可能不带（Cocos 源码约定不带）
    if (base.endsWith('.ts') || base.endsWith('.js')) {
        return existsSync(base) ? base : null;
    }
    if (existsSync(base + '.ts')) {
        return base + '.ts';
    }
    if (existsSync(base + '.js')) {
        return base + '.js';
    }
    return null;
}

function emit(file) {
    if (emitted.has(file)) {
        return;
    }
    emitted.add(file);
    if (!moduleIds.has(file)) {
        moduleIds.set(file, idCounter++);
    }

    const original = readFileSync(file, 'utf8');
    let code = original;

    const importRe = /^import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"];?/gm;    code = code.replace(importRe, (m, starName, braced, defName, spec) => {
        const target = resolveImport(file, spec);
        if (!target) {
            return m;
        }
        emit(target);
        const id = moduleIds.get(target);
        if (starName) {
            return `const ${starName} = __mod.get(${id});`;
        }
        if (braced !== undefined) {
            return `const {${braced}} = __mod.get(${id});`;
        }
        return `const ${defName} = __mod.get(${id});`;
    });
    code = code.replace(/^import\s+['"]([^'"]+)['"];?/gm, (m, spec) => {
        const target = resolveImport(file, spec);
        if (!target) {
            return m;
        }
        emit(target);
        return '';
    });

    // 记录本文件导出的名字，再剥掉 export 关键字
    const exported = new Set();
    // 纯类型导出（interface / type）不参与运行时对象，必须排除
    const typeOnly = new Set();
    for (const m of original.matchAll(/^export\s+(?:interface|type)\s+(\w+)/gm)) {
        typeOnly.add(m[1]);
    }
    for (const m of original.matchAll(/^export\s+(?:const|let|var|class|interface|type|function|enum)\s+(\w+)/gm)) {
        exported.add(m[1]);
    }
    for (const m of original.matchAll(/^export\s*\{([^}]*)\};?/gm)) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop();
            if (name) {
                exported.add(name);
            }
        }
    }
    for (const t of typeOnly) {
        exported.delete(t);
    }

    code = code.replace(/^export\s+(const|let|var|class|interface|type|function|enum)\s+/gm, '$1 ');
    code = code.replace(/^export\s*\{[^}]*\};?/gm, '');
    code = code.replace(/^export\s+default\s+/gm, '');

    const ns = relative(root, file).replace(/\\/g, '/');
    out.push(`// ---- <<< ${ns} ----`);
    out.push(`__mod_factory(${moduleIds.get(file)}, () => {`);
    out.push(code);
    out.push(`return {${Array.from(exported).join(', ')}};`);
    out.push('});');
    out.push(`// ---- >>> ${ns} ----\n`);
}

emit(entry);

const header = [
    'const __mod = new Map();',
    'function __mod_factory(id, fn) {',
    '  // 延迟求值：先占位，避免循环依赖时读到 undefined',
    '  const holder = {};',
    '  __mod.set(id, holder);',
    '  const real = fn();',
    '  Object.assign(holder, real);',
    '}',
    '',
].join('\n');
writeFileSync(resolve(root, outName), header + out.join('\n'), 'utf8');
console.log('bundled -> ' + outName);
