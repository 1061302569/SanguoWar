import { GeneralDef, GeneralRole, RulerBonusKey } from './Types';

/**
 * 将领表
 *
 * atk / def 为 1-10 的等级，直接影响部队攻防倍率。
 * role 区分武将 / 文官 —— **两类都有忠诚度**，招降规则完全一致，
 * 身份只是让玩家看清抓到的是谁，不给文官开隐藏的成功率后门。
 * ruler 标记势力君主：每个势力最多一人。在位君主不可招降，
 * 但**失去所有城池之后可以招降** —— 基业都没了，就没有「不屈居人下」的资格。
 * loyalty 是开局忠诚度 0~100，史实上死忠的名将给高值、反复易主者给低值。
 *
 * bonus 是君主的**历史定位加成**，一人只给一项，作用范围写在 RulerBonus 的注释里。
 * 一人一项是刻意的：城池面板右栏只有一行位置，多写一条就要么截断、要么藏规则。
 * 想加第二项可以，但得先想清楚 UI 怎么在不撒谎的前提下显示出来。
 */
export const GENERALS: GeneralDef[] = [
    // ---------- 曹操 ----------
    // 唯才是举：降将照用不误（张辽、张郃、臧霸都是降臣），招降成功率 +15%
    { id: 'cao_cao', name: '曹操', faction: 'cao', atk: 9, def: 8, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '唯才是举', persuade: 0.15 } },
    { id: 'xiahou_dun', name: '夏侯惇', faction: 'cao', atk: 8, def: 8, role: 'military', loyalty: 95 },
    { id: 'xiahou_yuan', name: '夏侯渊', faction: 'cao', atk: 9, def: 6, role: 'military', loyalty: 92 },
    { id: 'cao_ren', name: '曹仁', faction: 'cao', atk: 7, def: 9, role: 'military', loyalty: 93 },
    { id: 'dianwei', name: '典韦', faction: 'cao', atk: 10, def: 6, role: 'military', loyalty: 98 },
    { id: 'xunyu', name: '荀彧', faction: 'cao', atk: 4, def: 7, role: 'civil', loyalty: 90 },

    // ---------- 刘备 ----------
    // 仁德：以人为本，百姓归附，粮草 +20%
    { id: 'liu_bei', name: '刘备', faction: 'liu', atk: 8, def: 8, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '仁德', food: 0.2 } },
    { id: 'guan_yu', name: '关羽', faction: 'liu', atk: 10, def: 8, role: 'military', loyalty: 100 },
    { id: 'zhang_fei', name: '张飞', faction: 'liu', atk: 10, def: 7, role: 'military', loyalty: 98 },
    { id: 'zhao_yun', name: '赵云', faction: 'liu', atk: 10, def: 8, role: 'military', loyalty: 96 },
    { id: 'mi_zhu', name: '糜竺', faction: 'liu', atk: 3, def: 5, role: 'civil', loyalty: 88 },

    // ---------- 孙策 ----------
    // 小霸王：亲冒矢石、先登陷阵，进攻 +20%
    { id: 'sun_ce', name: '孙策', faction: 'sun', atk: 10, def: 7, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '小霸王', atk: 0.2 } },
    { id: 'zhou_yu', name: '周瑜', faction: 'sun', atk: 9, def: 9, role: 'military', loyalty: 95 },
    { id: 'taishi_ci', name: '太史慈', faction: 'sun', atk: 9, def: 7, role: 'military', loyalty: 88 },
    { id: 'cheng_pu', name: '程普', faction: 'sun', atk: 7, def: 8, role: 'military', loyalty: 92 },
    { id: 'huang_gai', name: '黄盖', faction: 'sun', atk: 8, def: 7, role: 'military', loyalty: 94 },

    // ---------- 袁绍 ----------
    // 四世三公：门生故吏遍天下，赋税易收，金币 +20%
    { id: 'yuan_shao_g', name: '袁绍', faction: 'yuan_shao', atk: 6, def: 6, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '四世三公', gold: 0.2 } },
    { id: 'yan_liang', name: '颜良', faction: 'yuan_shao', atk: 9, def: 6, role: 'military', loyalty: 80 },
    { id: 'wen_chou', name: '文丑', faction: 'yuan_shao', atk: 9, def: 6, role: 'military', loyalty: 78 },
    { id: 'zhang_he', name: '张郃', faction: 'yuan_shao', atk: 9, def: 7, role: 'military', loyalty: 65 },
    { id: 'tian_feng', name: '田丰', faction: 'yuan_shao', atk: 5, def: 8, role: 'civil', loyalty: 85 },

    // ---------- 吕布 ----------
    // 飞将：并州铁骑冲阵，进攻 +25%（全表最高的单项加成）
    { id: 'lv_bu', name: '吕布', faction: 'lvbu', atk: 10, def: 7, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '飞将', atk: 0.25 } },
    { id: 'chen_gong', name: '陈宫', faction: 'lvbu', atk: 6, def: 8, role: 'civil', loyalty: 80 },
    { id: 'gao_shun', name: '高顺', faction: 'lvbu', atk: 9, def: 8, role: 'military', loyalty: 95 },

    // ---------- 公孙瓒 ----------
    // 白马义从：轻骑突袭，进攻 +15%
    { id: 'gongsun_zan_g', name: '公孙瓒', faction: 'gongsun_zan', atk: 8, def: 6, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '白马义从', atk: 0.15 } },
    { id: 'yan_gang', name: '严纲', faction: 'gongsun_zan', atk: 7, def: 6, role: 'military', loyalty: 85 },

    // ---------- 公孙度 ----------
    // 辽东自守：偏安一隅、据险不出，防御 +20%
    { id: 'gongsun_du_g', name: '公孙度', faction: 'gongsun_du', atk: 6, def: 7, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '辽东自守', def: 0.2 } },

    // ---------- 孔融 ----------
    // 座上客满：座上客常满、樽中酒不空，名士来投，招降 +10%
    { id: 'kong_rong', name: '孔融', faction: 'kongrong', atk: 4, def: 6, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '座上客满', persuade: 0.1 } },
    { id: 'wu_anguo', name: '武安国', faction: 'kongrong', atk: 7, def: 6, role: 'military', loyalty: 80 },

    // ---------- 李傕 ----------
    // 西凉悍卒：凉州兵剽悍，进攻 +15%
    { id: 'li_jue', name: '李傕', faction: 'lijue', atk: 8, def: 6, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '西凉悍卒', atk: 0.15 } },
    { id: 'guo_si', name: '郭汜', faction: 'lijue', atk: 7, def: 6, role: 'military', loyalty: 70 },

    // ---------- 张鲁 ----------
    // 五斗米道：义舍米肉、境内丰足，粮草 +20%
    { id: 'zhang_lu', name: '张鲁', faction: 'zhanglu', atk: 5, def: 8, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '五斗米道', food: 0.2 } },
    { id: 'zhang_wei', name: '张卫', faction: 'zhanglu', atk: 7, def: 7, role: 'military', loyalty: 85 },

    // ---------- 张绣 ----------
    // 北地枪王：西凉枪骑，进攻 +15%
    { id: 'zhang_xiu', name: '张绣', faction: 'zhangxiu', atk: 8, def: 7, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '北地枪王', atk: 0.15 } },
    { id: 'hu_cheer', name: '胡车儿', faction: 'zhangxiu', atk: 8, def: 6, role: 'military', loyalty: 80 },

    // ---------- 刘表 ----------
    // 荆襄富庶：带甲十万、财谷自足，金币 +20%
    { id: 'liu_biao', name: '刘表', faction: 'liubiao', atk: 4, def: 7, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '荆襄富庶', gold: 0.2 } },
    { id: 'huang_zu', name: '黄祖', faction: 'liubiao', atk: 6, def: 7, role: 'military', loyalty: 80 },
    { id: 'cai_mao', name: '蔡瑁', faction: 'liubiao', atk: 6, def: 6, role: 'military', loyalty: 55 },

    // ---------- 袁术 ----------
    // 淮南殷富：户口中盛、粮道充足，金币 +15%
    { id: 'yuan_shu', name: '袁术', faction: 'yuanshu', atk: 5, def: 5, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '淮南殷富', gold: 0.15 } },
    { id: 'ji_ling', name: '纪灵', faction: 'yuanshu', atk: 8, def: 6, role: 'military', loyalty: 75 },

    // ---------- 刘璋 ----------
    // 天府之国：沃野千里、水旱从人，粮草 +25%
    { id: 'liu_zhang', name: '刘璋', faction: 'liuzhang', atk: 3, def: 5, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '天府之国', food: 0.25 } },
    { id: 'zhang_ren', name: '张任', faction: 'liuzhang', atk: 8, def: 8, role: 'military', loyalty: 95 },
    { id: 'yan_yan', name: '严颜', faction: 'liuzhang', atk: 8, def: 7, role: 'military', loyalty: 88 },

    // ---------- 马腾 ----------
    // 西凉铁骑：羌胡骑兵，进攻 +20%
    { id: 'ma_teng', name: '马腾', faction: 'mateng', atk: 8, def: 7, role: 'military', ruler: true, loyalty: 100,
        bonus: { title: '西凉铁骑', atk: 0.2 } },
    { id: 'ma_chao', name: '马超', faction: 'mateng', atk: 10, def: 7, role: 'military', loyalty: 90 },
    { id: 'pang_de', name: '庞德', faction: 'mateng', atk: 9, def: 7, role: 'military', loyalty: 85 },

    // ---------- 士燮 ----------
    // 交州偏安：南海珍宝、市舶之利，金币 +15%
    { id: 'shi_xie', name: '士燮', faction: 'shixie', atk: 4, def: 6, role: 'civil', ruler: true, loyalty: 100,
        bonus: { title: '交州偏安', gold: 0.15 } },
    { id: 'shi_hui', name: '士徽', faction: 'shixie', atk: 5, def: 5, role: 'military', loyalty: 70 },
];

