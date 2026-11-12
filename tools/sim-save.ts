/**
 * 存档往返的端到端验证：模拟「玩几回合 -> 退出 -> 重进」的完整过程。
 *
 * 运行：node tools/bundle-test.mjs tools/sim-save.ts && node --experimental-strip-types --no-warnings tools/.bundle.sim-save.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';

let failures = 0;

function assert(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

// ---- 第一局：正常游玩若干回合 ----
console.log('== 玩 5 回合 ==');
const gs = new GameState();
for (let i = 0; i < 5; i++) {
    for (const p of gs.provincesOf(gs.playerFaction)) {
        if (p.troops < gs.garrisonCap(p) * 0.6) {
            gs.recruit(p, 2000);
        }
    }
    // 尝试一次进攻
    for (const p of gs.provincesOf(gs.playerFaction)) {
        const targets = gs.attackTargets(p);
        if (targets.length > 0) {
            const best = targets[0];
            if (p.troops > best.troops * 1.5) {
                gs.attack(p, best);
            }
        }
    }
    gs.endTurn();
}

const before = {
    turn: gs.turn,
    date: gs.dateText(),
    mine: gs.provincesOf(gs.playerFaction).length,
    troops: gs.totalTroops(gs.playerFaction),
    gold: Math.round(gs.gold.get(gs.playerFaction) ?? 0),
};
console.log(`  第 ${before.turn} 回合，${before.date}，据点 ${before.mine}，兵力 ${before.troops}，金币 ${before.gold}`);

// ---- 存档（模拟 wx.setStorageSync 存的是字符串） ----
const raw = JSON.stringify(gs.serialize());
console.log(`  存档大小 ${raw.length} 字节`);

// ---- 模拟「退出后重进」：全新实例 + 从字符串恢复 ----
console.log('\n== 重新进入游戏 ==');
const gs2 = new GameState();
const parsed = JSON.parse(raw);
const ok = gs2.deserialize(parsed);
assert(ok, '存档恢复成功');

const after = {
    turn: gs2.turn,
    date: gs2.dateText(),
    mine: gs2.provincesOf(gs2.playerFaction).length,
    troops: gs2.totalTroops(gs2.playerFaction),
    gold: Math.round(gs2.gold.get(gs2.playerFaction) ?? 0),
};
console.log(`  第 ${after.turn} 回合，${after.date}，据点 ${after.mine}，兵力 ${after.troops}，金币 ${after.gold}`);

assert(after.turn === before.turn, '回合数一致');
assert(after.date === before.date, '年月一致');
assert(after.mine === before.mine, '据点数量一致');
assert(Math.abs(after.troops - before.troops) <= 1, '兵力总数一致');
assert(Math.abs(after.gold - before.gold) <= 1, '金币一致');

// ---- 恢复后继续玩，应当能正常推进 ----
console.log('\n== 恢复后继续玩 3 回合 ==');
for (let i = 0; i < 3; i++) {
    gs2.endTurn();
}
assert(gs2.turn === before.turn + 3, `回合正常推进（${gs2.turn}）`);

// ---- 存档中途势力灭亡的场景 ----
console.log('\n== 势力灭亡后存档 ==');
const gs3 = new GameState();
// 把曹操所有城池转给袁绍，制造玩家灭亡
for (const p of gs3.provincesOf('cao')) {
    p.owner = 'yuan_shao';
}
assert(gs3.isDefeat(), '玩家已灭亡');
const gs4 = new GameState();
gs4.deserialize(gs3.serialize());
assert(gs4.isDefeat(), '读档后仍判定为灭亡');
assert(gs4.provincesOf('cao').length === 0, '读档后曹操据点数为 0');

// ---- 读档不改变武将总数（在城 + 在营）----
let placed = 0;
gs4.provinces.forEach((p) => { placed += p.generals.length; });
let jailed = 0;
gs4.generals.forEach((g) => { if (g.captiveOf !== '') jailed++; });
assert(placed + jailed === gs4.generals.size,
    `读档后武将都有去处（在城 ${placed} + 在营 ${jailed} / ${gs4.generals.size}）`);

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
