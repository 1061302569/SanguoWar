/**
 * 全局数值平衡表
 * 所有可调参数集中在这里，方便策划调数值而不用改逻辑代码。
 *
 * 约定：**这里每一个字段都必须在 assets/ 里有实际引用**。
 * 以前表里躺着 turnLimit / recruitMin / armyMaxMp 等 9 个从未接线的参数，
 * 看起来像「游戏有回合上限、有军团机动力」，实际全是摆设，调数值的人会被骗。
 * tools/sim-development.ts 末尾有一条守卫逐个检查，防止再留下假参数。
 */
export const Balance = {
    // ---- 回合与时间 ----
    /** 每回合代表一个月 */
    monthsPerTurn: 1,
    /** 起始年份（建安元年 = 196） */
    startYear: 194,
    startMonth: 1,

    // ---- 经济 ----
    /** 每点人口的月收入 */
    incomePerPop: 4,
    /** 每点人口的驻军上限 */
    garrisonCapPerPop: 45,
    /** 每回合人口自然增长 */
    popGrowth: 0.6,
    /** 人口上限相对初始人口的倍率 */
    popMaxFactor: 1.6,

    // ---- 城池发展度 ----
    devMin: 0,
    devMax: 100,
    /** 开局发展度 = pop * devPerPop + (大城 ? devCityBonus : 0)，钳到上下限 */
    devPerPop: 1.5,
    devCityBonus: 10,
    /**
     * **唯一的发展度倍率**：devFactor = 1 + dev/100 * devOutputFactor
     *
     * 金币、粮草、月募兵、屯田四项产出全部乘同一个 devFactor，
     * 没有第二套系数。所以「治理 +8」的收益是可算的：
     * 这座城所有月产出都 +8%，发展度从 0 养到 100 就是全部翻倍。
     *
     * 早先四项各写一套公式（金币 ×0.8、粮草 ×1.0、补兵 dev/100×(1+pop/40)、
     * 屯田 (1+dev/100)），同一个数字四种算法，玩家根本判断不出治理值不值。
     */
    devOutputFactor: 1.0,
    /**
     * 月募兵额 = pop * reinforcePerPop * devFactor（再受粮草与驻军上限约束）
     *
     * 不再额外耦合 pop/40 —— 驻军上限本来就是 pop 决定的，重复乘一次 pop
     * 等于把人口算了两遍。现在「人口定规模、发展度定效率」。
     * pop30、dev60 时约 168 兵/月，与旧公式对齐，平衡不用重调。
     */
    reinforcePerPop: 3.5,
    /** 粮草月产 = pop * foodPerPop * devFactor */
    foodPerPop: 1.6,
    /**
     * 每名月募兵消耗的粮草（粮草不足就少募，这是屯田的意义）
     *
     * 取 0.45 是让粮草收支基本持平：月产 = pop×1.6×devFactor，
     * 月募兵 = pop×3.5×devFactor，吃粮 = pop×1.575×devFactor。
     * 早先 0.25 只吃掉四成产粮，粮草每回合净流入，玩到 200 回合攒到 24 万，
     * 「屯田」和「缺粮就少补兵」两条规则全成了摆设。现在想多募兵 / 筑城
     * 就得真的去屯田，资源才有取舍。
     */
    foodPerAutoTroop: 0.45,
    /**
     * AI 的补给效率（**难度设定，必须在界面/文档公开**）
     *
     * AI 不会征兵 / 屯田 / 筑城，人口不掉、驻军长期满编；再让它吃满月募兵，
     * 17 个势力围着玩家滚雪球，玩家三座城 100 回合内必亡（sim-game 实测）。
     * 这是给玩家的可读难度让步，不是隐藏 bug 修补：面板与 README 都写明。
     */
    aiSupplyFactor: 0.7,

    // ---- 内政四令（每城每回合四选一，共用一次行动点）----
    /** 治理：花金币换发展度 */
    governGoldCost: 240,
    governDevGain: 8,
    /** 屯田：一次性粮草 = pop * farmFoodPerPop * devFactor */
    farmFoodPerPop: 2.2,
    /** 筑城：花金币 + 粮草加工事 */
    fortifyGoldCost: 180,
    fortifyFoodCost: 60,
    fortifyFortGain: 1,
    fortMax: 9,
    /**
     * 征兵（急征）：一次补到缺口的比例，且最多花国库的比例
     *
     * 旧版 want = 全部金币 / goldPerTroop，点一下国库清零；自动征兵时排序
     * 第一的城把钱全拿走，其余城一间也征不到。现在「一次只补六成缺口、
     * 只动四分之一国库」，多座城都能分到钱，也给治理 / 筑城留了预算。
     */
    recruitFillRatio: 0.6,
    recruitGoldShare: 0.25,
    /** 单次征兵的规模上限 */
    recruitMax: 2000,
    /** 每名士兵消耗的金币 */
    goldPerTroop: 0.3,
    /** 每名士兵消耗的人口 */
    popPerTroop: 0.02,

    /** 攻占后发展度损失比例（打烂了的城要重新经营） */
    captureDevLoss: 0.25,
    /** AI 每回合最多治理几座城，且发展度低于该阈值才治理 */
    aiGovernMax: 1,
    aiGovernDevThreshold: 70,
    /** 开局粮草（势力级；旧存档缺 food 字段时按它回退） */
    startFood: 400,

    // ---- 战斗 ----
    /** 单场战斗最多进行多少轮 */
    maxRounds: 3,
    /** 每轮基础损耗系数 */
    attrition: 0.65,
    /** 战斗随机浮动区间（±） */
    randomSpread: 0.10,
    /** 守城工事加成：每点工事带来的防御倍率 */
    fortPerPoint: 0.08,
    /** 守军剩余兵力低于该比例即视为防线崩溃，进攻方占领 */
    collapseRatio: 0.35,
    /** 每名武将攻击等级带来的倍率 */
    atkPerRating: 0.05,
    /** 每名武将防御等级带来的倍率 */
    defPerRating: 0.05,
    /** 战斗胜利可为武将累积的经验 */
    winExp: 30,
    loseExp: 10,
    /** 武将升级所需经验（每级递增） */
    levelExpBase: 100,

    // ---- 攻占据点 ----
    /** 攻下后掠夺的金币系数（相对守军损失的倍数） */
    lootPerLoss: 0.25,
    /** 攻下后人口损失比例 */
    capturePopLoss: 0.10,
    /** 攻下后，进攻方存活兵力中留在新城的比例（其余撤回出发地） */
    captureGarrisonRatio: 0.55,

    // ---- AI ----
    /** AI 认为有把握进攻的最低兵力比 */
    aiAttackRatio: 1.15,
};