export const GENERAL_MAP: Record<string, GeneralDef> = (() => {
    const m: Record<string, GeneralDef> = {};
    for (const g of GENERALS) {
        m[g.id] = g;
    }
    return m;
})();

/** 身份中文名（面板 / 战报共用一处） */
export const ROLE_NAME: Record<GeneralRole, string> = {
    military: '武将',
    civil: '文官',
};

/**
 * 君主加成的显示顺序与单字名。
 *
 * UI 按这张表拼「攻+20% 金+15%」，不各写一套 if：
 * 以后给某个君主加第二项加成，面板会自动多显示一项，不用改 UI。
 */
export const BONUS_KIND: Array<{ key: RulerBonusKey; name: string }> = [
    { key: 'atk', name: '攻' },
    { key: 'def', name: '守' },
    { key: 'gold', name: '金' },
    { key: 'food', name: '粮' },
    { key: 'persuade', name: '降' },
];

/**
 * 势力 id -> 君主武将 id。
 *
 * 从将领表自动生成，不在 Factions.ts 里再写一份，避免出现两个真相源。
 * 陶谦、刘繇这两个势力在 194 剧本没有将领，因此没有君主，UI 显示「君 —」。
 */
export const RULER_OF: Record<string, string> = (() => {
    const m: Record<string, string> = {};
    for (const g of GENERALS) {
        if (g.ruler) {
            m[g.faction] = g.id;
        }
    }
    return m;
})();

