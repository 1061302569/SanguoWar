import { Balance } from './Balance';
import { Geo } from './Geo';
import { FACTIONS, FACTION_MAP, NEUTRAL } from '../data/Factions';
import { PROVINCES } from '../data/Provinces';
import { GENERALS } from '../data/Generals';
import {
    DEFAULT_SCENARIO_ID, ScenarioDef, getScenario, playableFactions,
} from '../data/Scenarios';
import { FactionDef, GeneralState, ProvinceState, DomesticOrderKey } from '../data/Types';
import { resolveBattle, CombatSide } from './Combat';

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

    /** 本回合战报 */
    public logs: string[] = [];

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
     * @param factionId 玩家想执掌的势力；必须在剧本的可选列表里
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
            this.generals.set(def.id, { def, level: 1, exp: 0 });
        }

        this.placeGenerals(sc);

        // 初始金币与粮草
        for (const f of FactionList) {
            this.gold.set(f.id, sc.gold ?? 800);
            this.food.set(f.id, sc.food ?? Balance.startFood);
        }
        this.gold.set(NEUTRAL, 300);
        this.food.set(NEUTRAL, Balance.startFood);
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
        return Math.round(pop * Balance.garrisonCapPerPop + (st.def.city ? 800 : 0));
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

    /** 省份每月金币收入：人口 × 大城加成 × 发展度倍率 */
    public provinceIncome(st: ProvinceState): number {
        const cityBonus = st.def.city ? 1.35 : 1;
        return Math.round(st.pop * Balance.incomePerPop * cityBonus * this.devFactor(st));
    }

    /** 省份每月粮草产出：人口 × 发展度倍率 */
    public foodIncome(st: ProvinceState): number {
        return Math.round(st.pop * Balance.foodPerPop * this.devFactor(st));
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

    /** 将领等级之和 */
    private sumGeneralRating(st: ProvinceState, key: 'atk' | 'def'): number {
        let sum = 0;
        for (const gid of st.generals) {
            const g = this.generals.get(gid);
            if (g) {
                sum += g.def[key] + (g.level - 1) * 0.5;
            }
        }
        return sum;
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
        const room = Math.max(0, cap - st.troops);
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
            const overflow = st.troops + amount - this.capAt(st, popAfter);
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
        const newCap = this.garrisonCap(st);
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
                    + `耗 ${Balance.governGoldCost} 金，此后月收更高。`);
            }
            st.acted = true;
            return { ok: true, reason: `治理完成，发展度 +${gain}`, amount: gain };
        }

        if (order === 'farm') {
            // 和金币 / 粮草 / 月募兵共用同一个发展度倍率，没有第四套公式
            const gain = Math.round(st.pop * Balance.farmFoodPerPop * this.devFactor(st));
            this.food.set(fid, food + gain);
            if (log) {
                this.pushLog(`${st.name} 屯田：粮草 +${gain}（可供月募兵）。`);
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
                this.pushLog(`${st.name} 筑城：工事升至 ${st.fort}，守城更强。`);
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
                this.pushLog(`${st.name} 征兵 ${got}。`);
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

    /** 在本方相邻省份之间调兵 */
    public moveTroops(from: ProvinceState, to: ProvinceState, troops: number): boolean {
        if (from.owner !== to.owner || !this.isAdjacent(from, to) || troops <= 0) {
            return false;
        }
        const room = Math.max(0, this.garrisonCap(to) - to.troops);
        const amount = Math.min(troops, from.troops, room);
        if (amount <= 0) {
            return false;
        }
        from.troops -= amount;
        to.troops += amount;
        // 将领随军移动（简单规则：从该省抽调一半将领，至少保留 0 位）
        const moveCount = Math.floor(from.generals.length / 2);
        for (let i = 0; i < moveCount; i++) {
            const gid = from.generals.shift();
            if (gid) {
                to.generals.push(gid);
            }
        }
        return true;
    }

    /**
     * 对相邻敌省发起进攻
     */
    public attack(from: ProvinceState, to: ProvinceState): {
        result: ReturnType<typeof resolveBattle>;
        captured: boolean;
        loot: number;
    } | null {
        if (from.owner !== to.owner && this.isAdjacent(from, to) && from.troops > 0) {
            const atkSide: CombatSide = {
                troops: from.troops,
                atk: this.sumGeneralRating(from, 'atk'),
                def: this.sumGeneralRating(from, 'def'),
                cap: this.garrisonCap(from),
            };
            const defSide: CombatSide = {
                troops: to.troops,
                atk: this.sumGeneralRating(to, 'atk'),
                def: this.sumGeneralRating(to, 'def'),
                cap: this.garrisonCap(to),
            };
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
                this.gold.set(from.owner, (this.gold.get(from.owner) || 0) + loot);
                to.owner = from.owner;
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

                // 守将不会凭空消失：把他们撤到原势力最近的己方据点；
                // 若该势力已无据点，则视为归降（留在原地）。
                const defenders = to.generals.splice(0, to.generals.length);
                const retreatTo = this.findRetreatProvince(to, prevOwner);
                for (const gid of defenders) {
                    if (retreatTo) {
                        retreatTo.generals.push(gid);
                    } else {
                        to.generals.push(gid);
                    }
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
                this.pushLog(`${from.name} 攻占 ${to.name}（原属 ${prevOwner}），`
                    + `驻军 ${to.troops}，掠夺金币 ${loot}，发展度降至 ${to.dev}。`);
                this.growGeneralExp(from, true, defenderBefore);
            } else {
                this.pushLog(`${from.name} 进攻 ${to.name} 失利。`);
                this.growGeneralExp(from, false, defenderBefore);
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
                this.pushLog(`武将 ${g.def.name} 晋升至 ${g.level} 级。`);
            }
        }
    }

    /** 追加战报 */
    public pushLog(msg: string): void {
        this.logs.push(msg);
        if (this.logs.length > 200) {
            this.logs.shift();
        }
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
            this.pushLog(`内政结算：${parts.join('、')}。`);
        }
        const econ = this.runEconomy();
        const report = this.runAiPhase();
        // 报告统一填「本月实收」，不混进 AI 行动后的下月预测
        report.goldIncome = econ.goldIncome;
        report.foodIncome = econ.foodIncome;
        report.reinforced = econ.reinforced;
        report.autoOrders = dom.auto;
        report.domesticOrders = dom.executed;
        this.advanceDate();
        this.turn++;
        this.playerTurnEnded = false;
        // 重置每省行动标记（acted = 内政已执行，下一回合可以再选一次）
        // pendingDomestic 已在 settleDomestic() 里清空，这里不用再管。
        this.provinces.forEach((p) => {
            p.acted = false;
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

    /** 单个 AI 势力的行动 */
    private aiFactionAct(fid: string): void {
        const mine = this.provincesOf(fid);
        // 优先级：兵力充足时进攻最弱的邻敌
        for (const st of mine) {
            if (st.troops < 500) {
                continue;
            }
            const targets = this.attackTargets(st);
            let best: ProvinceState | null = null;
            let bestScore = 0;
            for (const t of targets) {
                const defPower = t.troops * (1 + t.fort * Balance.fortPerPoint);
                const atkPower = st.troops;
                const ratio = atkPower / Math.max(1, defPower);
                // 大城更值得打
                const value = t.def.city ? 1.25 : 1.0;
                const score = ratio * value;
                if (ratio > Balance.aiAttackRatio && score > bestScore) {
                    best = t;
                    bestScore = score;
                }
            }
            if (best) {
                this.attack(st, best);
            }
        }
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

        let reinforced = 0;
        this.provinces.forEach((p) => {
            const factor = p.owner === this.playerFaction ? 1 : Balance.aiSupplyFactor;
            const want = Math.round(this.autoReinforce(p) * factor);
            const room = Math.max(0, this.garrisonCap(p) - p.troops);
            if (want <= 0 || room <= 0) {
                return;
            }
            const avail = this.food.get(p.owner) || 0;
            const byFood = Math.floor(avail / Balance.foodPerAutoTroop);
            const amount = Math.max(0, Math.min(want, room, byFood));
            if (amount <= 0) {
                return;
            }
            p.troops += amount;
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
     * 已登记/已执行的内政、金币/粮草、武将等级与驻地），
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
                generals: p.generals.slice(),
            };
        });

        const generals: Record<string, SavedGeneral> = {};
        this.generals.forEach((g, id) => {
            generals[id] = { level: g.level, exp: g.exp };
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
                if (Array.isArray(sv.generals)) {
                    // 只保留仍然存在的武将，避免存档里的脏数据
                    st.generals = sv.generals.filter((gid) => this.generals.has(gid));
                }
            }
        }

        // 武将等级
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
            }
        }

        this.logs = [];
        return true;
    }

    /**
     * 存档格式版本号
     *
     * ⚠ 刻意保持 1：deserialize() 对版本号是**严格相等**校验，升版本会直接
     * 拒绝所有旧存档。新增的 dev / pending / acted / food / policy 全部是
     * 可选字段 + 默认值回退，老进度能原样读进来，所以这里不升版本，
     * 也不用写迁移逻辑。
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
    generals: string[];
}

/** 存档中的武将状态 */
interface SavedGeneral {
    level: number;
    exp: number;
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
}

/** 全部势力列表（避免循环依赖，这里再导出一次） */
export const FactionList: FactionDef[] = (() => {
    const list: FactionDef[] = [];
    for (const f of FACTIONS) {
        list.push(f);
    }
    return list;
})();
