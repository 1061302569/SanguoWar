/**
 * 局外档案与「首次体验」规则（纯逻辑，不依赖 cc / wx，可直接跑 Node 回归）
 *
 * 为什么要独立成一层：
 *  - 局面存档 `sanguowar_save_v1` 会在「新开一局」时被清掉，而累计战绩、
 *    引导进度、成就必须跨对局保留；
 *  - `GameState.deserialize()` 对 SAVE_VERSION 是严格相等校验，往 SaveData
 *    里塞新字段会给所有旧档埋雷。档案走独立 key + 宽松的字段回退；
 *  - 这一层只产出「展示与记录」，不发金币 / 兵 / 粮。上一轮试玩已经证明
 *    动数值会破坏 18~21 回合的节奏，新增的正反馈一律只给信息。
 */

/** 本局统计：全部是可选存档字段，旧档缺失时按 0 回退 */
export interface RunStats {
    /** 开局城数：阶段目标按它做相对推算，换剧本才不会一开局就「已达成」 */
    openingCities: number;
    /** 玩家攻占城池次数 */
    captures: number;
    /** 玩家丢城次数 */
    losses: number;
    /** 招降成功人次 */
    persuaded: number;
    /** 放归人次 */
    released: number;
    /** 本局最多同时拥有多少城 */
    maxCities: number;
}

export function emptyStats(openingCities = 0): RunStats {
    return {
        openingCities,
        captures: 0,
        losses: 0,
        persuaded: 0,
        released: 0,
        maxCities: openingCities,
    };
}

/**
 * 本局统计读档回退：**旧档没有 stats 字段时不能把战绩清零当成没打过**。
 * 至少按当前城数还原 maxCities，阶段目标才不会在老进度里显示「未起步」。
 * 每个字段单独夹取，脏数据（字符串 / 负数 / NaN）不会带进结算页。
 */
export function sanitizeStats(raw: any, openingCities: number, currentCities: number): RunStats {
    const s = emptyStats(Math.max(1, Math.round(openingCities) || 1));
    s.maxCities = Math.max(s.openingCities, Math.max(0, Math.round(currentCities) || 0));
    if (!raw || typeof raw !== 'object') {
        return s;
    }
    const num = (v: any): number => (
        typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0
    );
    s.captures = num(raw.captures);
    s.losses = num(raw.losses);
    s.persuaded = num(raw.persuaded);
    s.released = num(raw.released);
    // 开局城数缺席时沿用推算值；存在时夹到合法区间，避免目标门槛被改坏
    if (typeof raw.openingCities === 'number' && Number.isFinite(raw.openingCities)) {
        s.openingCities = Math.max(1, Math.min(999, Math.round(raw.openingCities)));
    }
    s.maxCities = Math.max(s.maxCities, s.openingCities, num(raw.maxCities));
    return s;
}

/** 局外档案（独立存档 key，跨对局保留） */
export interface PlayerProfile {
    version: number;
    /** 已结束的对局数（胜 + 败） */
    plays: number;
    /** 统一天下次数 */
    wins: number;
    /** 最快统一回合数，0 = 尚无纪录 */
    bestTurns: number;
    /** 引导进度：0..TUTORIAL_STEPS.length，等于长度即完成 */
    tutorialStep: number;
    /** 曾经达成过的阶段目标 id（跨对局去重） */
    objectives: string[];
    /** 最近一次战绩文案，供非微信环境复制分享 */
    lastResult: string;
}

export const PROFILE_VERSION = 1;
export const PROFILE_KEY = 'sanguowar_profile_v1';

export function defaultProfile(): PlayerProfile {
    return {
        version: PROFILE_VERSION,
        plays: 0,
        wins: 0,
        bestTurns: 0,
        tutorialStep: 0,
        objectives: [],
        lastResult: '',
    };
}

/**
 * 档案读回：字段全可选 + 数值夹取。
 * 存档可能被旧版本、脏数据或被手改过，这里一律兜底，绝不因为一条坏字段
 * 让玩家进不了游戏。版本不符时保留可辨识的累计值，不直接丢弃。
 */
