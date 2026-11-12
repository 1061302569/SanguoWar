import { Balance } from './Balance';
import { BattleResult } from '../data/Types';

/** 参战一方的输入参数 */
export interface CombatSide {
    /** 兵力 */
    troops: number;
    /** 将领攻击等级之和（无将领为 0） */
    atk: number;
    /** 将领防御等级之和 */
    def: number;
    /** 兵力上限，用于计算溢出损耗 */
    cap: number;
    /**
     * 额外战力倍率（君主加成等），不传按 1 算。
     *
     * 与 atk / def 分开是刻意的：等级和是**加法**（多带一个将就多一份），
     * 君主加成是**乘法**（整体战力抬一个百分比）。把百分比折进等级和里，
     * 就变成「将领越多、加成越被摊薄」，与「君威」的语义相反。
     */
    mul?: number;
}

/** 战斗中的上下文 */
export interface CombatContext {
    /** 进攻方 */
    atkSide: CombatSide;
    /** 防守方 */
    defSide: CombatSide;
    /** 防守方工事等级 */
    fort: number;
    /** 战斗名称（用于战报） */
    title: string;
}

let _rand = Math.random;

/** 可注入随机源，便于测试与回放 */
export function setRandom(fn: () => number): void {
    _rand = fn;
}

/**
 * 取一个 [0, 1) 随机值。
 *
 * 战斗以外的规则（生擒、招降）也走这里，而不是各自写 Math.random()：
 * 测试只要 setRandom() 一次就能把整局随机数钉死，否则「这次到底抓没抓到」
 * 永远复现不了。
 */
export function random(): number {
    return _rand();
}

/** 在 [min, max) 内取随机值 */
function randRange(min: number, max: number): number {
    return min + (max - min) * _rand();
}

function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v;
}

/**
 * 战斗结算（欧陆战争式）
 *
 * 设计要点：
 * 1. 分若干轮消耗战，每轮双方按战力对比互相杀伤，直到一方崩溃或轮次耗尽。
 * 2. 兵力和武将等级共同决定战斗力，武将等级提供稳定的成长感。
 * 3. 工事只对防守方生效，攻城方需要更多兵力才能取胜。
 * 4. 保留随机浮动，但战力差距够大时结果确定，避免「十倍兵力打不下」的荒谬感。
 * 5. 进攻方必须打崩守军防线（剩余低于崩溃阈值）才能占领。
 */
export function resolveBattle(ctx: CombatContext): BattleResult {
    const atk = ctx.atkSide;
    const def = ctx.defSide;
    const log: string[] = [];

    const atkStart = atk.troops;
    const defStart = def.troops;

    // 攻守双方战力：兵力 × 将领加成 × 君主加成 × 工事加成
    const atkMul = (1 + atk.atk * Balance.atkPerRating) * (atk.mul || 1);
    const defMul = (1 + def.def * Balance.defPerRating) * (def.mul || 1)
        * (1 + ctx.fort * Balance.fortPerPoint);

    log.push(`${ctx.title}：${atkStart} 对 ${defStart}，工事 ${ctx.fort} 级`);

    let a = atkStart;
    let d = defStart;
    const rounds = Math.max(1, Balance.maxRounds);
    let actuallyFought = 0;

    for (let round = 0; round < rounds; round++) {
        if (a <= 0 || d <= 0) {
            break;
        }
        actuallyFought++;

        // 每轮各自的即时战力
        const ap = a * atkMul;
        const dp = d * defMul;
        const total = ap + dp;
        if (total <= 0) {
            break;
        }

        // 战力占比：越强的一轮打出的杀伤越多
        const aShare = ap / total;
        // 随机浮动
        const noise = randRange(-Balance.randomSpread, Balance.randomSpread);
        const effA = clamp(aShare + noise, 0.05, 0.95);

        // 本轮基础杀伤强度（相对双方现有兵力）
        const intensity = Balance.attrition / rounds * 2.2;

        // 双方本轮损失：按对手战力占比分配
        const dLoss = d * intensity * effA;
        const aLoss = a * intensity * (1 - effA);

        a = Math.max(0, a - aLoss);
        d = Math.max(0, d - dLoss);

        const desc = effA > 0.62 ? '我军压制敌军' : effA < 0.38 ? '敌军反扑猛烈' : '两军相持';
        log.push(`第 ${round + 1} 轮：${desc}（我军 ${Math.round(a)}／敌军 ${Math.round(d)}）`);
    }

    const atkLeft = Math.round(a);
    const defLeft = Math.round(d);
    const atkLoss = atkStart - atkLeft;
    const defLoss = defStart - defLeft;

    // 胜负判定：
    // 守军被打崩到崩溃线以下，且进攻方仍保有战力 -> 攻方胜
    const collapseLine = defStart * Balance.collapseRatio;
    let attackerWin: boolean;
    if (defLeft <= 0) {
        attackerWin = atkLeft > 0;
    } else if (atkLeft <= 0) {
        attackerWin = false;
    } else if (defLeft <= collapseLine) {
        // 守方崩线，但攻方自己也得没崩：同兵力硬拼时双方都会掉到崩溃线
        // 以下，这时守在城里的那一方算守住 —— 否则「1:1 攻城」会判攻方胜，
        // 守城方白守，城墙与工事全失去意义。
        attackerWin = atkLeft > atkStart * Balance.collapseRatio;
    } else {
        // 都没有崩溃：按双方的相对剩余兵力比判定
        attackerWin = (atkLeft / Math.max(1, atkStart)) > (defLeft / Math.max(1, defStart)) * 1.15
            && defLeft < defStart * 0.6;
    }

    if (attackerWin) {
        log.push('敌军溃败，城池易手！');
    } else if (atkLeft <= 0 && defLeft <= 0) {
        log.push('两败俱伤，我军无力占领。');
    } else {
        log.push('久攻不下，我军暂退。');
    }

    return {
        attackerWin,
        attackerLoss: Math.max(0, atkLoss),
        defenderLoss: Math.max(0, defLoss),
        attackerLeft: Math.max(0, atkLeft),
        defenderLeft: Math.max(0, defLeft),
        rounds: actuallyFought,
        log,
    };
}
