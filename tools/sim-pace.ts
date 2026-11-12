/**
 * 节奏回归：**一局游戏必须能打完，且不能一开局就打完**
 *
 * 这一组断言守的是「好不好玩」里最容易被调参破坏的两端：
 *   - 打不完：兵凑不到单点优势，卡在最后几座城，玩家永远赢不了
 *             （曾经 200 回合停在 32/35，金币堆到 132 万）
 *   - 太快：  每回合能连续推城、兵越打越多，十来个回合就统一天下
 *
 * 用的是固定种子的确定性模拟（setRandom 钉死随机源），所以结果可复现。
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { Balance } from '../assets/scripts/core/Balance.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string): void {
    if (ok) {
        pass++;
        console.log(`  ok   ${label}`);
    } else {
        fail++;
        console.log(`  FAIL ${label}`);
    }
}
function section(t: string): void {
    console.log(`\n== ${t} ==`);
}

interface Run {
    win: boolean;
    turns: number;
    cities: number;
    gold: number;
    /** 有没有出现过「满编却打不动」的僵持回合 */
    stalled: number;
}

/** 跑一局：模拟一个会算、会征兵、会集结的玩家 */
function playOne(seed: number): Run {
    let s = seed;
    setRandom(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    });
    const gs = new GameState();
    const fid = gs.playerFaction;
    let stalled = 0;

    for (let t = 0; t < 300; t++) {
        if (gs.isVictory() || gs.isDefeat()) break;

        // 处置俘虏
        for (const g of gs.prisonersOf(fid)) {
            if (g.def.ruler || gs.persuadeChance(g) < 0.4) gs.release(g.def.id);
            else gs.persuade(g.def.id);
        }

        // 集结：后方余兵堆到相邻前线城（允许超编）
        const rear = gs.provincesOf(fid).filter((q) => gs.attackTargets(q).length === 0);
        for (const q of rear) {
            for (const p of gs.moveTargets(q)) {
                if (gs.attackTargets(p).length === 0) continue;
                const room = gs.garrisonCap(p) * Balance.overCapFactor - p.troops;
                if (room <= 0) continue;
                const amount = Math.min(room, Math.max(0, q.troops - 100));
                if (amount > 0) gs.moveTroops(q, p, amount);
            }
        }

        // 有优势就打
        const movable: Array<{ from: any; to: any; ratio: number }> = [];
        for (const p of gs.provincesOf(fid)) {
            for (const tg of gs.attackTargets(p)) {
                const ratio = p.troops / Math.max(1, tg.troops * (1 + tg.fort * 0.08));
                if (ratio > 1.3) movable.push({ from: p, to: tg, ratio });
            }
        }
        movable.sort((a, b) => b.ratio - a.ratio);
        let fought = 0;
        for (const m of movable) {
            if (m.from.troops < 400) continue;
            if (gs.attack(m.from, m.to)) fought++;
        }
        // 有目标却一次都打不出去 = 僵持回合
        if (movable.length > 0 && fought === 0) stalled++;

        gs.domesticPolicy = gs.foodOf(fid) < 200 ? 'farm' : 'govern';
        // 打不动就花钱征兵（可超编）
        for (const p of gs.provincesOf(fid)) {
            const tg = gs.attackTargets(p);
            if (tg.length === 0) continue;
            let best = 0;
            for (const x of tg) {
                best = Math.max(best, p.troops / Math.max(1, x.troops * (1 + x.fort * 0.08)));
            }
            if (best < 1.5) gs.queueDomestic(p, 'recruit');
        }
        gs.endTurn();
    }

    return {
        win: gs.isVictory(),
        turns: gs.turn,
        cities: gs.provincesOf(fid).length,
        gold: Math.round(gs.gold.get(fid) ?? 0),
        stalled,
    };
}

// ----------------------------------------------------------------------
section('1. 每一局都必须能打完（不能卡在最后几座城）');
// ----------------------------------------------------------------------
const SEEDS = [12345, 777, 2024, 555, 999, 31337];
const runs = SEEDS.map(playOne);
const wins = runs.filter((r) => r.win).length;
check(wins === SEEDS.length,
    `${SEEDS.length} 局全部通关（${wins}/${SEEDS.length}；卡住的局说明兵凑不出单点优势）`);

