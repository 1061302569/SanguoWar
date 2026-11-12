/**
 * AI 行为回归：把「AI 到底聪明在哪」钉成可复现的断言
 *
 * 旧 AI 只有一条规则：单城裸兵力比 > 1.15 就撞，于是
 *   - 将领等级 / 君主加成 / 工事全不进决策，名将再多也是摆设；
 *   - 金币一分不花，国库躺到亡国；
 *   - 不会集结，兵摊在几十座城，遇到超编城就整局零出兵。
 * 这里用运行时钩子精确记录 AI 四个阶段的真实动作（集结 / 调将 / 征兵 / 协同），
 * 而不是靠战报文本猜；再用固定随机源保证每次结果一致。
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { Balance } from '../assets/scripts/core/Balance.ts';
import { NEUTRAL } from '../assets/scripts/data/Factions.ts';
import { ProvinceState } from '../assets/scripts/data/Types.ts';
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

function fresh(seed = 20241112): GameState {
    let s = seed;
    setRandom(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    });
    return new GameState();
}

/** AI 各阶段的动作计数（private 方法在运行时就是普通方法，可直接包装） */
interface AiTrace {
    concentrated: number;
    generals: number;
    recruited: number;
    strikes: number;
    hits: Record<string, number>;
    /** AI 实际选中的主攻城（可能与构造场景时预设的不同） */
    mains: ProvinceState[];
    /** 集结时算出的目标兵力缺口 */
    needs: number[];
    /** 征兵实际扣掉的金币（不受当月税收干扰） */
    goldSpent: number;
    /** 集结给主攻城实际增加的兵力 */
    mainGain: number;
}
function trace(gs: GameState): AiTrace {
    const t: AiTrace = {
        concentrated: 0, generals: 0, recruited: 0, strikes: 0, hits: {},
        mains: [], needs: [], goldSpent: 0, mainGain: 0,
    };
    const any = gs as any;
    const origCon = any.aiConcentrate.bind(gs);
    const origGen = any.aiAssignGenerals.bind(gs);
    const origBuy = any.aiSpendTreasury.bind(gs);
    const origStrike = any.aiStrike.bind(gs);
    const origAttack = gs.attack.bind(gs);
    any.aiConcentrate = (...a: any[]) => {
        const m = a[1] as ProvinceState;
        t.mains.push(m);
        t.needs.push(a[2] as number);
        const before = m.troops;
        const n = origCon(...a);
        t.concentrated += n;
        t.mainGain += m.troops - before;
        return n;
    };
    any.aiAssignGenerals = (...a: any[]) => {
        t.mains.push(a[1] as ProvinceState);
        const n = origGen(...a); t.generals += n; return n;
    };
    any.aiSpendTreasury = (...a: any[]) => {
        const before = gs.gold.get(a[0]) || 0;
        const n = origBuy(...a);
        t.recruited += n;
        t.goldSpent += before - (gs.gold.get(a[0]) || 0);
        return n;
    };
    any.aiStrike = (...a: any[]) => {
        const n = origStrike(...a); t.strikes += n; return n;
    };
    gs.attack = (from: ProvinceState, to: ProvinceState) => {
        t.hits[to.id] = (t.hits[to.id] || 0) + 1;
        return origAttack(from, to);
    };
    return t;
}

/**
 * 造一个「AI 已统一大半、国库充盈、后方兵多、玩家只剩硬骨头」的局面。
 * 只改 owner / troops / dev / 将领驻地，不改规则代码。
 */
