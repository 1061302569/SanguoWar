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

/** 武将定义 */
export interface GeneralDef {
    id: string;
    name: string;
    faction: string;
    /** 攻击等级 1-10 */
    atk: number;
    /** 防御等级 1-10 */
    def: number;
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
