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

/**
 * 每日挑战的当天记录。
 *
 * 只保留「今天」一份：跨天时整条替换。历史成绩留在 dailyStreak 与
 * bestTurns 里，不堆一个无限增长的日期数组 —— 小游戏的本地存储很小，
 * 而且玩家真正关心的只有「今天最好多少回合」和「连续来了几天」。
 */
export interface DailyRecord {
    /** YYYY-MM-DD（本地日期） */
    date: string;
    /** 今日最快统一回合数，0 = 尚未通关 */
    bestTurns: number;
    /** 今日挑战次数 */
    plays: number;
    /** 今日是否已通关 */
    cleared: boolean;
}

export function emptyDaily(date = ''): DailyRecord {
    return { date, bestTurns: 0, plays: 0, cleared: false };
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
    /** 已解锁成就 id（跨对局去重） */
    achievements: string[];
    /** 已统一过的剧本 id（「遍历群雄」按它判定，也用于结算页展示） */
    scenariosWon: string[];
    /** 今日挑战记录（只保留当天） */
    daily: DailyRecord;
    /** 连续参与每日挑战的天数 */
    dailyStreak: number;
}

export const PROFILE_VERSION = 2;
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
        achievements: [],
        scenariosWon: [],
        daily: emptyDaily(),
        dailyStreak: 0,
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
    // 成就 / 剧本 / 每日挑战是 v2 才有的字段：缺失时按空值回退，
    // 老档案读进来只是「图鉴从零开始」，累计局数与最快纪录仍然在。
    if (Array.isArray(raw.achievements)) {
        p.achievements = uniqueStrings(raw.achievements, 64);
    }
    if (Array.isArray(raw.scenariosWon)) {
        p.scenariosWon = uniqueStrings(raw.scenariosWon, 32);
    }
    p.dailyStreak = num(raw.dailyStreak, 0, 100000);
    if (raw.daily && typeof raw.daily === 'object'
        && typeof raw.daily.date === 'string' && isDateKey(raw.daily.date)) {
        p.daily = {
            date: raw.daily.date,
            bestTurns: num(raw.daily.bestTurns, 0, 100000),
            plays: num(raw.daily.plays, 0, 100000),
            cleared: raw.daily.cleared === true,
        };
    }
    return p;
}

/** 字符串数组去重 + 长度夹取（档案里的 id 列表共用） */
function uniqueStrings(raw: any[], cap: number): string[] {
    const out: string[] = [];
    for (const x of raw) {
        if (typeof x === 'string' && x.length > 0 && out.indexOf(x) < 0) {
            out.push(x.slice(0, 40));
            if (out.length >= cap) {
                break;
            }
        }
    }
    return out;
}