function makeScene(opt: {
    hard: boolean; gold?: number; dev?: number; singleTarget?: boolean;
    /** 后方只留少量余兵：集结填不满缺口，才会动用国库征兵 */
    leanRear?: boolean;
}): {
    gs: GameState; fid: string; main: ProvinceState; target: ProvinceState;
    mine: ProvinceState[];
} {
    const gs = fresh();
    const player = gs.playerFaction;
    // 找一个原本就与玩家接壤的势力当主角
    let fid = '';
    for (const p of gs.provinces.values()) {
        if (p.owner === player || p.owner === NEUTRAL) continue;
        if (gs.attackTargets(p).some((t) => t.owner === player)) { fid = p.owner; break; }
    }
    // 其余非玩家城全划给它，断言不会被别的战场污染
    gs.provinces.forEach((p) => { if (p.owner !== player) p.owner = fid; });
    if (opt.singleTarget) {
        // 只留一座玩家城当硬骨头：AI 只有一个进攻方向，必定要面对它
        const pc = gs.provincesOf(player);
        const keep = pc[0];
        for (const p of pc) {
            if (p !== keep) p.owner = fid;
        }
    }
    const mine = gs.provincesOf(fid);
    const fronts = mine.filter((p) => gs.attackTargets(p).length > 0);
    // 主攻城选驻军上限最大的前线城，才有空间容纳集结
    const main = fronts.slice().sort((a, b) => gs.garrisonCap(b) - gs.garrisonCap(a))[0];
    const target = gs.attackTargets(main)[0];

    // 后方城堆满余兵；主攻城故意留空，逼 AI 去搬兵
    for (const p of mine) {
        p.troops = Math.round(gs.garrisonCap(p) * (opt.leanRear ? 0.45 : 2));
        p.dev = opt.dev === undefined ? 100 : opt.dev;   // 100 = aiGovern 不花钱
    }
    main.troops = 150;
    // 目标：硬骨头用 2.5 倍超编，软柿子只留很少守军
    for (const p of gs.provincesOf(player)) {
        p.troops = opt.hard
            ? Math.round(gs.garrisonCap(p) * 2.5)
            : 60;
    }
    // 把闲置将领全挪到后方城，主攻城一名不留 —— 看 AI 会不会主动调将
    const spare: string[] = [];
    main.generals.splice(0, main.generals.length);
    for (const p of mine) {
        if (p.id === main.id || gs.attackTargets(p).length > 0) continue;
        // 留一名守将，其余进池子
        spare.push(...p.generals.splice(1));
    }
    const rears = mine.filter((p) => p.id !== main.id && gs.attackTargets(p).length === 0);
    spare.forEach((gid, i) => {
        if (rears.length > 0) rears[i % rears.length].generals.push(gid);
    });
    gs.gold.set(fid, opt.gold === undefined ? 50000 : opt.gold);
    gs.food.set(fid, 20000);
    return { gs, fid, main, target, mine };
}

/** 全局将领数（在城 + 在营） */
function generalCount(gs: GameState): number {
    let n = 0;
    gs.provinces.forEach((p) => { n += p.generals.length; });
    gs.generals.forEach((g) => { if (g.captiveOf !== '') n++; });
    return n;
}

// ----------------------------------------------------------------------
section('1. 战力口径：面板与 AI 用同一条胜率曲线，且不再用裸兵力比硬判');
// ----------------------------------------------------------------------
{
    const gs = fresh();
    check(Math.abs(gs.winRateOf(Balance.aiAttackRatio) - 0.5) < 1e-9,
        '战力比恰好等于 aiAttackRatio 时胜率 50%（守城优势的基准）');
    const a = gs.provincesOf(gs.playerFaction)[0];
    const t = gs.attackTargets(a)[0];
    if (t) {
        const pv = gs.previewAttack(a, t);
        check(Math.abs(pv.winRate - gs.winRateOf(pv.ratio)) < 1e-9,
            'previewAttack 的胜率来自 winRateOf()（玩家看到的与 AI 算的是同一条曲线）');
    } else {
        check(false, '开局玩家城有可攻目标');
    }
    check(gs.winRateOf(0.5) < gs.winRateOf(1) && gs.winRateOf(1) < gs.winRateOf(2),
        '胜率随战力比单调上升');
}

