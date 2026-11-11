import { INITIAL_OWNER } from './Provinces';
import { INITIAL_GENERAL_POST } from './Generals';

/**
 * 剧本（开局配置）
 *
 * 把「年月、城池归属、玩家势力、初始兵力/金币、武将驻地」从 GameState 里
 * 抽出来，做成一个个可选择的剧本。以后要加新剧本，只需往 SCENARIOS 里
 * 再加一项，UI、存档、重开流程都不用改。
 *
 * 约定：
 *   - owners 未列出的城池为中立（NEUTRAL）
 *   - owners 的 key 必须是 Provinces.ts 里存在的城池 id
 *   - playable 里的势力必须在 owners 中有城，且默认玩家势力在其中
 *   - generalPosts 省略时，按「武将所属势力 -> 该势力的城」自动分配
 *
 * 历史年份只用于气氛与开局格局，归属为便于游玩的简化推演，非严格考据。
 */
export interface ScenarioDef {
    id: string;
    /** 剧本名 */
    name: string;
    /** 年代副标题 */
    era: string;
    /** 一句话简介 */
    desc: string;
    /** 难度标签（仅展示） */
    difficulty: string;
    year: number;
    month: number;
    /** 默认玩家势力 */
    playerFaction: string;
    /** 玩家可选的势力（必须在本剧本有城） */
    playable: string[];
    /** 省份 id -> 势力 id */
    owners: Record<string, string>;
    /** 初始驻军倍率，默认 1 */
    troopsScale?: number;
    /** 每个势力的初始金币，默认 800 */
    gold?: number;
    /** 每个势力的初始粮草，默认 Balance.startFood（发展度机制的起步资源） */
    food?: number;
    /** 武将驻地覆盖；不填则自动按势力分配 */
    generalPosts?: Record<string, string>;
}

export const SCENARIOS: ScenarioDef[] = [
    {
        id: 'qunxiong_194',
        name: '群雄割据',
        era: '194年 · 关东诸侯并起',
        desc: '十八路诸侯各据一方，从三城之地起兵，逐一吞并天下。',
        difficulty: '均衡',
        year: 194,
        month: 1,
        playerFaction: 'cao',
        playable: ['cao', 'liu', 'sun'],
        owners: INITIAL_OWNER,
        troopsScale: 1,
        gold: 800,
        // 194 剧本沿用原初的精细驻守表，保证老存档与既有手感完全一致
        generalPosts: INITIAL_GENERAL_POST,
    },
    {
        id: 'guandu_200',
        name: '官渡前夜',
        era: '200年 · 河北与中原对峙',
        desc: '袁绍尽有河北，曹操挟天子据中原。两强之间，先下手者为胜。',
        difficulty: '困难',
        year: 200,
        month: 5,
        playerFaction: 'cao',
        playable: ['cao', 'yuan_shao', 'liu', 'sun'],
        troopsScale: 1.15,
        gold: 900,
        owners: {
            // 辽东
            xiangping: 'gongsun_du',
            // 袁绍 — 河北、并州、青州
            beiping: 'yuan_shao',
            ji: 'yuan_shao',
            zhongshan: 'yuan_shao',
            nanpi: 'yuan_shao',
            ye: 'yuan_shao',
            jinyang: 'yuan_shao',
            yunzhong: 'yuan_shao',
            beihai: 'yuan_shao',
            // 曹操 — 司隶、兖豫、宛洛
            luoyang: 'cao',
            xuchang: 'cao',
            qiao: 'cao',
            puyang: 'cao',
            wan: 'cao',
            changan: 'cao',
            // 刘备 — 徐州
            langya: 'liu',
            xiapi: 'liu',
            guangling: 'liu',
            // 孙策 — 江东
            jianye: 'sun',
            kuaiji: 'sun',
            // 刘表 — 荆州
            xiangyang: 'liubiao',
            jiangling: 'liubiao',
            changsha: 'liubiao',
            // 刘璋 — 益州
            chengdu: 'liuzhang',
            jiangzhou: 'liuzhang',
            jianning: 'liuzhang',
            // 张鲁 — 汉中
            hanzhong: 'zhanglu',
            // 马腾 — 西凉
            shuofang: 'mateng',
            guzang: 'mateng',
            jincheng: 'mateng',
            tianshui: 'mateng',
            // 士燮 — 交州
            guiyang: 'shixie',
            nanhai: 'shixie',
            jiaozhi: 'shixie',
            // 寿春：袁术败亡后无主
        },
    },
    {
        id: 'chibi_208',
        name: '赤壁之战',
        era: '208年 · 荆州新定，大军南下',
        desc: '曹操已定北方、收降荆州，孙刘退守东南。以弱抗强，逆势翻盘。',
        difficulty: '挑战',
        year: 208,
        month: 9,
        playerFaction: 'liu',
        playable: ['cao', 'liu', 'sun'],
        troopsScale: 1.25,
        gold: 1000,
        owners: {
            // 曹操 — 北方全境 + 荆州北部 + 淮南
            xiangping: 'cao',
            beiping: 'cao',
            ji: 'cao',
            zhongshan: 'cao',
            nanpi: 'cao',
            ye: 'cao',
            jinyang: 'cao',
            yunzhong: 'cao',
            beihai: 'cao',
            luoyang: 'cao',
            xuchang: 'cao',
            qiao: 'cao',
            puyang: 'cao',
            langya: 'cao',
            xiapi: 'cao',
            guangling: 'cao',
            wan: 'cao',
            changan: 'cao',
            xiangyang: 'cao',
            jiangling: 'cao',
            shouchun: 'cao',
            // 孙权 — 江东
            jianye: 'sun',
            kuaiji: 'sun',
            // 刘备 — 荆南
            changsha: 'liu',
            guiyang: 'liu',
            // 刘璋 — 益州
            chengdu: 'liuzhang',
            jiangzhou: 'liuzhang',
            jianning: 'liuzhang',
            // 张鲁 — 汉中
            hanzhong: 'zhanglu',
            // 马腾 — 西凉
            shuofang: 'mateng',
            guzang: 'mateng',
            jincheng: 'mateng',
            tianshui: 'mateng',
            // 士燮 — 交州南部
            nanhai: 'shixie',
            jiaozhi: 'shixie',
        },
    },
];

/** 默认剧本（也是旧存档没有剧本字段时的回退值） */
export const DEFAULT_SCENARIO_ID = SCENARIOS[0].id;

/** 按 id 取剧本，取不到时回退到默认剧本 */
export function getScenario(id: string | null | undefined): ScenarioDef {
    return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

/** 该剧里玩家可选的势力（过滤掉没有城的势力） */
export function playableFactions(sc: ScenarioDef): string[] {
    const hasCity: Record<string, boolean> = {};
    for (const pid of Object.keys(sc.owners)) {
        hasCity[sc.owners[pid]] = true;
    }
    return sc.playable.filter((fid) => !!hasCity[fid]);
}