export function sanitizeProfile(raw: any): PlayerProfile {
    const p = defaultProfile();
    if (!raw || typeof raw !== 'object') {
        return p;
    }
    const num = (v: any, lo: number, hi: number): number => (
        typeof v === 'number' && Number.isFinite(v)
            ? Math.max(lo, Math.min(hi, Math.round(v)))
            : 0
    );
    p.plays = num(raw.plays, 0, 100000);
    p.wins = num(raw.wins, 0, p.plays);
    p.bestTurns = num(raw.bestTurns, 0, 100000);
    p.tutorialStep = num(raw.tutorialStep, 0, TUTORIAL_STEPS.length);
    if (Array.isArray(raw.objectives)) {
        p.objectives = raw.objectives
            .filter((x: any) => typeof x === 'string' && x.length > 0)
            .slice(0, 32);
    }
    if (typeof raw.lastResult === 'string') {
        p.lastResult = raw.lastResult.slice(0, 200);
    }
    // 旧版本没有 wins 却记着通关回合时，至少保住纪录
    if (p.bestTurns > 0 && p.wins === 0) {
        p.wins = Math.max(1, p.wins);
    }
    return p;
}

// ----------------------------------------------------------------------
// 首次体验：任务式引导
// ----------------------------------------------------------------------

export interface TutorialStepDef {
    /** 一行短指令，常驻显示在目标条里 */
    text: string;
    /** 达成后的一句正反馈 */
    done: string;
}

/**
 * 引导不弹遮罩、不拦截点击：现有交互回归依赖真实点击链路，加一层模态
 * 会让整组测试失效。这里只给一句话，玩家真的做了动作才推进到下一步。
 */
export const TUTORIAL_STEPS: TutorialStepDef[] = [
    { text: '① 点一座带金环的城，看看你的地盘', done: '这就是你的城池，右栏能看兵力与可攻目标。' },
    { text: '② 给它下一道内政（如「治理」）', done: '内政只做选择，结束回合才统一结算。' },
    { text: '③ 点「结束回合」，看月收与 AI 动向', done: '每回合结算一次，AI 也会同步行动。' },
    { text: '④ 沿橙红箭头打下一座城', done: '新城当回合要整编，记得留兵驻守。' },
    { text: '⑤ 看战报里的 ! 要闻与敌情预警', done: '引导完成：接下来按阶段目标推进即可。' },
];

// ----------------------------------------------------------------------
// 阶段目标：把「18~40 回合才赢」切成三段可感知的进展
// ----------------------------------------------------------------------

export interface Objective {
    id: string;
    name: string;
    desc: string;
    target: number;
}

/** 目标按开局城数做相对推算，换剧本 / 换势力都不会一开局就显示「已达成」 */
export function objectiveTargets(total: number, openingCities: number): number[] {
    const t = Math.max(1, total);
    const o = Math.max(0, Math.min(t, openingCities));
    const first = Math.min(t, Math.max(5, o + 2));
    const second = Math.min(t, Math.max(12, Math.ceil(t * 0.35), o + 6));
    return [first, second, t];
}

export const OBJECTIVE_NAMES = ['立足', '破局', '问鼎'];
export const OBJECTIVE_IDS = ['foothold', 'breakout', 'domination'];

export function objectivesOf(total: number, openingCities: number): Objective[] {
    const targets = objectiveTargets(total, openingCities);
    const descs = [
        `占据 ${targets[0]} 座城池，站稳脚跟`,
        `占据 ${targets[1]} 座城池，形成国力优势`,
        `统一全部 ${targets[2]} 座城池`,
    ];
    return targets.map((target, i) => ({
        id: OBJECTIVE_IDS[i],
        name: OBJECTIVE_NAMES[i],
        desc: descs[i],
        target,
    }));
}

/** 已达成几个目标（0..3）；丢城时会回退，但不会重复播报 */
export function objectiveLevel(cities: number, total: number, openingCities: number): number {
    const targets = objectiveTargets(total, openingCities);
    let n = 0;
    for (const t of targets) {
        if (cities >= t) {
            n++;
        }
    }
    return n;
}

