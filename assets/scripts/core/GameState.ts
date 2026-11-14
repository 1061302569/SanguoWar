import { Balance } from './Balance';
import { Geo } from './Geo';
import { FACTIONS, FACTION_MAP, NEUTRAL } from '../data/Factions';
import { PROVINCES } from '../data/Provinces';
import { GENERALS, RULER_OF } from '../data/Generals';
import {
    DEFAULT_SCENARIO_ID, ScenarioDef, getScenario, playableFactions,
} from '../data/Scenarios';
import {
    FactionDef, GeneralDef, GeneralState, ProvinceState, DomesticOrderKey, RulerBonusKey,
} from '../data/Types';
import { resolveBattle, CombatSide, random } from './Combat';
import { RunStats, emptyStats, sanitizeStats, isDateKey } from './Profile';

/** 每回合产生的财政报告 */
export interface TurnReport {
    goldIncome: number;
    /** 玩家势力当前每月粮草产出（发展度越高越多） */
    foodIncome: number;
    /** 本回合玩家势力靠发展度自动补充的兵力 */
    reinforced: number;
    /** 本回合由「自动方针」补齐的城数（不含手动登记的城） */
    autoOrders: number;
    /** 本回合实际执行了内政的城数（手动 + 自动，每城最多 1） */
    domesticOrders: number;
    /** 本回合后方补给自动送往一线的兵力 */
    redeployed: number;
    popTotal: number;
    provinceCount: number;
    /** 本回合 AI 阶段从玩家手里夺走的城池 id（用于失守提示与 UI 校验） */
    lostCities: string[];
}

/** 一座城每回合只能下一道内政指令：现在补兵，还是投资未来 */
export type DomesticOrder = DomesticOrderKey;

/**
 * 内政自动化规则：**最后一道指令** + **一个开关**
 *
 * 城一多，逐城点四选一就成了体力活。打开自动后，结束回合统一结算时，
 * 会给「本回合没自己登记指令」的城下达 `lastOrder` 那一道指令。
 *
 * 执行时点只有一个：endTurn() → settleDomestic()。玩家回合内点内政键
 * 只是往 ProvinceState.pendingDomestic 里登记，不会改任何数值。
 *
 * 这个类型只是 `autoDomestic ? lastOrder : none` 的表达方式（见 domesticPolicy 访问器），
 * **不再单独存一份「方针」**。UI 上也没有第二套开关：一套内政按钮 + 一个「自动」键。
 */
export type DomesticPolicy = DomesticOrder | 'none';

/** 内政指令的中文名（战报 / toast 共用一处，避免两处各写一套） */
export const POLICY_NAME: Record<DomesticPolicy, string> = {
    none: '手动',
    govern: '治理',
    farm: '屯田',
    fortify: '筑城',
    recruit: '征兵',
};

/** 内政指令结果；失败时 reason 可直接给玩家看 */
export interface DomesticResult {
    ok: boolean;
    reason: string;
    /** 实际变化量（发展度 / 粮草 / 工事 / 兵力） */
    amount: number;
}

/**
 * 全局游戏状态
 *
 * 负责：省份/武将数据的建立、回合推进、征兵、内政、编军、进攻与本方势力结算。
 * 该层不依赖任何渲染节点，方便单独测试，也便于以后做存档。
 *
 * 两套资源：
 *   - gold（金币）：征兵、治理、筑城的花费，来自城池税收；
 *   - food（粮草）：每回合按发展度产出，是「月募兵」与筑城的消耗。
 * 城池发展度 dev 通过同一个 devFactor 放大四项月产出
 * （金币 / 粮草 / 月募兵 / 屯田），形成经营闭环；没有第二套系数。
 */
export class GameState {
    /** 省份 id -> 状态 */
    public provinces: Map<string, ProvinceState> = new Map();
    /** 武将 id -> 状态 */
    public generals: Map<string, GeneralState> = new Map();
    /** 势力 id -> 金币 */
    public gold: Map<string, number> = new Map();
    /** 势力 id -> 粮草（发展度机制的第二种资源） */
    public food: Map<string, number> = new Map();
    /** 玩家控制的势力 */
    public playerFaction = getScenario(DEFAULT_SCENARIO_ID).playerFaction;
    /** 当前剧本 id（存档会带上，换剧本/重开一局都靠它） */
    public scenarioId = DEFAULT_SCENARIO_ID;
    /** 当前回合数（从 1 开始） */
    public turn = 1;
    /** 当前年月 */
    public year = Balance.startYear;
    public month = Balance.startMonth;
    /** 玩家本回合是否已结束（用于禁用操作） */
    public playerTurnEnded = false;
    /**
     * 内政自动化：打开后，结束回合统一结算时会给「本回合没登记指令」的城
     * 自动下达 `lastOrder` 那一类指令。
     *
     * 为什么不是单独一套「方针按钮」：四个内政指令在面板上已经有一排按钮，
     * 再摆一排一模一样的，玩家根本分不清哪个是给当前城下令、哪个是设方针。
     * 现在就是「你最后点的那个指令 + 一个自动开关」：开了就每回合重复它，
     * 关了就纯手动。默认关 —— 没表态就不该替玩家花钱。
     */
    public autoDomestic = false;
    /** 最近一次下达的内政指令；自动化时重复的就是它 */
    public lastOrder: DomesticOrder = 'govern';

    /**
     * 当前生效的内政方针（自动化关闭时为 `none`）
     *
     * 用访问器而不是字段：`autoDomestic` + `lastOrder` 已经能完整表达状态，
     * 多存一个字段就有两个真相源，迟早对不上。读的地方仍然写
     * `state.domesticPolicy`，赋值也照旧（`= 'govern'` 等于「开自动 + 治理」）。
     */
    get domesticPolicy(): DomesticPolicy {
        return this.autoDomestic ? this.lastOrder : 'none';
    }

    set domesticPolicy(p: DomesticPolicy) {
        if (p === 'none') {
            this.autoDomestic = false;
        } else {
            this.lastOrder = p;
            this.autoDomestic = true;
        }
    }

    /** 记下玩家刚选的指令（打开自动后，之后每回合重复它） */
    public rememberOrder(order: DomesticOrder): void {
        this.lastOrder = order;
    }

    /**
     * 回合内**登记**一道内政指令：只改选择，不改任何数值。
     *
     * 这是玩家回合内唯一会碰内政的入口。以前这里直接 executeDomestic()，
     * 结果「回合内点一次筑城」立刻加工事，结束回合的自动方针又给全境
     * 补一轮 —— 一回合执行了两批，玩家根本算不清账。
     * 现在所有内政都只在 endTurn() 的 settleDomestic() 里执行一次。
     *
     * 再点同一道 = 取消选择（选错了可以反悔，不消耗回合）；
     * 点另一道 = 改选。选择的同时记下 `lastOrder`，打开「自动」后
     * 这道指令就是全境方针。
     *
     * @returns 'selected' 已登记 / 'cleared' 已取消
     */
    public queueDomestic(st: ProvinceState, order: DomesticOrder): 'selected' | 'cleared' {
        if (st.pendingDomestic === order) {
            st.pendingDomestic = 'none';
            return 'cleared';
        }
        st.pendingDomestic = order;
        this.rememberOrder(order);
        return 'selected';
    }

    /**
     * 这座城**本回合将执行**的内政指令（UI 高亮与结算共用同一个答案）
     *
     * 优先级：玩家手动登记 > 自动方针 > 不选。
     * 只有这一个函数决定「到底做哪一道」，面板显示与回合结算不会各算一套。
     */
    public effectiveOrder(st: ProvinceState): DomesticOrder | 'none' {
        if (st.pendingDomestic !== 'none') {
            return st.pendingDomestic;
        }
        return this.autoDomestic ? this.lastOrder : 'none';
    }

    /** 全部战报（上限 200 条，不进存档） */
    public logs: string[] = [];
    /**
     * 与 logs 一一对应的重要度：2 = 要闻（直接涉及玩家的战况、AI 对玩家的意图）
     * 1 = 玩家自己的内政 / 结算，0 = 其他势力之间的动态。
     *
     * AI 增强后一回合能写十几条战报，而战报窗口只有几行；只显示「最后 N 条」
     * 时，玩家丢城、被夹击、对手集结图谋这类关键信息会被 AI 互殴日志冲掉
     * （试玩探针里 42%~59% 的玩家要闻被挤出窗口）。分级后由 recentLogs()
     * 把要闻钉在窗口顶部，普通日志只补空位。
     */
    private logPriority: number[] = [];

    /**
     * 敌情预警：上一回合 AI 阶段「自后方集结、图谋我方哪座城」。
     * key = 我方城池 id，value = 集结方与兵力描述。
     *
     * AI 会主动集结是这次增强的核心，但如果玩家只能在战报里瞥一眼「图谋 XX」，
     * 下回合照样不知道该往哪调兵。把它留到玩家回合，面板和提示条都能看见，
     * 「AI 有意图」才变成「玩家有对策」。每回合 AI 阶段前清空，不进存档。
     */
    public threats: Map<string, string> = new Map();

    /**
     * 本局战绩统计。
     *
     * 结算页要能给玩家一个「值得晒、值得再来一次」的数字，但只靠
     * `turn` 和当前城数说不清这一局发生了什么。这里只记事实（攻占 /
     * 丢城 / 招降 / 放归 / 最大版图），**不发任何奖励**，因此不改变
     * 已经校准好的 18~21 回合节奏。随局面存档一起走，旧档缺失时回退。
     */
    public stats: RunStats = emptyStats();

    /**
     * 本局是否为每日挑战局：存的是当天日期键（YYYY-MM-DD），空串 = 普通局。
     *
     * 只记「哪一天」，不记种子 —— 种子由 `dailyChallengeOf(date)` 纯函数
     * 重新推导，所以读档、换设备、隔天再读都能算出同一个种子。
     * 结算时靠它决定是否更新档案里的今日挑战成绩。
     */
    public dailyDate = '';

    /**
     * 每回合结算完成后的回调 —— UI 的**统一刷新入口**
     *
     * ⚠ AI 阶段会直接改写 ProvinceState.owner / troops，而地图版图颜色只在
     * MapRenderer.draw() 里按 owner 重绘（每帧只画选中光晕，不会重画底图）。
     * 以前这里是个从不触发的死钩子，导致「对手回合攻下城池、到玩家回合
     * 地图势力色还是旧的」。现在由订阅者负责 refreshAll()，
     * 任何调用 endTurn() 的入口都不必再各自记得手动刷新。
     */
    public onTurnEnd: ((report: TurnReport) => void) | null = null;

    constructor() {
        this.reset();
    }

    /**
     * 重置为某个剧本的初始局面（= 新开一局）
     *
     * @param scenarioId 剧本 id；省略则沿用当前剧本
     * @param factionId 玩家想执掌的势力；只要在剧本开局版图里有城即可
     *                  （不在列表里才回退到默认势力，防止读档脏值判负）
     */
    public reset(scenarioId: string = this.scenarioId, factionId?: string): void {
        const sc = getScenario(scenarioId);
        this.scenarioId = sc.id;
        const factions = playableFactions(sc);
        this.playerFaction = factionId && factions.indexOf(factionId) >= 0
            ? factionId
            : sc.playerFaction;

        this.provinces.clear();
        this.generals.clear();
        this.gold.clear();
        this.food.clear();
        this.turn = 1;
        this.year = sc.year;
        this.month = sc.month;
        this.playerTurnEnded = false;
        this.logs = [];
        this.logPriority = [];
        this.threats.clear();

        for (const def of PROVINCES) {
            const owner = sc.owners[def.id] || NEUTRAL;
            const st = new ProvinceState(def, owner);
            // 发展度按人口与大城加成推算：开局就能看出哪些是富庶大城
            st.dev = this.initialDev(st);
            const cap = this.garrisonCap(st);
            // 初始驻军按人口与工事给一个合理值，剧本可整体放大
            st.troops = Math.round(cap * (0.45 + (def.city ? 0.15 : 0)) * (sc.troopsScale ?? 1));
            this.provinces.set(def.id, st);
        }

        for (const def of GENERALS) {
            this.generals.set(def.id, {
                def,
                level: 1,
                exp: 0,
                faction: def.faction,
                loyalty: Math.max(Balance.loyaltyMin,
                    Math.min(Balance.loyaltyMax, def.loyalty)),
                captiveOf: '',
            });
        }

        this.placeGenerals(sc);

        // 初始金币与粮草
        for (const f of FactionList) {
            this.gold.set(f.id, sc.gold ?? 800);
            this.food.set(f.id, sc.food ?? Balance.startFood);
        }
        this.gold.set(NEUTRAL, 300);
        this.food.set(NEUTRAL, Balance.startFood);

        // 开局城数是阶段目标的基准：换剧本 / 换势力都按本局起手推算，
        // 不会出现「一开局目标就已达成」。
        this.stats = emptyStats(this.provincesOf(this.playerFaction).length);
        // 每日挑战标记属于「这一局怎么开的」，重开必须清掉；
        // 由 startNewGame() 在 reset() 之后按需写回。
        this.dailyDate = '';
    }