// ----------------------------------------------------------------------
section('2. 国力强时会集结、会调将、会花钱，而不是把资源摊在城里发呆');
// ----------------------------------------------------------------------
{
    const { gs, mine } = makeScene({ hard: true, singleTarget: true, leanRear: true });
    const before = generalCount(gs);
    const tr = trace(gs);
    gs.endTurn();
    const main = tr.mains[0];

    check(tr.concentrated > 0,
        `AI 沿路网集结了 ${Math.round(tr.concentrated)} 兵（旧 AI 从不调兵）`);
    check(!!main && tr.mainGain > 0,
        `主攻城 ${main ? main.name : '?'} 因集结多出 ${Math.round(tr.mainGain)} 兵`
        + '（自动补给只填到上限，多出来的只能来自 AI 主动集结）');
    check(tr.generals > 0,
        `AI 把 ${tr.generals} 名闲置将领调到主攻城（名将真正参战）`);
    check(!!main && main.generals.length <= Balance.generalsPerCity,
        '主攻城将领不超过 generalsPerCity 参战上限');
    check(tr.recruited > 0,
        `AI 动用国库急征 ${tr.recruited} 兵（旧 AI 一分钱不花）`);
    check(tr.goldSpent > 0,
        `征兵实际扣掉 ${Math.round(tr.goldSpent)} 金（不受当月税收干扰）`);
    check(generalCount(gs) === before,
        `调将 / 攻城后将领仍守恒（${before} 名）`);
    // 后方不能为了集结被搬空
    const rears = mine.filter((p) => p.id !== (main ? main.id : '')
        && gs.attackTargets(p).length === 0);
    check(rears.some((p) => p.troops >= gs.garrisonCap(p) * Balance.rearGarrisonRatio * 0.9),
        '后方城仍留着 rearGarrisonRatio 的守备，没有为了前线把自己搬空');
    check(gs.logs.some((l) => l.indexOf('集结') >= 0),
        '战报里能看到「XX 自后方集结 N 兵于 YY，图谋 ZZ」（AI 意图对玩家可见）');
}

// ----------------------------------------------------------------------
section('3. 优势时会多路协同打同一目标，不是各打各的');
// ----------------------------------------------------------------------
{
    const { gs, target } = makeScene({ hard: false, gold: 50000 });
    const tr = trace(gs);
    gs.endTurn();
    const hits = Object.values(tr.hits).reduce((a, b) => a + b, 0);
    check(tr.strikes > 0, `AI 本回合组织进攻 ${tr.strikes} 路`);
    check(hits >= 2,
        `同一目标被连续攻击 ${hits} 次（第一波削守军，后续波次趁虚而入）`);
    check(Math.max(0, ...Object.values(tr.hits)) <= Balance.aiMaxAttacksPerTarget,
        '单座目标的夹击路数不超过 aiMaxAttacksPerTarget');
    check(hits <= Balance.aiMaxAttacksPerFaction * 4,
        '每回合总出兵量受上限约束，不会一回合全面开战');
}

// ----------------------------------------------------------------------
section('4. 劣势时不送人头：打不动就收兵，不再按裸兵力比硬撞');
// ----------------------------------------------------------------------
{
    const { gs, fid, main } = makeScene({ hard: true, gold: 0 });
    // 只留主攻城一座，其余全划给玩家；没钱没粮，征兵也补不上
    for (const p of gs.provincesOf(fid)) {
        if (p.id !== main.id) p.owner = gs.playerFaction;
    }
    main.troops = 80;
    gs.gold.set(fid, 0);
    gs.food.set(fid, 0);
    for (const p of gs.provincesOf(gs.playerFaction)) {
        p.troops = Math.round(gs.garrisonCap(p) * 2.5);
    }
    const tr = trace(gs);
    gs.endTurn();
    const hits = Object.values(tr.hits).reduce((a, b) => a + b, 0);
    check(hits === 0, `面对超编坚城，AI 出兵 ${hits} 次（应为 0，不送人头）`);
    check(main.troops >= 0, '收兵后兵力状态合法');
}