/** 各势力初始驻守的武将分配：武将 id -> 省份 id */
export const INITIAL_GENERAL_POST: Record<string, string> = {
    // 曹操
    cao_cao: 'luoyang',
    xiahou_dun: 'luoyang',
    dianwei: 'luoyang',
    xunyu: 'xuchang',
    cao_ren: 'xuchang',
    xiahou_yuan: 'qiao',

    // 刘备
    liu_bei: 'xiapi',
    guan_yu: 'xiapi',
    zhang_fei: 'xiapi',
    zhao_yun: 'langya',
    mi_zhu: 'guangling',

    // 孙策
    sun_ce: 'jianye',
    zhou_yu: 'jianye',
    cheng_pu: 'jianye',
    taishi_ci: 'kuaiji',
    huang_gai: 'kuaiji',

    // 袁绍
    yuan_shao_g: 'ye',
    yan_liang: 'ye',
    wen_chou: 'ye',
    zhang_he: 'nanpi',
    tian_feng: 'zhongshan',

    // 吕布
    lv_bu: 'puyang',
    chen_gong: 'puyang',
    gao_shun: 'puyang',

    // 公孙瓒
    gongsun_zan_g: 'ji',
    yan_gang: 'beiping',

    // 公孙度
    gongsun_du_g: 'xiangping',

    // 孔融
    kong_rong: 'beihai',
    wu_anguo: 'beihai',

    // 李傕
    li_jue: 'changan',
    guo_si: 'changan',

    // 张鲁
    zhang_lu: 'hanzhong',
    zhang_wei: 'hanzhong',

    // 张绣
    zhang_xiu: 'wan',
    hu_cheer: 'wan',

    // 刘表
    liu_biao: 'xiangyang',
    cai_mao: 'xiangyang',
    huang_zu: 'jiangling',

    // 袁术
    yuan_shu: 'shouchun',
    ji_ling: 'shouchun',

    // 刘璋
    liu_zhang: 'chengdu',
    zhang_ren: 'jiangzhou',
    yan_yan: 'jianning',

    // 马腾
    ma_teng: 'guzang',
    ma_chao: 'tianshui',
    pang_de: 'jincheng',

    // 士燮
    shi_xie: 'guiyang',
    shi_hui: 'jianning',
};
