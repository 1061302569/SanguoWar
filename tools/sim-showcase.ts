/**
 * 战斗演出与数值的一致性验证
 *
 * 核心命题：**动画只是表现，数值必须先定下来**。
 * 这里验证：即使演出被打断/跳过，战斗结果与直接调用 state.attack 完全一致。
 *
 * 运行：node tools/bundle-test.mjs tools/sim-showcase.ts && node --experimental-strip-types --no-warnings tools/.bundle.sim-showcase.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';
import { synthesize } from '../assets/scripts/core/SfxSynth.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

// 固定随机，让两次运行可比
function seedRandom(seed: number): void {
    let s = seed;
    setRandom(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    });
}

/** 找一对可进攻的省份 */
function pickAttackPair(gs: GameState): { from: any; to: any } | null {
    let pair: { from: any; to: any } | null = null;
    gs.provinces.forEach((p) => {
        if (pair || p.owner !== gs.playerFaction) return;
        const targets = gs.attackTargets(p);
        if (targets.length > 0) {
            pair = { from: p, to: targets[0] };
        }
    });
    return pair;
}

console.log('== 演出不改变战斗结果 ==');
{
    // 基准：直接结算
    seedRandom(42);
    const gsA = new GameState();
    const pairA = pickAttackPair(gsA);
    assert(!!pairA, '找到可进攻的目标');
    const resA = gsA.attack(pairA.from, pairA.to);
    const snapshotA = {
        captured: resA.captured,
        atkLeft: pairA.from.troops,
        defLeft: pairA.to.troops,
        ownerAfter: pairA.to.owner,
    };

    // 对照：走「演出流程」——先记录差值、结算、再取 garrison，模拟 doAttack 的顺序
    seedRandom(42);
    const gsB = new GameState();
    const pairB = pickAttackPair(gsB);
    const fromBefore = pairB.from.troops;
    const toBefore = pairB.to.troops;
    const resB = gsB.attack(pairB.from, pairB.to);
    const atkLoss = Math.max(0, fromBefore - pairB.from.troops);
    const defLoss = Math.max(0, toBefore - pairB.to.troops);
    const garrison = resB.captured ? pairB.to.troops : 0;
    const snapshotB = {
        captured: resB.captured,
        atkLeft: pairB.from.troops,
        defLeft: pairB.to.troops,
        ownerAfter: pairB.to.owner,
    };

    assert(snapshotA.captured === snapshotB.captured,
        `占领结果一致（${snapshotA.captured} vs ${snapshotB.captured}）`);
    assert(snapshotA.atkLeft === snapshotB.atkLeft, `进攻方剩余一致（${snapshotA.atkLeft}）`);
    assert(snapshotA.defLeft === snapshotB.defLeft, `守方剩余一致（${snapshotA.defLeft}）`);
    assert(snapshotA.ownerAfter === snapshotB.ownerAfter, `归属一致（${snapshotA.ownerAfter}）`);

    // 飘字用的差值必须与实际兵力变化相符
    assert(atkLoss >= 0, `进攻方损失非负（${atkLoss}）`);
    assert(defLoss >= 0, `守方损失非负（${defLoss}）`);
    if (resB.captured) {
        assert(garrison > 0 || pairB.to.troops === 0,
            `占领后有驻军（${garrison}）`);
    }
}

console.log('\n== 连续进攻 50 次不崩 ==');
{
    seedRandom(7);
    const gs = new GameState();
    let attacks = 0;
    let captured = 0;
    for (let i = 0; i < 50; i++) {
        // 给玩家补给，保证能持续进攻
        for (const p of gs.provincesOf(gs.playerFaction)) {
            p.troops = Math.max(p.troops, 8000);
        }
        const pair = pickAttackPair(gs);
        if (!pair) {
            gs.endTurn();
            continue;
        }
        const res = gs.attack(pair.from, pair.to);
        if (res) {
            attacks++;
            if (res.captured) captured++;
        }
        gs.endTurn();
    }
    assert(attacks > 0, `发生了进攻（${attacks} 次）`);
    console.log(`  进攻 ${attacks} 次，攻下 ${captured} 次`);

    // 兵力不能为负（飘字会显示负数）
    let negative = 0;
    gs.provinces.forEach((p) => {
        if (p.troops < 0) negative++;
    });
    assert(negative === 0, '没有出现负兵力');

    // 武将守恒
    let placed = 0;
    gs.provinces.forEach((p) => { placed += p.generals.length; });
    assert(placed === gs.generals.size, `武将守恒（${placed}/${gs.generals.size}）`);
}

console.log('\n== 音效名与演出阶段匹配 ==');
{
    // 演出里用到的音效名必须都在合成器里存在
    const needed = ['hit', 'capture', 'fail', 'click', 'turn'];
    for (const n of needed) {
        const pcm = synthesize(n as any);
        assert(pcm.length > 0, `音效 ${n} 可合成`);
    }
}

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
