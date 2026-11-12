/**
 * 游戏核心数据类型定义
 */

/** 势力定义 */
export interface FactionDef {
    id: string;
    name: string;
    /** 主色（#RRGGBB） */
    color: string;
    /** 势力特色描述 */
    desc: string;
    /** 是否为可玩势力 */
    playable: boolean;
}

/** 将领身份：武将 / 文官。两类都有忠诚度，不做隐藏的差别待遇 */
export type GeneralRole = 'military' | 'civil';

/**
 * 君主加成：按历史定位给的一项特长，全部是公开的百分比。
 *
 * 作用范围只有两处，不搞第三处：
 *   atk / def / gold / food → **该君主驻守的那座城**（人走了加成就跟着走）
 *   persuade               → 全局，只要这位君主已在我方阵营（在城上，不是在营里）
 * 同一座城里有多位带加成的君主时取最高值，不叠加 —— 否则把招来的旧主
 * 和自己的君主塞进一城就能堆出离谱数字。
 */
export interface RulerBonus {
    /** 称号，UI 与战报显示用，例如「唯才是举」 */
    title: string;
    /** 进攻战力加成（0.2 = +20%），该城发起进攻时生效 */
    atk?: number;
    /** 防御战力加成，该城被进攻时生效 */
    def?: number;
    /** 金币月收入加成，该城 */
    gold?: number;
    /** 粮草月产出加成，该城 */
    food?: number;
    /** 招降成功率加成（全局，已归我方阵营时生效） */
    persuade?: number;
}

/** 君主加成里带数值的那几项（title 只是称号，不算数值项） */
export type RulerBonusKey = 'atk' | 'def' | 'gold' | 'food' | 'persuade';

/** 武将定义 */
export interface GeneralDef {
    id: string;
    name: string;
    /** 开局所属势力（静态配置，投诚后以 GeneralState.faction 为准） */
    faction: string;
    /** 攻击等级 1-10 */
    atk: number;
    /** 防御等级 1-10 */
    def: number;
    /** 武将还是文官 */
    role: GeneralRole;
    /**
     * 是否为本势力君主；每个势力最多一人。
     * 在位君主不可招降；失去所有城池后即可招降（见 GameState.isReigning）。
     */
    ruler?: boolean;
    /** 开局忠诚度 0~100，越高越难招降 */
    loyalty: number;
    /** 君主专属：按历史定位给的一项加成。非君主没有这个字段 */
    bonus?: RulerBonus;
}

/** 省份静态定义 */
export interface ProvinceDef {
    id: string;
    name: string;
    /** 真实纬度（北纬为正） */
    lat: number;
    /** 真实经度（东经为正） */
    lon: number;
    /** 是否为大城（产出与工事更高） */
    city: boolean;
    /** 初始人口 */
    pop: number;
    /** 初始工事等级 */
    fort: number;
    /** 相邻省份 id 列表（真实地理上的接壤关系，显式声明） */
    borders: string[];
    /** 所属州（用于 UI 分组显示） */
    region: string;
}

/** 武将运行时状态 */
export interface GeneralState {
    def: GeneralDef;
    level: number;
    exp: number;
    /**
     * 当前所属势力。招降成功后从 def.faction 改成新主的势力；
     * def.faction 只用于开局布阵，别再拿它判断「现在是谁的人」。
     */
    faction: string;
    /** 当前忠诚度 0~100：越高越不肯降；放归会降，招降失败会升 */
    loyalty: number;
    /** 被哪个势力关押；'' = 自由身（在城驻守）。俘虏不在任何 province.generals 里 */
    captiveOf: string;
}

/**
 * 内政指令四选一。
 *
 * 放在 data 层是为了让 `ProvinceState.pendingDomestic` 与 `GameState.DomesticOrder`
 * 共用同一个定义 —— GameState 里只是把它换个名字再导出，不另写一份字面量。
 * 名字带 Key 后缀是为了让 GameState 能直接 import 而不用 `as` 别名
 * （tools/bundle-test.mjs 的解构式打包不处理别名）。
 */
export type DomesticOrderKey = 'govern' | 'farm' | 'fortify' | 'recruit';

/** 省份运行时状态 */
export class ProvinceState {
    def: ProvinceDef;
    owner: string;
    /** 驻军 */
    troops = 0;
    /** 人口 */
    pop = 0;
    /** 工事等级 */
    fort = 0;
    /**
     * 发展度 0~100：通过同一个 devFactor 放大金币 / 粮草 / 月募兵 / 屯田。
     * 开局由 GameState.initialDev() 按人口与大城加成推算，攻占后会受损，
     * 靠「治理」内政指令长期拉起来。
     */
    dev = 0;
    /** 驻扎武将 id 列表 */
    generals: string[] = [];
    /**
     * 本回合**登记**、还没结算的内政指令（'none' = 还没选）。
     *
     * 玩家回合内点内政键只是在这里做个选择：不扣资源、不改数值。
     * 真正执行只有一次 —— GameState.endTurn() 里的 settleDomestic()。
     * 再点同一道可以取消，点另一道就改选，所以「点错了」不消耗回合。
     * 结算后一律清空，存档也要带上，避免中途退出丢掉已做的选择。
     */
    pendingDomestic: DomesticOrderKey | 'none' = 'none';
    /**
     * 本回合是否已**执行**过内政指令（治理 / 屯田 / 筑城 / 征兵 四选一）。
     * 军事行动（进攻、调兵）不占用它 —— 一回合可以既治理又出兵，
     * 但内政本身必须取舍，否则「无脑把发展度堆满」就没有代价了。
     * GameState.endTurn() 里统一重置。玩家回合内它恒为 false，
     * 因为那时指令还只是登记状态，没有执行。
     */
    acted = false;
    /**
     * 本回合是否已从这座城出征过。
     *
     * 一座城一回合只能打一次：战斗本身就要折损四成兵力，如果允许同一座城
     * 反复出征，「打一波 → 补兵 → 再打」的节奏就不存在了 —— 玩家能在
     * 一回合里连下数城，整局十来个回合就结束了。出征一次之后必须等募兵
     * 或从后方调兵，推进才有节拍。
     *
     * 调兵不占这个标记：兵可以先调进来，再从这座城打出去。
     */
    attacked = false;
    /** 本回合是否刚被占领（避免连动） */
    captured = false;

    constructor(def: ProvinceDef, owner: string) {
        this.def = def;
        this.owner = owner;
        this.pop = def.pop;
        this.fort = def.fort;
    }

    get id(): string {
        return this.def.id;
    }

    get name(): string {
        return this.def.name;
    }

    get lat(): number {
        return this.def.lat;
    }

    get lon(): number {
        return this.def.lon;
    }

    get region(): string {
        return this.def.region;
    }

    /** 相邻省份 id 列表 */
    get borders(): string[] {
        return this.def.borders;
    }
}

/** 战斗结果 */
export interface BattleResult {
    attackerWin: boolean;
    attackerLoss: number;
    defenderLoss: number;
    attackerLeft: number;
    defenderLeft: number;
    rounds: number;
    log: string[];
}

/** 进攻结果（含占领信息） */
export interface AttackResult extends BattleResult {
    captured: boolean;
    fromId: string;
    toId: string;
    loot: number;
}