/** YYYY-MM-DD 且能被 Date 解析（拒绝 '2026-13-45' 这类脏值） */
export function isDateKey(s: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return false;
    }
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t);
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
    /** 剧本 id：成就「遍历群雄」与每日挑战记录都要用，旧调用方可不传 */
    scenarioId?: string;
    /** 是否为每日挑战局 */
    daily?: boolean;
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
    const tag = r.daily ? '今日挑战 · ' : '';
    if (r.win) {
        return `${tag}我用 ${r.turns} 回合统一天下（${r.scenario} · 执掌${r.faction}），`
            + `攻占 ${s.captures} 城、收降 ${s.persuaded} 人，评价「${gradeOf(true, r.turns)}」。`
            + '你能几回合？';
    }
    return `${tag}执掌${r.faction}打到第 ${r.turns} 回合、最多 ${s.maxCities}/${r.total} 城，`
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
        // 档案里的累计字段一律「复制后再改」：结算面板会反复打开，
        // 直接改传进来的对象会让「记录一次」变成「记录几次」。
        achievements: p.achievements.slice(),
        scenariosWon: p.scenariosWon.slice(),
        daily: { ...p.daily },
        dailyStreak: p.dailyStreak,
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
    // 成就与「已统一的剧本」都在这里落库：判定看的是**记录前**的档案，
    // 所以先算 unlockedBy 再合并，避免同一局把同一条成就重复播报。
    for (const a of unlockedBy(r, p)) {
        if (next.achievements.indexOf(a.id) < 0) {
            next.achievements.push(a.id);
        }
    }
    if (r.win && r.scenarioId && next.scenariosWon.indexOf(r.scenarioId) < 0) {
        next.scenariosWon.push(r.scenarioId);
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

// ----------------------------------------------------------------------
// 成就图鉴（P2：给「打完一局」一个长期理由）
//
// 设计原则：
//  - 只看**已经发生的事实**（本局战绩 + 记录前档案），不引入新机制、
//    不发任何资源，所以不可能破坏 18~21 回合的节奏；
//  - 覆盖不同玩法而不是只奖励赢：收降流、仁义流、硬碰硬、绝地翻盘、
//    换剧本、每日挑战都有对应成就，避免「打不过就永远零成就」；
//  - 判定函数是纯函数，Node 回归可以直接构造一局结果断言，不需要跑引擎。
// ----------------------------------------------------------------------

export interface AchievementDef {
    id: string;
    name: string;
    desc: string;
    /** 判定：本局结果 + **记录前**的档案（所以「累计 10 局」要 +1） */
    test: (r: RunResult, p: PlayerProfile) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
    {
        id: 'first_blood',
        name: '初战告捷',
        desc: '攻占第一座城池',
        test: (r) => r.stats.captures >= 1,
    },
    {
        id: 'first_win',
        name: '一统天下',
        desc: '首次统一全国',
        test: (r) => r.win,
    },
    {
        id: 'speed_s',
        name: '神速',
        desc: '20 回合内统一',
        test: (r) => r.win && r.turns <= 20,
    },
    {
        id: 'speed_a',
        name: '稳健',
        desc: '28 回合内统一',
        test: (r) => r.win && r.turns <= 28,
    },
    {
        id: 'persuader',
        name: '折冲樽俎',
        desc: '单局收降 5 名敌将',
        test: (r) => r.stats.persuaded >= 5,
    },
    {
        id: 'merciful',
        name: '仁义之师',
        desc: '单局放归 10 名俘虏',
        test: (r) => r.stats.released >= 10,
    },
    {
        id: 'iron_wall',
        name: '铁壁无缺',
        desc: '一城不失统一全国',
        test: (r) => r.win && r.stats.losses === 0,
    },
    {
        id: 'comeback',
        name: '绝地反击',
        desc: '丢城 10 次以上仍然统一',
        test: (r) => r.win && r.stats.losses >= 10,
    },
    {
        id: 'two_scenarios',
        name: '遍历群雄',
        desc: '在两个不同剧本各统一一次',
        test: (r, p) => r.win && !!r.scenarioId
            && p.scenariosWon.length >= 1
            && p.scenariosWon.indexOf(r.scenarioId) < 0,
    },
    {
        id: 'daily_first',
        name: '应战',
        desc: '完成一次每日挑战',
        test: (r) => r.daily === true,
    },
    {
        id: 'daily_s',
        name: '今日之最',
        desc: '每日挑战 20 回合内统一',
        test: (r) => r.daily === true && r.win && r.turns <= 20,
    },
    {
        id: 'veteran',
        name: '百战老卒',
        desc: '累计完成 10 局',
        test: (r, p) => p.plays + 1 >= 10,
    },
];

/**
 * 本局新解锁的成就（不含已拥有的）。
 * UI 在 `recordResult` **之前**调用它来播报，因为记录之后档案里就已经有了。
 */
export function unlockedBy(r: RunResult, p: PlayerProfile): AchievementDef[] {
    return ACHIEVEMENTS.filter(
        (a) => p.achievements.indexOf(a.id) < 0 && a.test(r, p),
    );
}

/** 图鉴摘要：`成就 3/12` */
export function achievementLine(p: PlayerProfile): string {
    return `成就 ${p.achievements.length}/${ACHIEVEMENTS.length}`;
}

// ----------------------------------------------------------------------
// 每日挑战（P2：给「明天还回来」一个具体理由）
//
// 同一天、同一剧本、同一势力、同一随机种子 —— 所有人从同一个局面起手，
// 比的是决策而不是肝度。种子只影响战斗波动与生擒判定，开局城池归属
// 完全由剧本决定，所以「同一局面」是成立的。
//
// 注意：玩家操作顺序不同会消耗不同次数的随机数，因此不是逐帧复现，
// 只是「同起点 + 同随机序列」。这一点写进 README，不吹成回放系统。
// ----------------------------------------------------------------------

export interface DailyChallenge {
    /** YYYY-MM-DD */
    date: string;
    scenarioId: string;
    factionId: string;
    /** 注入 Combat.setRandom() 的种子 */
    seed: number;
}

/** 本地日期键：玩家所在时区的「今天」，不用 UTC 免得凌晨 8 点才换日 */
export function dailyKeyOf(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    return `${y}-${pad(m)}-${pad(day)}`;
}

/** FNV-1a 32 位：把日期字符串稳定地映射成一个数，跨设备一致 */
function hash32(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/** 两个日期键相差几天（to - from）；无法解析时返回 0 */
export function dayDiff(from: string, to: string): number {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return 0;
    }
    return Math.round((b - a) / 86400000);
}

/**
 * 当日挑战配置。
 *
 * `pool` 由调用方传 SCENARIOS（档案层不 import 数据层，保持零依赖，
 * Node 回归可以直接塞两个假剧本进来断言分布）。
 */
export function dailyChallengeOf(
    dateKey: string, pool: Array<{ id: string; playable: string[] }>,
): DailyChallenge {
    const key = isDateKey(dateKey) ? dateKey : '1970-01-01';
    const seed = (hash32(`${key}|seed`) % 0x7fffffff) || 1;
    const list = Array.isArray(pool)
        ? pool.filter((x) => x && typeof x.id === 'string' && x.id.length > 0)
        : [];
    if (list.length === 0) {
        return { date: key, scenarioId: '', factionId: '', seed };
    }
    const sc = list[hash32(`${key}|scenario`) % list.length];
    const playable = Array.isArray(sc.playable) && sc.playable.length > 0
        ? sc.playable
        : [''];
    const factionId = playable[hash32(`${key}|faction`) % playable.length];
    return { date: key, scenarioId: sc.id, factionId, seed };
}

/**
 * 固定种子的伪随机数（LCG）。
 * 与 `tools/sim-game.ts` 同一套路：只用来喂 `Combat.setRandom()`，
 * 不参与任何数值计算，所以不会影响平衡。
 */
export function makeSeededRandom(seed: number): () => number {
    let s = (Math.floor(seed) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        // 取高位：低位在 LCG 里周期短，直接除会让随机数明显成块
        return (s >>> 8) / 16777216;
    };
}

/** 菜单 / 目标条上的今日挑战摘要 */
export function dailyLine(p: PlayerProfile, dateKey: string): string {
    if (!p.daily.date || p.daily.date !== dateKey) {
        return '今日挑战 · 尚未应战';
    }
    if (p.daily.cleared) {
        return `今日挑战 · 最佳 ${p.daily.bestTurns} 回合 · 已战 ${p.daily.plays} 局`;
    }
    return `今日挑战 · 已战 ${p.daily.plays} 局 · 尚未通关`;
}

/**
 * 记一次每日挑战成绩。
 *
 * 跨天时整条替换（只保留当天），并把连续天数算出来：
 * 昨天来过 → +1，否则从 1 重新开始。同一天多次挑战只累加次数与最佳。
 */
export function recordDaily(
    p: PlayerProfile, dateKey: string, win: boolean, turns: number,
): PlayerProfile {
    const key = isDateKey(dateKey) ? dateKey : p.daily.date;
    if (!key) {
        return p;
    }
    const next: PlayerProfile = {
        ...p,
        daily: { ...p.daily },
        achievements: p.achievements.slice(),
        scenariosWon: p.scenariosWon.slice(),
    };
    const t = Math.max(1, Math.round(turns) || 1);
    if (next.daily.date !== key) {
        const gap = next.daily.date ? dayDiff(next.daily.date, key) : 0;
        next.dailyStreak = gap === 1 ? Math.max(1, next.dailyStreak) + 1 : 1;
        next.daily = { date: key, bestTurns: win ? t : 0, plays: 1, cleared: win };
    } else {
        next.daily.plays += 1;
        if (win && (next.daily.bestTurns === 0 || t < next.daily.bestTurns)) {
            next.daily.bestTurns = t;
            next.daily.cleared = true;
        }
    }
    return next;
}