    /**
     * 安排武将驻地
     *
     * 194 剧本有精细的驻守表；新剧本直接按「武将所属势力 -> 该势力的城」
     * 轮流分配，就不会出现「关羽驻在曹操城里」这种错乱，加剧本时也不用
     * 再手工写一遍 48 名武将的位置。没有城的势力，其武将暂不驻守。
     */
    private placeGenerals(sc: ScenarioDef): void {
        if (sc.generalPosts) {
            for (const gid of Object.keys(sc.generalPosts)) {
                const st = this.provinces.get(sc.generalPosts[gid]);
                if (st && this.generals.has(gid)) {
                    st.generals.push(gid);
                }
            }
            return;
        }

        const byFaction = new Map<string, string[]>();
        for (const def of GENERALS) {
            const list = byFaction.get(def.faction) || [];
            list.push(def.id);
            byFaction.set(def.faction, list);
        }
        byFaction.forEach((gids, fid) => {
            const cities = this.provincesOf(fid)
                .slice()
                .sort((a, b) => Number(b.def.city) - Number(a.def.city));
            if (cities.length === 0) {
                return;
            }
            gids.forEach((gid, i) => cities[i % cities.length].generals.push(gid));
        });
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    /** 指定人口下的驻军上限（征兵会改人口，必须能按「未来人口」试算） */
    private capAt(st: ProvinceState, pop: number): number {
        // 驻军容量按「城池规模」定：取当前人口与初始人口的较大者。
        // 城被反复攻打后人口会掉到个位数，若上限跟着掉，走廊城就变成死锁
        // （北平人口 6 → 上限 286，后方几万兵送不进来，最后一座城永远打不下）。
        // 人口仍然决定收入与募兵，所以「打烂的城」依然虚弱，只是不会卡死。
        const base = Math.max(pop, st.def.pop);
        const raw = base * Balance.garrisonCapPerPop + (st.def.city ? 800 : 0);
        // 保底见 Balance.garrisonCapMin：人口基数特别小的城也要能驻军
        return Math.round(Math.max(raw, Balance.garrisonCapMin));
    }

    /** 省份驻军上限 */
    public garrisonCap(st: ProvinceState): number {
        return this.capAt(st, st.pop);
    }

    /**
     * 城池初始发展度
     *
     * 人口越多、是州治大城，开局越繁华。单独抽成 public 方法是因为
     * 旧存档没有 dev 字段时也要用同一套公式回退，不能和开局算出两套值。
     */
    public initialDev(st: ProvinceState): number {
        const raw = st.def.pop * Balance.devPerPop + (st.def.city ? Balance.devCityBonus : 0);
        return Math.max(Balance.devMin, Math.min(Balance.devMax, Math.round(raw)));
    }

    /**
     * 发展度倍率：**四项月产出唯一共用的系数**
     *
     * 金币、粮草、月募兵、屯田都乘它。0 → 1.0，100 → 2.0，
     * 所以「治理 +8」= 这座城所有月产出 +8%，玩家不用记四套公式。
     */
    public devFactor(st: ProvinceState): number {
        return 1 + (st.dev / 100) * Balance.devOutputFactor;
    }

    /**
     * 省份每月金币收入：人口 × 大城加成 × 发展度倍率 × 君主加成
     *
     * 君主加成只认**驻守在这座城**的君主（见 rulerBonusAt），
     * 所以把君主调到哪里、哪座城的月收就抬起来 —— 这是一步可以操作的决策，
     * 不是一个「招到就永久全局 +20%」的被动数值。
     */
    public provinceIncome(st: ProvinceState): number {
        const cityBonus = st.def.city ? 1.35 : 1;
        const ruler = 1 + this.rulerBonusAt(st, 'gold');
        return Math.round(st.pop * Balance.incomePerPop * cityBonus * this.devFactor(st) * ruler);
    }

    /** 省份每月粮草产出：人口 × 发展度倍率 × 君主加成 */
    public foodIncome(st: ProvinceState): number {
        const ruler = 1 + this.rulerBonusAt(st, 'food');
        return Math.round(st.pop * Balance.foodPerPop * this.devFactor(st) * ruler);
    }

    /**
     * 该城每月常规募兵额（未扣粮草与驻军上限）
     *
     * 注意这不是内政指令「征兵」：这是每回合自动发生的常规兵役，
     * 只吃粮草、看发展度；内政的征兵是花金币与人口买「立刻到账」。
     * 面板上叫「月募兵」，避免和「自动内政」的「自动」撞词。
     */
    public autoReinforce(st: ProvinceState): number {
        return Math.round(st.pop * Balance.reinforcePerPop * this.devFactor(st));
    }

    /** 势力粮草余额（HUD 用） */
    public foodOf(factionId: string): number {
        return Math.round(this.food.get(factionId) || 0);
    }

    /** 势力所有省份 */
    public provincesOf(factionId: string): ProvinceState[] {
        const out: ProvinceState[] = [];
        this.provinces.forEach((p) => {
            if (p.owner === factionId) {
                out.push(p);
            }
        });
        return out;
    }

    /** 势力总兵力 */
    public totalTroops(factionId: string): number {
        let sum = 0;
        for (const p of this.provincesOf(factionId)) {
            sum += p.troops;
        }
        return sum;
    }

    /** 势力总人口 */
    public totalPop(factionId: string): number {
        let sum = 0;
        for (const p of this.provincesOf(factionId)) {
            sum += p.pop;
        }
        return sum;
    }

    /** 省份上的将领状态列表 */
    public generalsAt(st: ProvinceState): GeneralState[] {
        const out: GeneralState[] = [];
        for (const gid of st.generals) {
            const g = this.generals.get(gid);
            if (g) {
                out.push(g);
            }
        }
        return out;
    }

    /**
     * 将领等级之和（只取战力最高的 generalsPerCity 名参战）
     *
     * 一座城协同守城/出征的战将有限：亡国降将全堆到同一座城时，超出上限
     * 的守将不再把攻防等级一层层叠上去（见 Balance.generalsPerCity）。
     * 将领本人仍在城上、守恒不变，只是不计入战力。
     */
    private sumGeneralRating(st: ProvinceState, key: 'atk' | 'def'): number {
        const rated: number[] = [];
        for (const gid of st.generals) {
            const g = this.generals.get(gid);
            if (g) {
                rated.push(g.def[key] + (g.level - 1) * 0.5);
            }
        }
        rated.sort((a, b) => b - a);
        const limit = Math.max(1, Balance.generalsPerCity);
        let sum = 0;
        for (let i = 0; i < Math.min(limit, rated.length); i++) {
            sum += rated[i];
        }
        return sum;
    }

    // ------------------------------------------------------------------
    // 君主 / 忠诚度 / 俘虏
    //
    // 一条因果链，没有第二条：
    //   攻破敌城 → 按公开概率生擒守将 → 俘虏营二选一（招降 / 放归）
    //   → 招降失败：忠诚升，越劝越硬
    //   → 放归：回原势力，忠诚降（被旧主猜忌），下次被俘就更好招
    // 俘虏用 GeneralState.captiveOf 表达，不另存一份名单：
    // 一个将领要么在城上，要么在营里，不会两边都算。
    // ------------------------------------------------------------------

    /** 势力君主（没有将领的势力返回 null，例如 194 剧本的陶谦 / 刘繇） */
    public rulerOf(factionId: string): GeneralDef | null {
        const st = this.rulerStateOf(factionId);
        return st ? st.def : null;
    }

    /**
     * 势力君主的运行时状态。
     *
     * 必须校验 `g.faction === factionId`：`RULER_OF` 是**开局**的静态映射，
     * 君主被招降之后它还指着原势力。不校验的话，一个已经投靠我方的旧主
     * 会继续被当成原势力的君主显示，看起来像「一朝两主」。
     */
    public rulerStateOf(factionId: string): GeneralState | null {
        const g = this.generals.get(RULER_OF[factionId]);
        if (!g || g.faction !== factionId) {
            return null;
        }
        return g;
    }

    /**
     * 是否仍是**在位君主**。
     *
     * 三个条件同时成立才算：本人是君主、本势力认的君主就是他、这个势力还有城。
     *
     * 「君主不可招降」的准确含义是「**在位**君主不可招降」：他还坐着江山，
     * 不会屈居人下。一旦失去所有城池，他就只是个亡国的俘虏，从这一刻起
     * 按普通将领的规则走 —— 忠诚掉下来就能招。招降成功后 faction 改成我方，
     * RULER_OF 对不上他，也就自动不再是君主了（只是个带加成的客将）。
     */
    public isReigning(g: GeneralState): boolean {
        return !!g.def.ruler
            && RULER_OF[g.faction] === g.def.id
            && this.provincesOf(g.faction).length > 0;
    }

    /** 将领当前驻扎的城；在营里或流落无城时返回 null */
    public cityOfGeneral(gid: string): ProvinceState | null {
        let found: ProvinceState | null = null;
        this.provinces.forEach((p) => {
            if (!found && p.generals.indexOf(gid) >= 0) {
                found = p;
            }
        });
        return found;
    }

    /**
     * 该城的君主加成（0.2 = +20%）。同城有多位君主时**取最高，不叠加**。
     *
     * 只认带 bonus 的将领，也就是君主。玩家自己的君主和招降来的旧主都算：
     * 谁驻在这座城，这座城就听谁的。不叠加是硬规则 —— 否则把几个招来的旧主
     * 塞进一城就能堆出离谱战力，玩家会立刻发现「堆君主」是唯一最优解。
     */
    public rulerBonusAt(st: ProvinceState, key: RulerBonusKey): number {
        let best = 0;
        for (const gid of st.generals) {
            const g = this.generals.get(gid);
            if (!g || !g.def.bonus) {
                continue;
            }
            const v = g.def.bonus[key] || 0;
            if (v > best) {
                best = v;
            }
        }
        return best;
    }

    /**
     * 我方招降加成：己方阵营里带 persuade 的君主取最高，不叠加。
     *
     * 只算已经归我方、且不在营里的 —— 还在营里说明没降，谈不上替我招人。
     * AI 不经营俘虏，所以这条加成实际上只对玩家有意义，不做第二套 AI 判定。
     */
    public persuadeBonus(): number {
        let best = 0;
        this.generals.forEach((g) => {
            if (g.faction !== this.playerFaction || g.captiveOf !== '' || !g.def.bonus) {
                return;
            }
            const v = g.def.bonus.persuade || 0;
            if (v > best) {
                best = v;
            }
        });
        return best;
    }

    /** 被某势力关押的将领列表 */
    public prisonersOf(factionId: string): GeneralState[] {
        const out: GeneralState[] = [];
        this.generals.forEach((g) => {
            if (g.captiveOf === factionId) {
                out.push(g);
            }
        });
        return out;
    }

    /**
     * 招降成功率：(100 - 忠诚) / 100 + 我方君主招降加成，上限 100%。
     *
     * **在位君主恒为 0**：他还坐着江山，不会屈居人下。
     * 失去所有城池之后他不再是君主，按忠诚正常算 —— 这就是
     * 「君主失去所有土地以后可以招募」这条规则的落点，不另开一套判定。
     * UI 把这个百分比原样显示出来，除忠诚与公开的君主加成外没有隐藏修正。
     */
    public persuadeChance(g: GeneralState): number {
        if (this.isReigning(g)) {
            return 0;
        }
        const raw = (Balance.loyaltyMax - g.loyalty) / Balance.loyaltyMax
            + this.persuadeBonus();
        return Math.max(0, Math.min(1, raw));
    }

    /** 招降一名我方俘虏：成功改旗易帜并安置，失败忠诚上升 */
    public persuade(gid: string): { ok: boolean; chance: number; reason: string } {
        const g = this.generals.get(gid);
        if (!g || g.captiveOf !== this.playerFaction) {
            return { ok: false, chance: 0, reason: '此人不是我方俘虏' };
        }
        if (this.isReigning(g)) {
            return { ok: false, chance: 0, reason: '在位君主不可招降，先夺其城池' };
        }
        const chance = this.persuadeChance(g);
        if (random() >= chance) {
            g.loyalty = Math.min(Balance.loyaltyMax,
                g.loyalty + Balance.persuadeFailLoyaltyGain);
            this.pushLog(`招降 ${g.def.name} 失败，忠诚升至 ${g.loyalty}。`, 2);
            return {
                ok: false,
                chance,
                reason: `${g.def.name} 不肯归降，忠诚升至 ${g.loyalty}`,
            };
        }
        const home = this.assignGeneralTo(gid, this.playerFaction);
        if (!home) {
            return { ok: false, chance, reason: '我方已无城池可安置' };
        }
        // 招降成功就改旗易帜。君主也一样：faction 一改，RULER_OF 就对不上他，
        // isReigning 变 false，他从「君主」变成「带加成的客将」——
        // 这就是「亡国君主可以招募」的完整闭环，不需要额外的降级字段。
        const wasRuler = !!g.def.ruler;
        g.captiveOf = '';
        g.faction = this.playerFaction;
        g.loyalty = Balance.recruitLoyalty;
        this.stats.persuaded++;
        const who = wasRuler ? `旧主 ${g.def.name}` : g.def.name;
        this.pushLog(`${who} 归降，进驻 ${home.name}（忠诚 ${g.loyalty}）。`, 2);
        return { ok: true, chance, reason: `${who} 归降，进驻 ${home.name}` };
    }

    /** 放归一名我方俘虏：回原势力并降忠诚，为下次招降铺路 */
    public release(gid: string): { ok: boolean; reason: string; loyalty: number } {
        const g = this.generals.get(gid);
        if (!g || g.captiveOf !== this.playerFaction) {
            return { ok: false, reason: '此人不是我方俘虏', loyalty: 0 };
        }
        const home = this.homeCityFor(g);
        if (!home) {
            return {
                ok: false,
                reason: '天下已定，无处可放；可以直接招降',
                loyalty: g.loyalty,
            };
        }
        // 在位君主是主不是臣，「被旧主猜忌」对他不成立，放归不降忠诚。
        // 亡国君主已经不是君主了：回去也没江山可坐，按普通将领算，忠诚照降 ——
        // 这是「灭国 → 生擒 → 放归 → 再擒 → 招降」这条链能闭合的关键一步。
        const reigning = this.isReigning(g);
        if (!reigning) {
            g.loyalty = Math.max(Balance.loyaltyMin,
                g.loyalty - Balance.releaseLoyaltyDrop);
        }
        g.captiveOf = '';
        home.generals.push(gid);
        this.stats.released++;
        this.pushLog(`放归 ${g.def.name} → ${home.name}`
            + (reigning ? '（在位君主不降忠诚）。' : `，忠诚降至 ${g.loyalty}。`), 2);
        return {
            ok: true,
            reason: `${g.def.name} 已放归 ${home.name}，忠诚 ${g.loyalty}`,
            loyalty: g.loyalty,
        };
    }

    /** 放归去处：原势力人口最多的城；原势力已亡则流亡到中立 / 他势力城 */
    private homeCityFor(g: GeneralState): ProvinceState | null {
        const own = this.provincesOf(g.faction);
        if (own.length > 0) {
            return own.slice().sort((a, b) => b.pop - a.pop)[0];
        }
        // 亡国将领不能凭空消失：流亡到中立城（没有中立城就挑一座非我方城），
        // 玩家日后打下那座城还能再抓他一次，「放归→再俘→更易招降」的链条不断。
        // 中立城按现有驻将数升序挑最少的一座：别把所有流亡将都堆进同一座城，
        // 否则单城守将越堆越多，配合防御等级叠成谁都打不动的硬骨头。
        const all = Array.from(this.provinces.values());
        const neutral = all.filter((p) => p.owner === NEUTRAL);
        const pool = neutral.length > 0
            ? neutral.slice().sort((a, b) => a.generals.length - b.generals.length)
            : all.filter((p) => p.owner !== this.playerFaction)
                .sort((a, b) => a.generals.length - b.generals.length);
        return pool.length > 0 ? pool[0] : null;
    }

    /** 给刚归降的将领找一座我方城：驻将最少优先，其次人口最多 */
    private assignGeneralTo(gid: string, factionId: string): ProvinceState | null {
        const own = this.provincesOf(factionId);
        if (own.length === 0) {
            return null;
        }
        const home = own.slice().sort((a, b) =>
            a.generals.length - b.generals.length || b.pop - a.pop)[0];
        home.generals.push(gid);
        return home;
    }

    /**
     * 势力灭亡：该势力**所有**将领忠诚下降一次（在城的、在营的、流亡的都算）。
     *
     * 为什么要这一步：在位君主开局忠诚 100，招降成功率恒为 0。
     * 不降忠诚，「失去所有土地之后可以招降」这条规则写了也等于没写。
     * 国破则人心散 —— 君主掉到 70（成功率 30%），再放归一次掉到 45（55%），
     * 整条链条才真正走得通。
     *
     * 已经就地归顺的守将 faction 已改成攻方，不会被误伤；中立城不算亡国。
     */
    private onFactionFallen(factionId: string): void {
        const f = FACTION_MAP[factionId];
        let n = 0;
        this.generals.forEach((g) => {
            if (g.faction === factionId) {
                g.loyalty = Math.max(Balance.loyaltyMin,
                    g.loyalty - Balance.fallenLoyaltyDrop);
                n++;
            }
        });
        if (n > 0) {
            this.pushLog(`${f ? f.name : factionId} 亡国，麾下 ${n} 名将领忠诚下降 `
                + `${Balance.fallenLoyaltyDrop}。`, 1);
        }
    }

    /** 是否为相邻省份（依据真实地理接壤关系） */
    public isAdjacent(a: ProvinceState, b: ProvinceState): boolean {
        return a.borders.indexOf(b.id) >= 0;
    }

    /** 玩家可进攻的邻省（敌方所有） */
    public attackTargets(from: ProvinceState): ProvinceState[] {
        const out: ProvinceState[] = [];
        this.provinces.forEach((p) => {
            if (p.owner !== from.owner && this.isAdjacent(from, p)) {
                out.push(p);
            }
        });
        return out;
    }

    /** 玩家可移动到的邻省（己方所有） */
    public moveTargets(from: ProvinceState): ProvinceState[] {
        const out: ProvinceState[] = [];
        this.provinces.forEach((p) => {
            if (p.owner === from.owner && p.id !== from.id && this.isAdjacent(from, p)) {
                out.push(p);
            }
        });
        return out;
    }

    /**
     * 判断能否发动进攻，并给出**具体原因**
     *
     * 之前进攻失败是静默的（直接 return null），玩家看到的就是「点了没反应」。
     * 现在把所有失败条件都变成可读的原因，UI 可以直接展示给玩家。
     */
    public canAttack(from: ProvinceState, to: ProvinceState): { ok: boolean; reason: string } {
        if (from.id === to.id) {
            return { ok: false, reason: '不能进攻自己' };
        }
        if (from.owner === to.owner) {
            return { ok: false, reason: '同为友军，请用「调兵」' };
        }
        if (!this.isAdjacent(from, to)) {
            return { ok: false, reason: `${from.name}与${to.name}不接壤，无法进攻` };
        }
        if (from.troops <= 0) {
            return { ok: false, reason: `${from.name}没有可用兵力，请先征兵` };
        }
        if (from.attacked) {
            return { ok: false, reason: `${from.name} 本回合已出征，等募兵或调兵后再战` };
        }
        return { ok: true, reason: '可以进攻' };
    }

    /** 该城是否有任何可进攻的邻敌 */
    public hasAttackTargets(from: ProvinceState): boolean {
        return this.attackTargets(from).length > 0;
    }

    // ------------------------------------------------------------------
    // 行动
    // ------------------------------------------------------------------

    /** 征兵：在指定省份花费金币补充兵力，返回实际补充数量 */
    public recruit(st: ProvinceState, want: number): number {
        const gold = this.gold.get(st.owner) || 0;
        const cap = this.garrisonCap(st);
        // 征兵与调兵用同一条「临时集结」规则：可以超编到上限的 overCapFactor 倍。
        // 不允许超编时，双方都满编，单城对单城恒为 1:1，谁也打不动 —— 而金币
        // 已经堆到几十万却一个兵也征不出来，钱和兵同时失去意义。
        const room = Math.max(0, cap * Balance.overCapFactor - st.troops);
        // 金币与人口双重限制
        const byGold = Math.floor(gold / Balance.goldPerTroop);
        const byPop = Math.floor((st.pop - 1) / Balance.popPerTroop);
        let amount = Math.max(0, Math.floor(Math.min(want, room, byGold, byPop)));
        if (amount <= 0) {
            return 0;
        }

        // ⚠ 征兵要抽人口，而驻军上限又随人口下降。按「当前上限」征满时，
        // 扣完人口后新上限会掉到兵力之下，多出来的兵会被下面那句截断——
        // 等于玩家花了钱、死了人，兵却凭空消失（实测征 1550 只到手 935）。
        // 这里迭代收敛到「扣完人口后仍不超新上限」的量，几次就稳定。
        for (let i = 0; i < 4 && amount > 0; i++) {
            const popAfter = Math.max(1, st.pop - amount * Balance.popPerTroop);
            const overflow = st.troops + amount
                - this.capAt(st, popAfter) * Balance.overCapFactor;
            if (overflow <= 0) {
                break;
            }
            amount -= overflow;
        }
        if (amount <= 0) {
            return 0;
        }

        st.troops += amount;
        st.pop = Math.max(1, st.pop - amount * Balance.popPerTroop);
        this.gold.set(st.owner, gold - amount * Balance.goldPerTroop);
        // 兜底：理论上上面已经收敛，这里只防御浮点误差
        const newCap = this.garrisonCap(st) * Balance.overCapFactor;
        if (st.troops > newCap) {
            st.troops = newCap;
        }
        return amount;
    }

    /**
     * **执行**内政指令：每座城每回合只能执行一件（治理 / 屯田 / 筑城 / 征兵）
     *
     * ⚠ 这是底层原语，**玩家回合内不要调它**：玩家点按钮走 queueDomestic()，
     * 所有玩家城池的指令统一在 endTurn() → settleDomestic() 里执行一遍。
     * 它保持 public 是为了让 AI 阶段（aiGovern）与模拟测试能直接用。
     *
     * 这是玩家的核心取舍：治理是「投资未来」（提高以后每回合的钱粮兵），
     * 征兵 / 屯田 / 筑城是「解决当下」。四者共用 ProvinceState.acted，
     * 军事行动（进攻、调兵）不占用它，所以一回合仍可既内政又出兵。
     * 失败时不消耗行动点，也不扣资源。
     *
     * @param log 是否写战报；批量结算与 AI 治理传 false，避免刷屏
     */
    public executeDomestic(
        st: ProvinceState,
        order: DomesticOrder,
        log = true,
    ): DomesticResult {
        if (st.acted) {
            return { ok: false, reason: `${st.name} 本回合已下令内政，结束回合后再来`, amount: 0 };
        }
        const fid = st.owner;
        const gold = this.gold.get(fid) || 0;
        const food = this.food.get(fid) || 0;

        if (order === 'govern') {
            if (st.dev >= Balance.devMax) {
                return { ok: false, reason: `${st.name} 发展度已满`, amount: 0 };
            }
            if (gold < Balance.governGoldCost) {
                return { ok: false, reason: `金币不足，治理需 ${Balance.governGoldCost} 金`, amount: 0 };
            }
            this.gold.set(fid, gold - Balance.governGoldCost);
            const before = st.dev;
            st.dev = Math.min(Balance.devMax, st.dev + Balance.governDevGain);
            const gain = st.dev - before;
            if (log) {
                this.pushLog(`${st.name} 治理：发展度 +${gain}（${before}→${st.dev}），`
                    + `耗 ${Balance.governGoldCost} 金，此后月收更高。`,
                st.owner === this.playerFaction ? 1 : 0);
            }
            st.acted = true;
            return { ok: true, reason: `治理完成，发展度 +${gain}`, amount: gain };
        }

        if (order === 'farm') {
            // 和金币 / 粮草 / 月募兵共用同一个发展度倍率，没有第四套公式
            const gain = Math.round(st.pop * Balance.farmFoodPerPop * this.devFactor(st));
            this.food.set(fid, food + gain);
            if (log) {
                this.pushLog(`${st.name} 屯田：粮草 +${gain}（可供月募兵）。`,
                    st.owner === this.playerFaction ? 1 : 0);
            }
            st.acted = true;
            return { ok: true, reason: `屯田完成，粮草 +${gain}`, amount: gain };
        }

        if (order === 'fortify') {
            if (st.fort >= Balance.fortMax) {
                return { ok: false, reason: `${st.name} 工事已达上限`, amount: 0 };
            }
            if (gold < Balance.fortifyGoldCost || food < Balance.fortifyFoodCost) {
                return { ok: false, reason: `筑城需 ${Balance.fortifyGoldCost} 金 `
                    + `+ ${Balance.fortifyFoodCost} 粮，资源不足`, amount: 0 };
            }
            this.gold.set(fid, gold - Balance.fortifyGoldCost);
            this.food.set(fid, food - Balance.fortifyFoodCost);
            st.fort += Balance.fortifyFortGain;
            if (log) {
                this.pushLog(`${st.name} 筑城：工事升至 ${st.fort}，守城更强。`,
                    st.owner === this.playerFaction ? 1 : 0);
            }
            st.acted = true;
            return { ok: true, reason: `筑城完成，工事 ${st.fort}`, amount: Balance.fortifyFortGain };
        }

        if (order === 'recruit') {
            // 一次只补六成缺口、只动四分之一国库。
            // 旧版 want = 全部金币 / 单价：点一下国库清零，自动征兵时排序第一
            // 的城把钱全拿走，其余城全部提示「金币不足」。现在多座城能分到钱，
            // 也给治理 / 筑城留预算；想补满就下回合再征一次。
            const room = Math.max(0, this.garrisonCap(st) - st.troops);
            const byBudget = Math.floor((gold * Balance.recruitGoldShare) / Balance.goldPerTroop);
            const want = Math.min(
                Math.floor(room * Balance.recruitFillRatio), byBudget, Balance.recruitMax,
            );
            if (want <= 0) {
                return { ok: false, reason: `${st.name} 金币不足或已接近满员，无法征兵`, amount: 0 };
            }
            const got = this.recruit(st, want);
            if (got <= 0) {
                return { ok: false, reason: `${st.name} 无法征兵（人口不足或已满员）`, amount: 0 };
            }
            if (log) {
                this.pushLog(`${st.name} 征兵 ${got}。`,
                    st.owner === this.playerFaction ? 1 : 0);
            }
            st.acted = true;
            return { ok: true, reason: `征兵 ${got}`, amount: got };
        }

        return { ok: false, reason: '未知内政指令', amount: 0 };
    }

    /**
     * 内政统一结算：**全游戏唯一执行玩家内政的地方**，只在 endTurn() 里跑一次
     *
     * 规则收敛成一条：每座城先算出一个唯一指令（effectiveOrder），再执行一次。
     *   - 玩家回合内登记的城 → 执行登记的那道（玩家明确点过的，先花钱）；
     *   - 其余城若开了「自动」→ 执行 `lastOrder`，按指令类型排序决定谁先花；
     *   - 其余城若关了「自动」→ 什么都不做。
     *
     * 因为「选指令」和「执行指令」彻底分开，不再有「回合内立刻执行一次、
     * 结束回合自动又补一轮」的两个时点，一回合绝不会出现筑两次城。
     * 失败（钱粮不够 / 满级）也不会再让同一座城被自动方针重试第二道。
     *
     * **不替玩家判断「这城需不需要」**：早先粮草高于 600 时整轮自动屯田
     * 直接跳过、自动筑城只给前线城，玩家明明选了方针却看不见任何动静。
     * 资源不够由 executeDomestic 自己跳过；「钱先花在哪」交给排序。
     *
     * @returns { executed, auto } 实际执行的城数 / 其中由自动方针补齐的城数
     */
    private settleDomestic(): { executed: number; auto: number } {
        const manual: Array<{ st: ProvinceState; order: DomesticOrder }> = [];
        const automatic: ProvinceState[] = [];
        for (const p of this.provincesOf(this.playerFaction)) {
            if (p.pendingDomestic !== 'none') {
                manual.push({ st: p, order: p.pendingDomestic });
            } else if (this.autoDomestic) {
                automatic.push(p);
            }
        }

        let executed = 0;
        // 手动登记的先执行：这是玩家逐城点出来的，优先拿到共享钱粮。
        // 顺序按 provincesOf() 的稳定次序，不再叠一层跨指令的排序规则。
        for (const job of manual) {
            // log=false：一次可能动好几座城，逐条写会刷满只有 4 行的战报，
            // 汇总由 endTurn() 统一写一条。
            if (this.executeDomestic(job.st, job.order, false).ok) {
                executed++;
            }
        }
        let auto = 0;
        for (const p of this.sortForOrder(automatic, this.lastOrder)) {
            if (this.executeDomestic(p, this.lastOrder, false).ok) {
                auto++;
                executed++;
            }
        }

        // 登记只在本回合有效：成功、失败、没轮到，都清掉，不让选择漏到下回合。
        this.provinces.forEach((p) => {
            p.pendingDomestic = 'none';
        });
        return { executed, auto };
    }

    /** 某城是否与「非我方」城池接壤（前线判定） */
    private hasEnemyNeighbor(st: ProvinceState): boolean {
        for (const id of st.borders) {
            const q = this.provinces.get(id);
            if (q && q.owner !== st.owner) {
                return true;
            }
        }
        return false;
    }

    /**
     * 按指令类型决定「先给哪座城下令」
     *
     * 四道指令的取舍逻辑各不相同，统一按「最缺的那座优先」：
     *   - 治理：发展度最低的先补（避免富城越富、穷城永远起不来）
     *   - 屯田：发展度最高的先（同样的行动点产出更多粮）
     *   - 筑城：前线城优先，其次工事最低的先 —— **后方城只是排在后面，
     *     不再被直接剔除**（选了方针却有几座城没反应，是很难理解的）
     *   - 征兵：兵力缺口比例最大的先（前线先补，后方空着也不急）
     */
    private sortForOrder(list: ProvinceState[], order: DomesticOrder): ProvinceState[] {
        const copy = list.slice();
        if (order === 'govern') {
            copy.sort((a, b) => a.dev - b.dev);
        } else if (order === 'farm') {
            copy.sort((a, b) => b.dev - a.dev);
        } else if (order === 'fortify') {
            copy.sort((a, b) => {
                const front = Number(this.hasEnemyNeighbor(b)) - Number(this.hasEnemyNeighbor(a));
                return front !== 0 ? front : a.fort - b.fort;
            });
        } else {
            const gap = (p: ProvinceState): number => {
                const cap = Math.max(1, this.garrisonCap(p));
                return (cap - p.troops) / cap;
            };
            copy.sort((a, b) => gap(b) - gap(a));
        }
        return copy;
    }

    /**
     * 在本方相邻省份之间调兵
     *
     * @param moveGenerals 是否按调兵比例带走将领。玩家手动调兵要带（兵走了
     *        将不能留守空城）；自动补给传 false —— 将领调动是玩家的决策，
     *        补给线不该替玩家把守将也搬走。
     */
    public moveTroops(
        from: ProvinceState,
        to: ProvinceState,
        troops: number,
        moveGenerals = true,
    ): boolean {
        if (from.owner !== to.owner || !this.isAdjacent(from, to) || troops <= 0) {
            return false;
        }
        // 调兵可以「临时集结」：允许超过驻军上限，最多到上限的 overCapFactor 倍。
        // 上限是硬顶时，总兵力再多也凑不出单点优势（兵按人口摊在每座城里），
        // 地图上只要有一个瓶颈城，最后一座城就永远打不下来。
        const room = Math.max(0, this.garrisonCap(to) * Balance.overCapFactor - to.troops);
        const amount = Math.min(troops, from.troops, room);
        if (amount <= 0) {
            return false;
        }
        const before = from.troops;
        from.troops -= amount;
        to.troops += amount;
        if (moveGenerals) {
            // 将领按「调走的兵力比例」随军。旧规则固定抽一半将领：
            // 倾巢出动时兵全走了、将却留守空城，玩家会觉得被坑。
            const moveCount = Math.floor(from.generals.length * (amount / Math.max(1, before)));
            for (let i = 0; i < moveCount; i++) {
                const gid = from.generals.shift();
                if (gid) {
                    to.generals.push(gid);
                }
            }
        }
        return true;
    }

    /**
     * 后方补给：把腹地的余兵自动送往一线，返回本回合搬动的兵力
     *
     * 每座「完全不接壤非我方城池」的城算后方：保留 rearGarrisonRatio 的守备兵，
     * 其余送给「更靠近前线」的邻城；最多传 redeployPasses 跳，腹地的兵能一路
     * 流到边境。前线城不往外送 —— 它自己就是战场。
     *
     * 这条规则解决的是「兵够却打不出去」：驻军上限由人口决定，兵只能待在
     * 各自城里，城一多兵就散；手动调兵每次只能调一半，三跳之后只剩 12%。
     * 现在兵会自己往需要的地方走，玩家不必当搬运工。
     *
     * 玩家与 AI 同规则，不做隐藏的不对称（AI 的兵也会集中，攻城更难）。
     */
    private autoRedeploy(): number {
        let moved = 0;
        for (let pass = 0; pass < Balance.redeployPasses; pass++) {
            let movedThisPass = 0;
            this.provinces.forEach((p) => {
                // 前线城不外送：它自己就是战场，把兵送走等于自毁防线
                if (this.attackTargets(p).length > 0) {
                    return;
                }
                const keep = Math.round(this.garrisonCap(p) * Balance.rearGarrisonRatio);
                const spare = p.troops - keep;
                if (spare <= 0) {
                    return;
                }
                // 挑一个「更靠前」的邻城：直接接壤敌军最好，其次是邻城里有接壤敌军的
                let best: ProvinceState | null = null;
                let bestScore = 0;
                for (const id of p.borders) {
                    const q = this.provinces.get(id);
                    if (!q || q.owner !== p.owner) {
                        continue;
                    }
                    const score = this.attackTargets(q).length > 0
                        ? 2
                        : (this.hasEnemyNeighbor(q) ? 1 : 0);
                    if (score > bestScore) {
                        bestScore = score;
                        best = q;
                    }
                }
                // 邻城都不比它靠前：原地不动，避免后方城之间来回搬兵
                if (!best || bestScore === 0) {
                    return;
                }
                // 自动补给只填到上限，**不超编**：超编是要付流失代价的
                // 临时集结，这个取舍必须由玩家自己决定，不能替他做主。
                const room = Math.max(0, this.garrisonCap(best) - best.troops);
                const send = Math.min(spare, room);
                if (send <= 0) {
                    return;
                }
                const before = best.troops;
                if (this.moveTroops(p, best, send, false)) {
                    movedThisPass += best.troops - before;
                }
            });
            moved += movedThisPass;
            if (movedThisPass === 0) {
                break;
            }
        }
        return moved;
    }

    /**
    /** 组装一场战斗双方的战力参数（实战结算与战前预估共用同一套口径） */
    private buildCombatSides(from: ProvinceState, to: ProvinceState)
        : { atkSide: CombatSide; defSide: CombatSide } {
        const atkSide: CombatSide = {
            troops: from.troops,
            atk: this.sumGeneralRating(from, 'atk'),
            def: this.sumGeneralRating(from, 'def'),
            cap: this.garrisonCap(from),
            // 进攻方的君主加成只算 atk：孙策、吕布这类「亲冒矢石」的君主
            mul: 1 + this.rulerBonusAt(from, 'atk'),
        };
        const defSide: CombatSide = {
            troops: to.troops,
            atk: this.sumGeneralRating(to, 'atk'),
            def: this.sumGeneralRating(to, 'def'),
            cap: this.garrisonCap(to),
            // 防守方的君主加成只算 def：公孙度这类「据险自守」的君主
            mul: 1 + this.rulerBonusAt(to, 'def'),
        };
        return { atkSide, defSide };
    }

    /**
     * 战力比 → 胜率，**全游戏唯一入口**
     *
     * 玩家面板的「胜算」与 AI 的出兵决策必须走同一条曲线：以前面板算的是
     * 「兵力 × 将领 × 工事」的胜率，AI 却拿裸兵力比 1.15 硬判，两边看到的
     * 根本不是同一场仗 —— AI 会在玩家看着「慎攻」时反复来撞，也会在名将
     * 在手、明明能打时一动不动。
     */
    public winRateOf(ratio: number): number {
        // 守城本就有优势：战力比 1.15 才算五五开
        const x = Math.max(0.001, ratio / Balance.aiAttackRatio);
        const k = 1.5;
        const v = Math.pow(x, k);
        return v / (v + 1);
    }

    /**
     * 战前胜算预估（纯计算，不掷随机、不改任何状态）
     *
     * 面板在玩家点「进攻」之前给出一个档位提示：兵力、守将、工事、君主加成
     * 都算进两边战力，按战力比用 logistic 近似出一个 0~1 的胜率。它只是
     * 决策参考，真实战斗仍有 randomSpread 浮动，不保证结果。
     */
    public previewAttack(from: ProvinceState, to: ProvinceState): {
        ratio: number;
        winRate: number;
        label: string;
    } {
        const { atkSide, defSide } = this.buildCombatSides(from, to);
        const atkMul = (1 + atkSide.atk * Balance.atkPerRating) * (atkSide.mul || 1);
        const defMul = (1 + defSide.def * Balance.defPerRating) * (defSide.mul || 1)
            * (1 + to.fort * Balance.fortPerPoint);
        const atkPower = Math.max(1, atkSide.troops) * atkMul;
        const defPower = Math.max(1, defSide.troops) * defMul;
        const ratio = atkPower / defPower;
        const winRate = this.winRateOf(ratio);
        let label: string;
        if (winRate >= 0.7) {
            label = '胜算高';
        } else if (winRate >= 0.5) {
            label = '胜算偏优';
        } else if (winRate >= 0.3) {
            label = '胜算偏险';
        } else {
            label = '慎攻';
        }
        return { ratio, winRate, label };
    }

    /**
     * 对相邻敌省发起进攻
     */
    public attack(from: ProvinceState, to: ProvinceState): {
        result: ReturnType<typeof resolveBattle>;
        captured: boolean;
        loot: number;
    } | null {
        if (from.owner !== to.owner && this.isAdjacent(from, to)
            && from.troops > 0 && !from.attacked) {
            // 出征标记：一座城一回合只能打一次（见 ProvinceState.attacked）
            from.attacked = true;
            const { atkSide, defSide } = this.buildCombatSides(from, to);
            const result = resolveBattle({
                atkSide,
                defSide,
                fort: to.fort,
                title: `${from.name} 攻 ${to.name}`,
            });

            from.troops = result.attackerLeft;
            const defenderBefore = to.troops;
            to.troops = result.defenderLeft;

            let captured = false;
            let loot = 0;
            if (result.attackerWin) {
                captured = true;
                loot = Math.round(result.defenderLoss * Balance.lootPerLoss);
                const prevOwner = to.owner;
                // 战绩统计：只记玩家这一方的事实，AI 互殴不计入。
                // 放在改 owner 之前取 prevOwner，AI 夺走玩家城才算一次「丢城」。
                if (from.owner === this.playerFaction) {
                    this.stats.captures++;
                }
                if (prevOwner === this.playerFaction) {
                    this.stats.losses++;
                }
                this.gold.set(from.owner, (this.gold.get(from.owner) || 0) + loot);
                to.owner = from.owner;
                // 新占领的城本回合不能再出征：部队刚打完一仗要整编。
                // 不设这一条，打下 A 就能立刻从 A 打 B，一回合连锁推七八座城，
                // 攻城折损与补兵的节奏全被跳过（实测 11 回合统一天下）。
                to.attacked = true;
                to.pop = Math.max(1, to.pop * (1 - Balance.capturePopLoss));
                // 兵燹之后百业凋敝：发展度受损，新城要靠「治理」重新养起来。
                // 这也让「打下一座富城」不等于立刻拿到满额产出。
                to.dev = Math.max(Balance.devMin,
                    Math.round(to.dev * (1 - Balance.captureDevLoss)));

                // ---- 驻军分配 ----
                // 占领后必须留兵驻守，否则新城毫无防御，下一回合就会被夺回。
                // 规则：进攻方把存活兵力的一部分留在新城，其余撤回出发地。
                const survivors = result.attackerLeft;
                const garrison = Math.round(survivors * Balance.captureGarrisonRatio);
                to.troops = Math.min(garrison, this.garrisonCap(to));
                from.troops = Math.max(0, survivors - to.troops);

                // 守将三条去路，一个将领只会走其中一条：
                //   1) 被生擒 → captiveOf = 攻方，进俘虏营（不在任何城的 generals 里）；
                //   2) 突围   → 撤回原势力最近的己方据点；
                //   3) 原势力已亡且突围成功 → 就地归顺，明确改掉 faction。
                // 只有玩家会经营俘虏：AI 没有招降界面，把将领关在看不见的
                // 地方只会让 48 人从地图上凭空消失。这条不对称写进 README。
                const defenders = to.generals.splice(0, to.generals.length);
                const retreatTo = this.findRetreatProvince(to, prevOwner);
                const captor = from.owner;
                const mayCapture = captor === this.playerFaction;
                for (const gid of defenders) {
                    const g = this.generals.get(gid);
                    if (mayCapture && random() < Balance.captureGeneralChance) {
                        if (g) {
                            g.captiveOf = captor;
                        }
                        this.pushLog(`生擒 ${g ? g.def.name : gid}，押入俘虏营。`, 2);
                    } else if (retreatTo) {
                        retreatTo.generals.push(gid);
                    } else {
                        to.generals.push(gid);
                        if (g) {
                            g.faction = captor;
                        }
                    }
                }

                // 亡国判定：最后一城丢了，这个势力就没了。
                // 必须放在守将处理**之后**：循环里就地归顺的人 faction 已经改成
                // 攻方，不该再被算作「亡国之臣」；被生擒的守将 faction 还没改，
                // 正好该跟着一起降 —— 君主就是在这里从 100 掉到 70 的。
                if (prevOwner !== NEUTRAL && this.provincesOf(prevOwner).length === 0) {
                    this.onFactionFallen(prevOwner);
                }

                // 进攻方最多留下 3 名武将镇守新城
                const keep = Math.min(3, from.generals.length);
                for (let i = 0; i < keep; i++) {
                    const gid = from.generals.shift();
                    if (gid) {
                        to.generals.push(gid);
                    }
                }
                to.captured = true;
                // 只要有一方是玩家，就是玩家必须看见的要闻；AI 之间互殴只作背景。
                const importance = from.owner === this.playerFaction
                    || prevOwner === this.playerFaction ? 2 : 0;
                this.pushLog(`${from.name} 攻占 ${to.name}（原属 ${prevOwner}），`
                    + `驻军 ${to.troops}，掠夺金币 ${loot}，发展度降至 ${to.dev}。`,
                importance);
                this.growGeneralExp(from, true, defenderBefore);
            } else {
                this.pushLog(`${from.name} 进攻 ${to.name} 失利。`,
                    from.owner === this.playerFaction || to.owner === this.playerFaction ? 2 : 0);
                this.growGeneralExp(from, false, defenderBefore);
            }
            // 每次战斗都刷一次最大版图：最后一击统一天下时，结算页要能
            // 立刻读到满版图，而不是等下一次 endTurn()。
            const mineNow = this.provincesOf(this.playerFaction).length;
            if (mineNow > this.stats.maxCities) {
                this.stats.maxCities = mineNow;
            }
            return { result, captured, loot };
        }
        return null;
    }

    /** 为撤退的守将找一个原势力最近的己方据点（不含刚被攻陷的城） */
    private findRetreatProvince(lost: ProvinceState, factionId: string): ProvinceState | null {
        let best: ProvinceState | null = null;
        let bestDist = Infinity;
        this.provinces.forEach((p) => {
            if (p.owner === factionId && p.id !== lost.id) {
                const a = Geo.project(p.lat, p.lon);
                const b = Geo.project(lost.lat, lost.lon);
                const d = Geo.distance(a.x, a.y, b.x, b.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
        });
        return best;
    }

    /** 战斗后给参战武将加经验 */
    private growGeneralExp(st: ProvinceState, win: boolean, enemyTroops: number): void {
        const gain = (win ? Balance.winExp : Balance.loseExp) + Math.round(enemyTroops / 200);
        for (const gid of st.generals) {
            const g = this.generals.get(gid);
            if (!g) {
                continue;
            }
            g.exp += gain;
            const need = Balance.levelExpBase * g.level;
            while (g.exp >= need && g.level < 10) {
                g.exp -= need;
                g.level++;
                this.pushLog(`武将 ${g.def.name} 晋升至 ${g.level} 级。`, 1);
            }
        }
    }

    /**
     * 追加战报。
     * @param priority 2 = 要闻（钉在战报窗口顶部），1 = 玩家内政 / 结算，0 = 其余
     */
    public pushLog(msg: string, priority = 0): void {
        this.logs.push(msg);
        this.logPriority.push(priority);
        if (this.logs.length > 200) {
            this.logs.shift();
            this.logPriority.shift();
        }
    }

    /**
     * 取战报窗口要显示的内容：**要闻置顶，普通日志补位**。
     *
     * 要闻按时间正序排在最前，所以即使文字换行超出面板，
     * 先被截掉的也只会是末尾的普通日志，不会是玩家最该看见的那几条。
     * 同一条日志不会被取两次；logs 为空时返回空数组。
     */
    public recentLogs(highlightCount = 3, total = 5): Array<{
        text: string; important: boolean;
    }> {
        const hi: Array<{ text: string; important: boolean }> = [];
        const ordinary: Array<{ text: string; important: boolean }> = [];
        const used = new Set<number>();
        for (let i = this.logs.length - 1; i >= 0 && hi.length < highlightCount; i--) {
            if (this.logPriority[i] >= 2) {
                hi.push({ text: this.logs[i], important: true });
                used.add(i);
            }
        }
        hi.reverse();
        for (let i = this.logs.length - 1; i >= 0 && hi.length + ordinary.length < total; i--) {
            if (used.has(i)) {
                continue;
            }
            ordinary.push({ text: this.logs[i], important: false });
            used.add(i);
        }
        ordinary.reverse();
        return hi.concat(ordinary);
    }

    /**
     * 记一条敌情预警。只对**当前属于玩家**的城池生效；同一座城被多个势力
     * 图谋时最多并两段，避免面板里塞进一长串读不完的名单。
     */
    private markThreat(target: ProvinceState, text: string): void {
        if (target.owner !== this.playerFaction) {
            return;
        }
        const prev = this.threats.get(target.id);
        if (!prev) {
            this.threats.set(target.id, text);
        } else if (prev.split('；').length < 2) {
            this.threats.set(target.id, `${prev}；${text}`);
        }
    }

    /**
     * 仍然成立的敌情预警：AI 集结后如果当回合就把城打下来了，这条意图
     * 已经过期，不该再让玩家「回防」一座已经不属于自己的城。
     */
    public liveThreats(): Array<{ id: string; city: string; text: string }> {
        const out: Array<{ id: string; city: string; text: string }> = [];
        this.threats.forEach((text, id) => {
            const p = this.provinces.get(id);
            if (p && p.owner === this.playerFaction) {
                out.push({ id, city: p.name, text });
            }
        });
        return out;
    }

    // ------------------------------------------------------------------
    // 回合
    // ------------------------------------------------------------------

    /** 结束玩家回合，进入结算与 AI */
    public endTurn(): TurnReport {
        this.playerTurnEnded = true;

        // 顺序是一条因果链，别再打乱：
        //  1) 内政统一结算 —— 回合内只是「选」，这里一次性执行；
        //  2) 经济结算 —— 治理立刻兑现成月收，月募兵也在出兵前到账；
        //  3) AI 行动 —— 用的是结算后的兵力，玩家与 AI 对称。
        // 旧顺序是「内政 → AI 攻城 → 结算」：治理花的是上月末的余额，
        // 城被 AI 夺走后钱白花，战报里的月收还变成 AI 打完后的预测值。
        const dom = this.settleDomestic();
        const parts: string[] = [];
        if (dom.executed - dom.auto > 0) {
            parts.push(`手动 ${dom.executed - dom.auto} 城`);
        }
        if (dom.auto > 0) {
            parts.push(`自动${POLICY_NAME[this.lastOrder]} ${dom.auto} 城`);
        }
        if (parts.length > 0) {
            this.pushLog(`内政结算：${parts.join('、')}。`, 1);
        }
        const econ = this.runEconomy();
        // 补给线排在 AI 行动之前：双方都用「补给后」的兵力打仗，保持对称。
        const redeployed = this.autoRedeploy();
        const report = this.runAiPhase();
        // 报告统一填「本月实收」，不混进 AI 行动后的下月预测
        report.goldIncome = econ.goldIncome;
        report.foodIncome = econ.foodIncome;
        report.reinforced = econ.reinforced;
        report.redeployed = redeployed;
        report.autoOrders = dom.auto;
        report.domesticOrders = dom.executed;
        this.advanceDate();
        this.turn++;
        // AI 阶段可能夺城，回合末再刷一次最大版图（读档后也不会倒退）
        const mineEnd = this.provincesOf(this.playerFaction).length;
        if (mineEnd > this.stats.maxCities) {
            this.stats.maxCities = mineEnd;
        }
        this.playerTurnEnded = false;
        // 重置每省行动标记（acted = 内政已执行，下一回合可以再选一次）
        // pendingDomestic 已在 settleDomestic() 里清空，这里不用再管。
        this.provinces.forEach((p) => {
            p.acted = false;
            p.attacked = false;
            p.captured = false;
        });

        // 状态全部结算完毕后再发信号：订阅者此刻读到的 owner / 兵力 / 年月 /
        // 回合号都已是最新值，重绘出来的版图颜色才不会是上一回合的。
        // 放在 return 前而不是 runAiPhase 里，是为了把经济与日期也包进来。
        if (this.onTurnEnd) {
            this.onTurnEnd(report);
        }
        return report;
    }

    /** AI 阶段：各势力按简单评分决策 */
    private runAiPhase(): TurnReport {
        // 敌情预警只保留「上一次 AI 阶段」的意图：玩家整个回合都能看见它，
        // 到下一次结算再刷新。放在这里清而不是 endTurn() 开头，是为了让
        // UI 在玩家回合里读到的是上一轮集结、而不是空的。
        this.threats.clear();

        // 先记下玩家回合开始时拥有的城。AI 会直接改写 ProvinceState.owner，
        // 不留快照的话事后就分不清「这回合丢了哪几座城」。
        const mineBefore: string[] = [];
        for (const p of this.provincesOf(this.playerFaction)) {
            mineBefore.push(p.id);
        }

        const factionIds: string[] = [];
        this.provinces.forEach((p) => {
            if (p.owner !== this.playerFaction && factionIds.indexOf(p.owner) < 0) {
                factionIds.push(p.owner);
            }
        });
        for (const fid of factionIds) {
            if (fid === NEUTRAL) {
                continue;
            }
            // AI 也会经营：先治理再出兵，长期下来富庶大城越来越难打
            this.aiGovern(fid);
            this.aiFactionAct(fid);
        }

        const mineAfter: Record<string, boolean> = {};
        for (const p of this.provincesOf(this.playerFaction)) {
            mineAfter[p.id] = true;
        }

        const report: TurnReport = {
            // 经济字段由 endTurn() 用「本月实收」覆盖，这里不填预测值
            goldIncome: 0,
            foodIncome: 0,
            reinforced: 0,
            autoOrders: 0,
            domesticOrders: 0,
            redeployed: 0,
            popTotal: this.totalPop(this.playerFaction),
            provinceCount: this.provincesOf(this.playerFaction).length,
            lostCities: mineBefore.filter((id) => !mineAfter[id]),
        };
        return report;
    }

    /**
     * AI 内政：每回合挑发展度最低的一座城治理一次
     *
     * 只在钱有余裕时做，避免 AI 把金币全花在治理上而完全不扩张。
     * log=false 是为了不把十几个势力的治理日志刷进玩家战报。
     * AI 阶段执行后 endTurn() 会统一重置 acted，下一回合仍可再治理一次。
     */
    private aiGovern(fid: string): void {
        if ((this.gold.get(fid) || 0) < Balance.governGoldCost * 2) {
            return;
        }
        const candidates = this.provincesOf(fid)
            .filter((p) => p.dev < Balance.aiGovernDevThreshold)
            .sort((a, b) => a.dev - b.dev);
        const count = Math.min(Balance.aiGovernMax, candidates.length);
        for (let i = 0; i < count; i++) {
            this.executeDomestic(candidates[i], 'govern', false);
        }
    }

    // ------------------------------------------------------------------
    // AI：侦察 → 选主攻方向 → 集结 → 调将 → 征兵 → 多路协同进攻
    //
    // 旧 AI 只有一条规则「单城裸兵力比 > 1.15 就打」，后果是：
    //   * 不看将领等级 / 君主加成 / 工事，手下名将再多也不进决策；
    //   * 金币、粮草一分不花，国力纯摆设（探针里国库 1.6 万金躺到亡国）；
    //   * 不会集结，兵按人口摊在几十座城，遇到玩家超编城 ratio 掉到 0.8
    //     就整局零出兵 —— 「明明国力那么强却打不动」就是这么来的。
    // 现在 AI 与玩家用同一套战力口径，并会主动把国力压到一个点上。
    // ------------------------------------------------------------------

    /**
     * 「from 以给定兵力打 to」的战力比（纯试算，不改状态）
     *
     * 与 buildCombatSides / previewAttack 完全同一套参数：将领等级、君主加成、
     * 守军工事都进倍率，只有兵力换成试算值。AI 靠它回答「还差多少兵才够」。
     */
    private aiPowerRatio(from: ProvinceState, to: ProvinceState, troops: number): number {
        const { atkSide, defSide } = this.buildCombatSides(from, to);
        const aMul = (1 + atkSide.atk * Balance.atkPerRating) * (atkSide.mul || 1);
        const dMul = (1 + defSide.def * Balance.defPerRating) * (defSide.mul || 1)
            * (1 + to.fort * Balance.fortPerPoint);
        return Math.max(1, troops) * aMul / Math.max(1, defSide.troops * dMul);
    }

    /**
     * 沿路网把境内余兵接力拉向主攻城，返回实际搬动的兵力
     *
     * 每座城保留 rearGarrisonRatio 的守备兵，只送「余兵」；兵只往离主攻城
     * 更近一步的己方邻城走，远处的兵靠多 pass 一跳一跳传上来。允许超编
     * （与玩家调兵同一条规则），但只在「还差多少兵」的缺口内搬，不无脑堆。
     */
    private aiConcentrate(fid: string, main: ProvinceState, need: number): number {
        // BFS 出各城到主攻城的跳数
        const dist = new Map<string, number>();
        dist.set(main.id, 0);
        const queue: ProvinceState[] = [main];
        for (let i = 0; i < queue.length; i++) {
            const cur = queue[i];
            for (const id of cur.borders) {
                const q = this.provinces.get(id);
                if (!q || q.owner !== fid || dist.has(q.id)) {
                    continue;
                }
                dist.set(q.id, (dist.get(cur.id) || 0) + 1);
                queue.push(q);
            }
        }

        let moved = 0;
        for (let pass = 0; pass < Balance.redeployPasses && main.troops < need; pass++) {
            let movedThisPass = 0;
            // 远的先走，兵才能在同一回合接力到前线
            const donors = this.provincesOf(fid)
                .filter((p) => p.id !== main.id && dist.has(p.id))
                .sort((a, b) => (dist.get(b.id) || 0) - (dist.get(a.id) || 0));
            for (const from of donors) {
                const d = dist.get(from.id) || 0;
                const keep = Math.round(this.garrisonCap(from) * Balance.rearGarrisonRatio);
                const spare = from.troops - keep;
                if (spare <= 0) {
                    continue;
                }
                let next: ProvinceState | null = null;
                let nextD = d;
                for (const id of from.borders) {
                    const q = this.provinces.get(id);
                    if (!q || q.owner !== fid) {
                        continue;
                    }
                    const qd = dist.has(q.id) ? (dist.get(q.id) || 0) : 999;
                    if (qd < nextD) {
                        nextD = qd;
                        next = q;
                    }
                }
                if (!next) {
                    continue;
                }
                let send = spare;
                if (next.id === main.id) {
                    send = Math.min(send, Math.max(0, need - main.troops));
                }
                if (send <= 0) {
                    continue;
                }
                const before = next.troops;
                // 不带将：将领调度由 aiAssignGenerals 单独按战力挑，
                // 按比例随军会把名将留在后方、杂将送上前线。
                this.moveTroops(from, next, send, false);
                const delta = next.troops - before;
                if (delta > 0) {
                    movedThisPass += delta;
                }
            }
            moved += movedThisPass;
            if (movedThisPass === 0) {
                break;
            }
        }
        return Math.round(moved);
    }

    /**
     * 把后方闲置名将调到主攻城，补到 generalsPerCity 参战上限
     *
     * 这是「手下将领那么多」真正变成战力的一步：以前 AI 的将领散在后方
     * 从不参与决策，攻防等级白白浪费。每座后方城留一名守将，其余按攻击
     * 等级择优随军。将领守恒不变（只是换城），不生成也不消失。
     */
    private aiAssignGenerals(fid: string, main: ProvinceState): number {
        let room = Math.max(0, Balance.generalsPerCity - main.generals.length);
        if (room <= 0) {
            return 0;
        }
        const pool: Array<{ gid: string; from: ProvinceState; atk: number }> = [];
        for (const p of this.provincesOf(fid)) {
            if (p.id === main.id) {
                continue;
            }
            for (const gid of p.generals.slice(1)) {
                const g = this.generals.get(gid);
                if (g) {
                    pool.push({ gid, from: p, atk: g.def.atk + (g.level - 1) * 0.5 });
                }
            }
        }
        pool.sort((a, b) => b.atk - a.atk);
        let moved = 0;
        for (const item of pool) {
            if (room <= 0) {
                break;
            }
            const i = item.from.generals.indexOf(item.gid);
            if (i < 0) {
                continue;
            }
            item.from.generals.splice(i, 1);
            main.generals.push(item.gid);
            room--;
            moved++;
        }
        return moved;
    }

    /**
     * 集结仍不够时动用国库急征：每势力每回合有预算上限，不是无限爆兵
     *
     * 兵源不只有主攻城：它常被集结顶到超编上限，recruit 会一间也征不到，
     * 于是国库越堆越高、钱完全花不出去（探针里后期躺着 2 万金）。同一
     * 方向的其余相邻城正是协同第二路，补给它们既让钱有出口，也让夹击有兵。
     */
    private aiSpendTreasury(
        fid: string, main: ProvinceState, target: ProvinceState, need: number,
    ): number {
        let budget = Math.min(this.gold.get(fid) || 0, Balance.aiRecruitBudget);
        if (budget < Balance.goldPerTroop) {
            return 0;
        }
        const sources: ProvinceState[] = [main];
        for (const p of this.provincesOf(fid)) {
            if (p.id !== main.id && this.isAdjacent(p, target)) {
                sources.push(p);
            }
        }
        let total = 0;
        for (const p of sources) {
            if (budget < Balance.goldPerTroop) {
                break;
            }
            const gap = Math.max(0, need - p.troops);
            const want = Math.min(
                Math.floor(budget / Balance.goldPerTroop),
                Math.ceil(gap),
                Balance.recruitMax,
            );
            if (want <= 0) {
                continue;
            }
            // 直接调底层 recruit：内政的 executeDomestic('recruit') 不允许超编，
            // 而「临时集结」正是 AI 突破满编城要用的同一条玩家规则。
            const got = this.recruit(p, want);
            total += got;
            budget -= got * Balance.goldPerTroop;
        }
        return total;
    }

    /** 单个 AI 势力的行动 */
    private aiFactionAct(fid: string): void {
        const mine = this.provincesOf(fid);
        if (mine.length === 0) {
            return;
        }

        // 1) 侦察：每个可攻的敌城算一个「主攻方向」
        const targets: Array<{ to: ProvinceState; value: number }> = [];
        const seen = new Set<string>();
        for (const st of mine) {
            for (const t of this.attackTargets(st)) {
                if (seen.has(t.id)) {
                    continue;
                }
                seen.add(t.id);
                targets.push({
                    to: t,
                    // 大城更值钱；玩家城有额外权重，AI 不会只顾着互殴软柿子
                    value: (t.def.city ? 1.25 : 1.0)
                        * (t.owner === this.playerFaction ? Balance.aiPlayerTargetBias : 1.0),
                });
            }
        }
        if (targets.length === 0) {
            return;
        }

        // 2) 每个方向先找当前最强的相邻己方城，按「胜算 × 价值」排序
        const fronts: Array<{
            to: ProvinceState; main: ProvinceState; ratio: number; score: number;
        }> = [];
        for (const t of targets) {
            let main: ProvinceState | null = null;
            let best = 0;
            for (const p of mine) {
                if (p.owner !== fid || p.attacked || !this.isAdjacent(p, t.to)) {
                    continue;
                }
                const r = this.aiPowerRatio(p, t.to, p.troops);
                if (r > best) {
                    best = r;
                    main = p;
                }
            }
            if (main) {
                fronts.push({ to: t.to, main, ratio: best,
                    score: this.winRateOf(best) * t.value });
            }
        }
        fronts.sort((a, b) => b.score - a.score);

        // 3) 主攻方向：**只有它**能动用全国资源（集结 / 调将 / 国库）。
        //    不这么分层的话，十几个势力每回合各自打五六路，一局能出兵 376 次，
        //    玩家开局就被打回 6 座城 —— 「变聪明」不等于「变无脑爆兵」。
        const cap = Balance.aiMaxAttacksPerFaction;
        let attacks = 0;
        const primary = fronts[0];
        if (primary && primary.to.owner !== fid) {
            const target = primary.to;
            const main = primary.main;
            const needOf = (): number => Math.ceil(
                Balance.aiBreakthroughRatio
                / Math.max(0.0001, this.aiPowerRatio(main, target, 1)));
            let need = needOf();
            if (main.troops < need) {
                const moved = this.aiConcentrate(fid, main, need);
                this.aiAssignGenerals(fid, main);
                // 名将到位后每兵战力变了，缺口要重算，避免白征一堆兵
                need = needOf();
                if (main.troops < need) {
                    this.aiSpendTreasury(fid, main, target, need);
                }
                if (moved > 0 && target.owner === this.playerFaction) {
                    const f = FACTION_MAP[fid];
                    const desc = `${f ? f.name : fid} 集结 ${moved} 兵于 ${main.name}`;
                    // 这条是 AI 的「意图预警」：玩家看完可以提前一回合调兵回防。
                    // 必须钉成要闻，否则会被后面各势力的攻城战报冲出窗口。
                    this.pushLog(`${f ? f.name : fid} 自后方集结 ${moved} 兵于 `
                        + `${main.name}，图谋 ${target.name}。`, 2);
                    // 战报会被后续日志冲走，敌情预警要留到玩家下个回合仍可见。
                    this.markThreat(target, desc);
                }
            } else {
                this.aiAssignGenerals(fid, main);
            }
            attacks += this.aiStrike(fid, target, cap, Balance.aiMaxAttacksPerTarget);
        }

        // 4) 主攻之外还有余力，就顺手捡软柿子：只用现成兵力，不再集结花钱。
        //    这一层保证 AI 不会因为「主攻方向是块硬骨头」而整回合发呆。
        for (let i = 1; i < fronts.length && i <= Balance.aiMaxFronts
            && attacks < cap; i++) {
            const front = fronts[i];
            if (front.to.owner === fid) {
                continue;
            }
            attacks += this.aiStrike(fid, front.to, cap - attacks, 1);
        }
    }

    /**
     * 对一座目标城组织进攻，返回实际出兵路数
     *
     * 每一波都重新算胜算：第一波削掉守军后，第二波可能就够了；反之若打崩了
     * 自己人，下一波会自动收兵。协同不是排队送死，是逐波重估。
     */
    private aiStrike(
        fid: string, target: ProvinceState, maxAttacks: number, maxWaves: number,
    ): number {
        let n = 0;
        for (let wave = 0; wave < maxWaves && n < maxAttacks; wave++) {
            if (target.owner === fid) {
                break;
            }
            let chosen: ProvinceState | null = null;
            let bestRate = Balance.aiMinWinRate;
            for (const p of this.provincesOf(fid)) {
                if (p.attacked || p.owner !== fid || !this.isAdjacent(p, target)) {
                    continue;
                }
                const rate = this.winRateOf(this.aiPowerRatio(p, target, p.troops));
                if (rate >= bestRate) {
                    bestRate = rate;
                    chosen = p;
                }
            }
            if (!chosen) {
                break;
            }
            this.attack(chosen, target);
            n++;
        }
        return n;
    }

    /**
     * 经济结算：所有势力的钱粮收入、人口增长，以及常规月募兵
     *
     * 分两遍是关键：先把粮草收进国库，再拿它去募兵。否则第一遍还没收粮，
     * 补给量会被上回合的余额卡住，发展度高的城反而补得少。
     * 月募兵受「驻军上限」和「粮草余额」双重约束，粮不够就少补 ——
     * 这正是「屯田」内政存在的理由。
     *
     * 返回值是**本月实际收到的钱粮**（不是 AI 行动后的下月预测），
     * 战报与结算 toast 都用它，避免「显示 800 金、实际只进了 600 金」。
     */
    private runEconomy(): { goldIncome: number; foodIncome: number; reinforced: number } {
        let goldIncome = 0;
        let foodIncome = 0;
        // 超编损耗先结算：临时集结的兵补给线养不起，每回合流失一部分。
        // 放在募兵之前，所以「超编 → 流失 → 再募兵」的顺序是稳定的，
        // 不会出现「先补满再扣」导致数字来回跳。
        this.provinces.forEach((p) => {
            const cap = this.garrisonCap(p);
            if (p.troops <= cap) {
                return;
            }
            const over = p.troops - cap;
            const loss = Math.round(over * Balance.overCapLossRate);
            p.troops = Math.max(cap, p.troops - loss);
        });
        this.provinces.forEach((p) => {
            const inc = this.provinceIncome(p);
            this.gold.set(p.owner, (this.gold.get(p.owner) || 0) + inc);
            const food = this.foodIncome(p);
            this.food.set(p.owner, (this.food.get(p.owner) || 0) + food);
            if (p.owner === this.playerFaction) {
                goldIncome += inc;
                foodIncome += food;
            }
            const maxPop = p.def.pop * Balance.popMaxFactor;
            p.pop = Math.min(maxPop, p.pop + Balance.popGrowth);
        });

        // 驻军粮饷：每名驻军每月吃粮。养重兵本身要有持续代价，否则太平年月
        // 粮草只进不出、攒成废纸。缺粮时扣到 0 为止，不按缺粮溃散兵力
        // （那会形成缺粮 → 掉兵 → 更守不住的死亡螺旋）。中立无主城不养常备军。
        const upkeepBy: Record<string, number> = {};
        this.provinces.forEach((p) => {
            if (p.owner === NEUTRAL) {
                return;
            }
            upkeepBy[p.owner] = (upkeepBy[p.owner] || 0) + p.troops;
        });
        Object.keys(upkeepBy).forEach((fid) => {
            const cost = Math.round(upkeepBy[fid] * Balance.foodPerTroopUpkeep);
            const avail = this.food.get(fid) || 0;
            this.food.set(fid, Math.max(0, avail - cost));
        });

        let reinforced = 0;
        // 募兵按势力累计，总量受 reinforceTotalCap 约束：城多不等于兵多。
        const usedBy: Record<string, number> = {};
        this.provinces.forEach((p) => {
            // 中立城是无主之地：不自动募兵，守军保持开局水平，
            // 不会随时间被经济系统养满成硬骨头。
            if (p.owner === NEUTRAL) {
                return;
            }
            const factor = p.owner === this.playerFaction ? 1 : Balance.aiSupplyFactor;
            const want = Math.round(this.autoReinforce(p) * factor);
            const room = Math.max(0, this.garrisonCap(p) - p.troops);
            if (want <= 0 || room <= 0) {
                return;
            }
            const used = usedBy[p.owner] || 0;
            const capLeft = Math.max(0, Balance.reinforceTotalCap - used);
            if (capLeft <= 0) {
                return;
            }
            const avail = this.food.get(p.owner) || 0;
            const byFood = Math.floor(avail / Balance.foodPerAutoTroop);
            const amount = Math.max(0, Math.min(want, room, byFood, capLeft));
            if (amount <= 0) {
                return;
            }
            p.troops += amount;
            usedBy[p.owner] = used + amount;
            this.food.set(p.owner, avail - amount * Balance.foodPerAutoTroop);
            if (p.owner === this.playerFaction) {
                reinforced += amount;
            }
        });

        return {
            goldIncome,
            foodIncome,
            reinforced,
        };
    }

    /** 推进年月 */
    private advanceDate(): void {
        this.month += Balance.monthsPerTurn;
        while (this.month > 12) {
            this.month -= 12;
            this.year++;
        }
    }

    // ------------------------------------------------------------------
    // 胜负
    // ------------------------------------------------------------------

    /** 检查玩家是否已统一天下 */
    public isVictory(): boolean {
        const mine = this.provincesOf(this.playerFaction).length;
        return mine === this.provinces.size;
    }

    /** 检查玩家是否已灭亡 */
    public isDefeat(): boolean {
        return this.provincesOf(this.playerFaction).length === 0;
    }

    /** 当前年月文本 */
    public dateText(): string {
        return `${this.year}年${this.month}月`;
    }

    // ------------------------------------------------------------------
    // 存档
    // ------------------------------------------------------------------

    /**
     * 导出存档数据
     *
     * 只保存「会变化」的运行时状态（归属、兵力、人口、工事、发展度、
     * 已登记/已执行的内政、金币/粮草、武将等级/驻地/所属/忠诚/俘虏状态），
     * 省名/坐标/配色等静态配置由代码提供，
     * 不重复存储，这样存档小且不受改数值影响。
     */
    public serialize(): SaveData {
        const provinces: Record<string, SavedProvince> = {};
        this.provinces.forEach((p) => {
            provinces[p.id] = {
                owner: p.owner,
                troops: p.troops,
                pop: Math.round(p.pop * 100) / 100,
                fort: p.fort,
                dev: Math.round(p.dev * 100) / 100,
                pending: p.pendingDomestic,
                acted: p.acted,
                attacked: p.attacked,
                generals: p.generals.slice(),
            };
        });

        const generals: Record<string, SavedGeneral> = {};
        this.generals.forEach((g, id) => {
            generals[id] = {
                level: g.level,
                exp: g.exp,
                faction: g.faction,
                loyalty: g.loyalty,
                captiveOf: g.captiveOf,
            };
        });

        const gold: Record<string, number> = {};
        this.gold.forEach((v, k) => {
            gold[k] = Math.round(v * 100) / 100;
        });

        const food: Record<string, number> = {};
        this.food.forEach((v, k) => {
            food[k] = Math.round(v * 100) / 100;
        });

        return {
            version: GameState.SAVE_VERSION,
            scenarioId: this.scenarioId,
            playerFaction: this.playerFaction,
            turn: this.turn,
            year: this.year,
            month: this.month,
            gold,
            food,
            provinces,
            generals,
            // 内政自动化属于玩家偏好：读档后不用重新设一遍
            autoDomestic: this.autoDomestic,
            lastOrder: this.lastOrder,
            // 本局战绩：与局面同存亡，新开一局由 reset() 清零
            stats: this.stats,
            // 每日挑战标记；普通局写空串，读档时按需恢复种子
            daily: this.dailyDate,
        };
    }

    /**
     * 从存档恢复
     *
     * 会先按存档里的剧本重置为初始局面，再覆盖存档里的运行时字段。
     * 旧存档没有 scenarioId 时回退到 194 群雄割据，保证老进度还能读。
     * 对存档中不存在的省份/武将保持初始值（兼容以后新增城池的情况）。
     * 返回是否恢复成功。
     */
    public deserialize(data: SaveData | null | undefined): boolean {
        if (!data || typeof data !== 'object') {
            return false;
        }
        if (data.version !== GameState.SAVE_VERSION) {
            // 版本不匹配时暂不恢复，避免读到结构不符的旧存档
            return false;
        }

        const sc = getScenario(data.scenarioId || DEFAULT_SCENARIO_ID);
        this.reset(sc.id);

        if (typeof data.playerFaction === 'string' && FACTION_MAP[data.playerFaction]) {
            this.playerFaction = data.playerFaction;
        }
        this.turn = Number.isFinite(data.turn) ? data.turn : 1;
        this.year = Number.isFinite(data.year) ? data.year : sc.year;
        this.month = Number.isFinite(data.month) ? data.month : sc.month;

        // 内政自动化：新档直接读两个字段；旧档只有 policy（上一版的「方针按钮」），
        // 折算成「开关 + 最后指令」，`manual` / `none` 都当成关闭。
        if (data.lastOrder === 'govern' || data.lastOrder === 'farm'
            || data.lastOrder === 'fortify' || data.lastOrder === 'recruit') {
            this.lastOrder = data.lastOrder;
        }
        if (typeof data.autoDomestic === 'boolean') {
            this.autoDomestic = data.autoDomestic;
        } else if (data.policy === 'govern' || data.policy === 'farm'
            || data.policy === 'fortify' || data.policy === 'recruit') {
            this.autoDomestic = true;
            this.lastOrder = data.policy;
        }

        // 金币
        if (data.gold) {
            for (const key of Object.keys(data.gold)) {
                const v = data.gold[key];
                if (Number.isFinite(v)) {
                    this.gold.set(key, v);
                }
            }
        }

        // 粮草：reset() 已按剧本给了初始值；旧存档没有 food 字段时直接沿用，
        // 不至于读档后第一回合完全补不了兵，发展度机制形同没生效。
        if (data.food) {
            for (const key of Object.keys(data.food)) {
                const v = data.food[key];
                if (Number.isFinite(v)) {
                    this.food.set(key, Math.max(0, v));
                }
            }
        }

        // 省份
        if (data.provinces) {
            for (const key of Object.keys(data.provinces)) {
                const st = this.provinces.get(key);
                const sv = data.provinces[key];
                if (!st || !sv) {
                    continue;
                }
                if (typeof sv.owner === 'string') {
                    st.owner = sv.owner;
                }
                if (Number.isFinite(sv.troops)) {
                    st.troops = Math.max(0, Math.round(sv.troops));
                }
                if (Number.isFinite(sv.pop)) {
                    st.pop = Math.max(1, sv.pop);
                }
                if (Number.isFinite(sv.fort)) {
                    st.fort = sv.fort;
                }
                // 旧存档没有 dev：用与开局完全相同的公式回退，
                // 否则老进度读进来所有城都变成发展度 0，收入骤降。
                st.dev = typeof sv.dev === 'number' && Number.isFinite(sv.dev)
                    ? Math.max(Balance.devMin, Math.min(Balance.devMax, Math.round(sv.dev)))
                    : this.initialDev(st);
                // 回合内已选、还没结算的内政：中途退出存档也要保住这个选择
                if (sv.pending === 'govern' || sv.pending === 'farm'
                    || sv.pending === 'fortify' || sv.pending === 'recruit') {
                    st.pendingDomestic = sv.pending;
                }
                if (typeof sv.acted === 'boolean') {
                    st.acted = sv.acted;
                }
                if (typeof sv.attacked === 'boolean') {
                    st.attacked = sv.attacked;
                }
                if (Array.isArray(sv.generals)) {
                    // 只保留仍然存在的武将，避免存档里的脏数据
                    st.generals = sv.generals.filter((gid) => this.generals.has(gid));
                }
            }
        }

        // 武将等级、当前所属、忠诚度与俘虏状态
        // 旧档没有后三个字段：faction 沿用 def.faction，loyalty 沿用配置初值，
        // captiveOf 保持 ''（自由身），所以老进度读进来不会有人凭空坐牢。
        if (data.generals) {
            for (const key of Object.keys(data.generals)) {
                const g = this.generals.get(key);
                const gv = data.generals[key];
                if (!g || !gv) {
                    continue;
                }
                if (Number.isFinite(gv.level)) {
                    g.level = Math.min(10, Math.max(1, Math.round(gv.level)));
                }
                if (Number.isFinite(gv.exp)) {
                    g.exp = Math.max(0, gv.exp);
                }
                if (typeof gv.faction === 'string'
                    && (FACTION_MAP[gv.faction] || gv.faction === NEUTRAL)) {
                    g.faction = gv.faction;
                }
                if (Number.isFinite(gv.loyalty)) {
                    g.loyalty = Math.max(Balance.loyaltyMin,
                        Math.min(Balance.loyaltyMax, Math.round(gv.loyalty)));
                }
                if (typeof gv.captiveOf === 'string'
                    && (gv.captiveOf === ''
                        || FACTION_MAP[gv.captiveOf] || gv.captiveOf === NEUTRAL)) {
                    g.captiveOf = gv.captiveOf;
                }
            }
        }

        // 俘虏不能同时挂在某座城的驻将列表里（旧档 / 脏数据兜底）。
        // 守恒条件是「在城 + 在营 = 48」，两边都算就会多出来。
        this.provinces.forEach((p) => {
            p.generals = p.generals.filter((gid) => {
                const g = this.generals.get(gid);
                return !g || g.captiveOf === '';
            });
        });

        // 本局战绩跟着局面走。旧档没有 stats 时按「剧本开局城数 + 当前城数」
        // 重建，最多版图至少不会比读档瞬间更小；SAVE_VERSION 仍保持 1。
        const opening = Object.keys(sc.owners)
            .filter((id) => sc.owners[id] === this.playerFaction).length;
        this.stats = sanitizeStats(
            data.stats,
            opening > 0 ? opening : this.stats.openingCities,
            this.provincesOf(this.playerFaction).length,
        );

        // 每日挑战标记：只接受合法日期键，脏值一律当普通局，
        // 免得一条坏字段让结算时去更新一个不存在的日期。
        this.dailyDate = typeof data.daily === 'string' && isDateKey(data.daily)
            ? data.daily
            : '';

        // 战报、重要度与敌情预警都是「上一回合的过程信息」，不在存档里；
        // 读档后不重建，避免旧局的「敌军图谋」挂到新局面城池上。
        this.logs = [];
        this.logPriority = [];
        this.threats.clear();
        return true;
    }

    /**
     * 存档格式版本号
     *
     * ⚠ 刻意保持 1：deserialize() 对版本号是**严格相等**校验，升版本会直接
     * 拒绝所有旧存档。新增的 dev / pending / acted / food / policy /
     * faction / loyalty / captiveOf 全部是可选字段 + 默认值回退，
     * 老进度能原样读进来，所以这里不升版本，也不用写迁移逻辑。
     */
    public static readonly SAVE_VERSION = 1;
}

/** 存档中的省份状态 */
interface SavedProvince {
    owner: string;
    troops: number;
    pop: number;
    fort: number;
    /** 发展度；可选，旧存档缺失时按人口重新推算 */
    dev?: number;
    /** 本回合登记、还没结算的内政指令；可选，旧档默认 'none' */
    pending?: DomesticOrder | 'none';
    /** 本回合内政是否已执行；可选，旧档默认 false */
    acted?: boolean;
    /** 本回合是否已出征；可选，旧档默认 false */
    attacked?: boolean;
    generals: string[];
}

/** 存档中的武将状态；后三个字段可选，旧档缺失时按配置初值回退 */
interface SavedGeneral {
    level: number;
    exp: number;
    faction?: string;
    loyalty?: number;
    captiveOf?: string;
}

/** 存档数据结构 */
export interface SaveData {
    version: number;
    /** 剧本 id；可选，旧存档没有该字段 */
    scenarioId?: string;
    playerFaction: string;
    turn: number;
    year: number;
    month: number;
    gold: Record<string, number>;
    /** 势力粮草；可选，旧存档缺失时按剧本初始值 */
    food?: Record<string, number>;
    provinces: Record<string, SavedProvince>;
    generals: Record<string, SavedGeneral>;
    /** 是否每回合自动重复最后一道内政；可选，旧档缺失时按 policy 折算 */
    autoDomestic?: boolean;
    /** 最后一道内政指令（自动时重复它）；可选 */
    lastOrder?: DomesticOrder;
    /** 上一版的「内政方针」字段；只用于读旧档，新档写 autoDomestic + lastOrder */
    policy?: DomesticPolicy;
    /** 本局战绩；可选，旧存档缺失时按开局城数与当前城数重建 */
    stats?: RunStats;
    /** 每日挑战的日期键（YYYY-MM-DD）；可选，缺失 / 脏值 = 普通局 */
    daily?: string;
}

/** 全部势力列表（避免循环依赖，这里再导出一次） */
export const FactionList: FactionDef[] = (() => {
    const list: FactionDef[] = [];
    for (const f of FACTIONS) {
        list.push(f);
    }
    return list;
})();