// ----------------------------------------------------------------------
// 战绩与分享
// ----------------------------------------------------------------------

export interface RunResult {
    win: boolean;
    faction: string;
    scenario: string;
    turns: number;
    cities: number;
    total: number;
    stats: RunStats;
}

/** 评价只按回合数分档，不看资源存量，避免诱导玩家囤钱不打 */
export function gradeOf(win: boolean, turns: number): string {
    if (!win) {
        return '未竟 · 再起一局';
    }
    if (turns <= 20) return '神速 · S';
    if (turns <= 28) return '稳健 · A';
    if (turns <= 40) return '持久 · B';
    return '苦战 · C';
}

/**
 * 分享文案：把「可比较的数字」放在最前面。
 * 「你能几回合？」是这套单机策略最自然、也最不破坏平衡的裂变钩子 ——
 * 比的是决策，不是付费或在线时长。
 */
export function shareTextOf(r: RunResult): string {
    const s = r.stats;
    if (r.win) {
        return `我用 ${r.turns} 回合统一天下（${r.scenario} · 执掌${r.faction}），`
            + `攻占 ${s.captures} 城、收降 ${s.persuaded} 人，评价「${gradeOf(true, r.turns)}」。`
            + '你能几回合？';
    }
    return `执掌${r.faction}打到第 ${r.turns} 回合、最多 ${s.maxCities}/${r.total} 城，`
        + `攻占 ${s.captures} 城、丢城 ${s.losses} 次。这局没撑住，你来试试？`;
}

/** 结算时更新档案，返回新对象（纯函数，便于回归断言） */
export function recordResult(p: PlayerProfile, r: RunResult): PlayerProfile {
    const next: PlayerProfile = {
        version: PROFILE_VERSION,
        plays: p.plays + 1,
        wins: p.wins + (r.win ? 1 : 0),
        bestTurns: p.bestTurns,
        tutorialStep: p.tutorialStep,
        objectives: p.objectives.slice(),
        lastResult: shareTextOf(r),
    };
    if (r.win && (next.bestTurns === 0 || r.turns < next.bestTurns)) {
        next.bestTurns = r.turns;
    }
    // 本局最多城数对应达成过的目标，跨对局只记一次
    const lv = objectiveLevel(r.stats.maxCities, r.total, r.stats.openingCities);
    for (let i = 0; i < lv; i++) {
        if (next.objectives.indexOf(OBJECTIVE_IDS[i]) < 0) {
            next.objectives.push(OBJECTIVE_IDS[i]);
        }
    }
    return next;
}

/** 档案摘要：结算页与引导条共用 */
export function profileLine(p: PlayerProfile): string {
    if (p.wins === 0) {
        return `累计 ${p.plays} 局 · 尚无统一纪录`;
    }
    return `累计 ${p.wins} 次统一 · 最快 ${p.bestTurns} 回合`;
}

// ----------------------------------------------------------------------
// 目标条文案（纯函数：同样的状态永远给出同样的一句话，便于回归）
// ----------------------------------------------------------------------

/** 引导未完成时目标条的第一行；step >= 长度返回空串（交给阶段目标） */
export function tutorialLine(step: number): string {
    if (step < 0 || step >= TUTORIAL_STEPS.length) {
        return '';
    }
    return `引导 ${step + 1}/${TUTORIAL_STEPS.length} · ${TUTORIAL_STEPS[step].text}`;
}

/**
 * 阶段目标条两行：第一行是当前进度，第二行是下一条要做的事。
 * 全部达成后第二行换成局外档案摘要，让「回来再玩」的累计成绩常驻可见。
 */
export function objectiveLines(
    cities: number, total: number, openingCities: number, p: PlayerProfile,
): string[] {
    const list = objectivesOf(total, openingCities);
    const lv = objectiveLevel(cities, total, openingCities);
    if (lv >= list.length) {
        return [`目标 · 问鼎已成　${cities}/${total} 城`, profileLine(p)];
    }
    const next = list[lv];
    return [`目标 · ${next.name}　${cities}/${next.target} 城`, next.desc];
}