// ----------------------------------------------------------------------
section('2. 不能一开局就打完（内容要撑得住）');
// ----------------------------------------------------------------------
const minTurns = Math.min(...runs.map((r) => r.turns));
const maxTurns = Math.max(...runs.map((r) => r.turns));
check(minTurns >= 10, `最快一局 ${minTurns} 回合（≥10，否则发展度/内政来不及展开）`);
check(maxTurns <= 60, `最慢一局 ${maxTurns} 回合（≤60，否则中后期在空转）`);

// ----------------------------------------------------------------------
section('3. 资源不能堆成废纸');
// ----------------------------------------------------------------------
const maxGold = Math.max(...runs.map((r) => r.gold));
check(maxGold < 50000,
    `通关时金币最多 ${maxGold}（< 5 万；曾经堆到 132 万，说明钱完全没有出口）`);

// ----------------------------------------------------------------------
section('4. 僵持回合不能占大头');
// ----------------------------------------------------------------------
const stallRatio = runs.map((r) => r.stalled / Math.max(1, r.turns));
const worstStall = Math.max(...stallRatio);
check(worstStall < 0.5,
    `最差一局僵持回合占比 ${(worstStall * 100).toFixed(0)}%（< 50%）`);

// ----------------------------------------------------------------------
section('5. 后方补给与出征限制真的接在流程里');
// ----------------------------------------------------------------------
function bodyOf(src: string, start: string, end: string): string {
    const i = src.indexOf(start);
    if (i < 0) return '';
    const e = end ? src.indexOf(end, i + start.length) : -1;
    return e > i ? src.slice(i, e) : src.slice(i);
}

async function guards(): Promise<void> {
    // 动态 import：bundle-test.mjs 只转换相对路径的静态 import，
    // 顶层的 node:fs 静态 import 会被留在打包产物中间，直接语法报错。
    const { readFileSync } = await import('node:fs');
    const state = readFileSync('assets/scripts/core/GameState.ts', 'utf8');
    const types = readFileSync('assets/scripts/data/Types.ts', 'utf8');
    const combat = readFileSync('assets/scripts/core/Combat.ts', 'utf8');

    const endTurn = bodyOf(state, 'public endTurn(', 'private runAiPhase(');
    check(endTurn.indexOf('this.autoRedeploy()') >= 0,
        'endTurn() 里调用了 autoRedeploy()（后方补给）');
    check(endTurn.indexOf('p.attacked = false') >= 0,
        'endTurn() 每回合重置 attacked（否则一座城一辈子只能打一次）');

    const attack = bodyOf(state, 'public attack(', 'public isVictory(');
    check(attack.indexOf('!from.attacked') >= 0,
        'attack() 拦住已出征的城');
    check(attack.indexOf('to.attacked = true') >= 0,
        '攻占后新城本回合不能再出征（否则一回合连锁推七八座城）');

    check(types.indexOf('attacked = false') >= 0,
        'ProvinceState 有 attacked 字段');

    // 超编：调兵与征兵必须用同一条规则，否则会出现「调得进、征不进」的怪现象
    const move = bodyOf(state, 'public moveTroops(', 'private autoRedeploy(');
    const recruit = bodyOf(state, 'public recruit(', 'public executeDomestic(');
    check(move.indexOf('Balance.overCapFactor') >= 0,
        '调兵允许临时集结（overCapFactor）');
    check(recruit.indexOf('Balance.overCapFactor') >= 0,
        '征兵允许临时集结（与调兵同一条规则）');

    // 自动补给不能超编：超编是要付流失代价的取舍，得由玩家决定
    const redeploy = bodyOf(state, 'private autoRedeploy(', 'private advanceDate(');
    check(redeploy.indexOf('this.garrisonCap(best)') >= 0,
        '自动补给只填到上限，不替玩家做「超编」这个决定');

    // 守方优势：双方都打崩时守方算赢
    check(combat.indexOf('atkLeft > atkStart * Balance.collapseRatio') >= 0,
        '守方崩线时，攻方自己也不能崩（否则 1:1 攻城判攻方胜）');

    // 上限按城池规模算，不随被打烂的人口一起崩
    const cap = bodyOf(state, 'private capAt(', 'public garrisonCap(');
    check(cap.indexOf('st.def.pop') >= 0,
        '驻军上限取「当前人口与初始人口的较大者」（走廊城不能变成死锁）');

    console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}（${pass} 通过 / ${pass + fail}）`);
    if (fail > 0) {
        process.exitCode = 1;
    }
}

guards();
