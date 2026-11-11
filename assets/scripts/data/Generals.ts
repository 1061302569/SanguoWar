import { GeneralDef } from './Types';

/**
 * 武将表
 * atk / def 为 1-10 的等级，直接影响部队攻防倍率。
 */
export const GENERALS: GeneralDef[] = [
    // ---------- 曹操 ----------
    { id: 'cao_cao', name: '曹操', faction: 'cao', atk: 9, def: 8 },
    { id: 'xiahou_dun', name: '夏侯惇', faction: 'cao', atk: 8, def: 8 },
    { id: 'xiahou_yuan', name: '夏侯渊', faction: 'cao', atk: 9, def: 6 },
    { id: 'cao_ren', name: '曹仁', faction: 'cao', atk: 7, def: 9 },
    { id: 'dianwei', name: '典韦', faction: 'cao', atk: 10, def: 6 },
    { id: 'xunyu', name: '荀彧', faction: 'cao', atk: 4, def: 7 },

    // ---------- 刘备 ----------
    { id: 'liu_bei', name: '刘备', faction: 'liu', atk: 8, def: 8 },
    { id: 'guan_yu', name: '关羽', faction: 'liu', atk: 10, def: 8 },
    { id: 'zhang_fei', name: '张飞', faction: 'liu', atk: 10, def: 7 },
    { id: 'zhao_yun', name: '赵云', faction: 'liu', atk: 10, def: 8 },
    { id: 'mi_zhu', name: '糜竺', faction: 'liu', atk: 3, def: 5 },

    // ---------- 孙策 ----------
    { id: 'sun_ce', name: '孙策', faction: 'sun', atk: 10, def: 7 },
    { id: 'zhou_yu', name: '周瑜', faction: 'sun', atk: 9, def: 9 },
    { id: 'taishi_ci', name: '太史慈', faction: 'sun', atk: 9, def: 7 },
    { id: 'cheng_pu', name: '程普', faction: 'sun', atk: 7, def: 8 },
    { id: 'huang_gai', name: '黄盖', faction: 'sun', atk: 8, def: 7 },

    // ---------- 袁绍 ----------
    { id: 'yuan_shao_g', name: '袁绍', faction: 'yuan_shao', atk: 6, def: 6 },
    { id: 'yan_liang', name: '颜良', faction: 'yuan_shao', atk: 9, def: 6 },
    { id: 'wen_chou', name: '文丑', faction: 'yuan_shao', atk: 9, def: 6 },
    { id: 'zhang_he', name: '张郃', faction: 'yuan_shao', atk: 9, def: 7 },
    { id: 'tian_feng', name: '田丰', faction: 'yuan_shao', atk: 5, def: 8 },

    // ---------- 吕布 ----------
    { id: 'lv_bu', name: '吕布', faction: 'lvbu', atk: 10, def: 7 },
    { id: 'chen_gong', name: '陈宫', faction: 'lvbu', atk: 6, def: 8 },
    { id: 'gao_shun', name: '高顺', faction: 'lvbu', atk: 9, def: 8 },

    // ---------- 公孙瓒 ----------
    { id: 'gongsun_zan_g', name: '公孙瓒', faction: 'gongsun_zan', atk: 8, def: 6 },
    { id: 'yan_gang', name: '严纲', faction: 'gongsun_zan', atk: 7, def: 6 },

    // ---------- 公孙度 ----------
    { id: 'gongsun_du_g', name: '公孙度', faction: 'gongsun_du', atk: 6, def: 7 },

    // ---------- 孔融 ----------
    { id: 'kong_rong', name: '孔融', faction: 'kongrong', atk: 4, def: 6 },
    { id: 'wu_anguo', name: '武安国', faction: 'kongrong', atk: 7, def: 6 },

    // ---------- 李傕 ----------
    { id: 'li_jue', name: '李傕', faction: 'lijue', atk: 8, def: 6 },
    { id: 'guo_si', name: '郭汜', faction: 'lijue', atk: 7, def: 6 },

    // ---------- 张鲁 ----------
    { id: 'zhang_lu', name: '张鲁', faction: 'zhanglu', atk: 5, def: 8 },
    { id: 'zhang_wei', name: '张卫', faction: 'zhanglu', atk: 7, def: 7 },

    // ---------- 张绣 ----------
    { id: 'zhang_xiu', name: '张绣', faction: 'zhangxiu', atk: 8, def: 7 },
    { id: 'hu_cheer', name: '胡车儿', faction: 'zhangxiu', atk: 8, def: 6 },

    // ---------- 刘表 ----------
    { id: 'liu_biao', name: '刘表', faction: 'liubiao', atk: 4, def: 7 },
    { id: 'huang_zu', name: '黄祖', faction: 'liubiao', atk: 6, def: 7 },
    { id: 'cai_mao', name: '蔡瑁', faction: 'liubiao', atk: 6, def: 6 },

    // ---------- 袁术 ----------
    { id: 'yuan_shu', name: '袁术', faction: 'yuanshu', atk: 5, def: 5 },
    { id: 'ji_ling', name: '纪灵', faction: 'yuanshu', atk: 8, def: 6 },

    // ---------- 刘璋 ----------
    { id: 'liu_zhang', name: '刘璋', faction: 'liuzhang', atk: 3, def: 5 },
    { id: 'zhang_ren', name: '张任', faction: 'liuzhang', atk: 8, def: 8 },
    { id: 'yan_yan', name: '严颜', faction: 'liuzhang', atk: 8, def: 7 },

    // ---------- 马腾 ----------
    { id: 'ma_teng', name: '马腾', faction: 'mateng', atk: 8, def: 7 },
    { id: 'ma_chao', name: '马超', faction: 'mateng', atk: 10, def: 7 },
    { id: 'pang_de', name: '庞德', faction: 'mateng', atk: 9, def: 7 },

    // ---------- 士燮 ----------
    { id: 'shi_xie', name: '士燮', faction: 'shixie', atk: 4, def: 6 },
    { id: 'shi_hui', name: '士徽', faction: 'shixie', atk: 5, def: 5 },
];

export const GENERAL_MAP: Record<string, GeneralDef> = (() => {
    const m: Record<string, GeneralDef> = {};
    for (const g of GENERALS) {
        m[g.id] = g;
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
