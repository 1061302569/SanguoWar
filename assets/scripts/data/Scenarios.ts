import { INITIAL_OWNER, PROVINCES } from './Provinces';
import { INITIAL_GENERAL_POST, GENERALS, RULER_OF, BONUS_KIND } from './Generals';
import { FACTION_MAP, NEUTRAL } from './Factions';

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

/** 地图选势力时显示的势力简报（全部来自剧本静态配置，不依赖当前局面） */
export interface FactionBrief {
    id: string;
    name: string;
    /** 开局城池数 */
    cities: number;
    /** 该势力武将数（含君主） */
    generals: number;
    /** 君主名；没有将领的势力为空串 */
    ruler: string;
    /** 君威文案，如「攻+20%」；没有则空串 */
    bonus: string;
    /** 接壤的其它势力名（不含中立），按名字排序 */
    neighbors: string[];
}

/**
 * 势力简报：地图上点一座城之后，浮层要回答「我选的是谁、多大、挨着谁」。
 *
 * 为什么不用当前局面算：玩家可能在中途打开剧本面板预览，这时 `GameState`
 * 还是上一局打乱后的版图，用它算出来的「城池数」是错的。这里一律读剧本的
 * 开局配置，所以预览与真正开局看到的数字完全一致。
 */
export function factionBriefOf(sc: ScenarioDef, fid: string): FactionBrief {
    const mine: Record<string, boolean> = {};
    for (const pid of Object.keys(sc.owners)) {
        if (sc.owners[pid] === fid) {
            mine[pid] = true;
        }
    }
    const nbSet: Record<string, boolean> = {};
    for (const p of PROVINCES) {
        if (!mine[p.id]) {
            continue;
        }
        for (const nb of p.borders) {
            const owner = sc.owners[nb];
            // 中立与「自己」都不算接壤势力；同势力只记一次
            if (owner && owner !== fid && owner !== NEUTRAL && !nbSet[owner]) {
                nbSet[owner] = true;
            }
        }
    }
    const neighbors = Object.keys(nbSet)
        .map((id) => (FACTION_MAP[id] ? FACTION_MAP[id].name : id))
        .sort((a, b) => a.localeCompare(b, 'zh'));

    const rid = RULER_OF[fid];
    const ruler = rid ? GENERALS.find((g) => g.id === rid) : undefined;
    let bonus = '';
    if (ruler && ruler.bonus) {
        const parts: string[] = [];
        for (const k of BONUS_KIND) {
            const v = ruler.bonus[k.key];
            if (typeof v === 'number' && v > 0) {
                parts.push(`${k.name}+${Math.round(v * 100)}%`);
            }
        }
        bonus = parts.join(' ');
    }

    return {
        id: fid,
        name: FACTION_MAP[fid] ? FACTION_MAP[fid].name : fid,
        cities: Object.keys(mine).length,
        generals: GENERALS.filter((g) => g.faction === fid).length,
        ruler: ruler ? ruler.name : '',
        bonus,
        neighbors,
    };
}

/** 浮层正文：三行，分别回答「多大 / 谁当家和君威 / 挨着谁」 */
export function factionBriefLines(b: FactionBrief): string[] {
    const head = `${b.cities} 城 · ${b.generals} 将`;
    const ruler = b.ruler
        ? `君主 ${b.ruler}${b.bonus ? ` · ${b.bonus}` : ''}`
        : '无君主（没有武将，守成更难）';
    const nb = b.neighbors.length > 0
        ? `接壤 ${b.neighbors.join('、')}`
        : '四周无敌对势力（开局相对安稳）';
    return [head, ruler, nb];
}