// ----------------------------------------------------------------------
section('5. 一整局里 AI 持续活跃，后期不会归零');
// ----------------------------------------------------------------------
{
    const gs = fresh(777);
    const fid = gs.playerFaction;
    let fights = 0;
    let lateFights = 0;
    const origPush = gs.pushLog.bind(gs);
    let counter = 0;
    (gs as any).pushLog = (msg: string): void => {
        if (msg.indexOf('攻占') >= 0 || msg.indexOf('进攻 ') >= 0) counter++;
        origPush(msg);
    };
    for (let t = 0; t < 60; t++) {
        if (gs.isVictory() || gs.isDefeat()) break;
        for (const g of gs.prisonersOf(fid)) {
            if (g.def.ruler || gs.persuadeChance(g) < 0.4) gs.release(g.def.id);
            else gs.persuade(g.def.id);
        }
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
        const movable: Array<{ from: ProvinceState; to: ProvinceState; ratio: number }> = [];
        for (const p of gs.provincesOf(fid)) {
            for (const tg of gs.attackTargets(p)) {
                const ratio = p.troops / Math.max(1, tg.troops * (1 + tg.fort * 0.08));
                if (ratio > 1.3) movable.push({ from: p, to: tg, ratio });
            }
        }
        movable.sort((a, b) => b.ratio - a.ratio);
        for (const m of movable) {
            if (m.from.troops < 400) continue;
            gs.attack(m.from, m.to);
        }
        gs.domesticPolicy = gs.foodOf(fid) < 200 ? 'farm' : 'govern';
        for (const p of gs.provincesOf(fid)) {
            const tg = gs.attackTargets(p);
            if (tg.length === 0) continue;
            let best = 0;
            for (const x of tg) best = Math.max(best,
                p.troops / Math.max(1, x.troops * (1 + x.fort * 0.08)));
            if (best < 1.5) gs.queueDomestic(p, 'recruit');
        }
        const wasLate = gs.provincesOf(fid).length >= 20;
        counter = 0;
        gs.endTurn();
        fights += counter;
        if (wasLate) lateFights += counter;
    }
    check(gs.isVictory(), `这一局仍然能统一天下（${gs.turn} 回合 ${gs.provincesOf(fid).length}/35）`);
    check(fights > 50, `AI 全局出兵 ${fights} 次（旧版 53 次且后期停摆）`);
    check(lateFights > 0, `玩家 20 城以后 AI 仍出兵 ${lateFights} 次（旧版为 0）`);
}

// ----------------------------------------------------------------------
section('6. 接线守卫：不留假参数、不回退到旧规则、难度设定全部公开');
// ----------------------------------------------------------------------
function bodyOf(src: string, start: string, end: string): string {
    const i = src.indexOf(start);
    if (i < 0) return '';
    const e = end ? src.indexOf(end, i + start.length) : -1;
    return e > i ? src.slice(i, e) : src.slice(i);
}

async function guards(): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const state = readFileSync('assets/scripts/core/GameState.ts', 'utf8');
    const balance = readFileSync('assets/scripts/core/Balance.ts', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    const ai = bodyOf(state, 'private aiFactionAct(', '/**\n     * 经济结算');
    check(ai.indexOf('this.aiConcentrate(') >= 0 && ai.indexOf('this.aiAssignGenerals(') >= 0
        && ai.indexOf('this.aiSpendTreasury(') >= 0 && ai.indexOf('this.aiStrike(') >= 0,
    'aiFactionAct 串起集结 / 调将 / 征兵 / 协同四个阶段');
    check(state.indexOf('private aiPowerRatio(') >= 0
        && ai.indexOf('winRateOf(') >= 0,
    'AI 用含将领与工事的战力比 + 胜率曲线决策');
    check(ai.indexOf('ratio > Balance.aiAttackRatio') < 0,
        'AI 决策里不再有「裸兵力比 > 1.15 就撞」的旧规则');
    check(bodyOf(state, 'private aiConcentrate(', 'private aiAssignGenerals(')
        .indexOf('this.moveTroops(') >= 0,
    '集结走的是与玩家相同的 moveTroops（允许超编，没有隐藏加成）');

    const keys = [...balance.matchAll(/^\s{4}(\w+):\s*[^,]+,/gm)].map((m) => m[1]);
    const aiKeys = keys.filter((k) => k.startsWith('ai'));
    const dead = aiKeys.filter((k) => !new RegExp(`Balance\\.${k}\\b`).test(state));
    check(aiKeys.length >= 8 && dead.length === 0,
        `${aiKeys.length} 个 AI 参数全部接线（无假参数：${dead.join(',') || '无'}）`);
    const hidden = aiKeys.filter((k) => readme.indexOf(k) < 0);
    check(hidden.length === 0,
        `AI 难度参数全部在 README 公开（未公开：${hidden.join(',') || '无'}）`);

    console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}（${pass} 通过 / ${pass + fail}）`);
    if (fail > 0) process.exitCode = 1;
}

guards();
