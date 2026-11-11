import { ProvinceDef } from './Types';

/**
 * 省份静态表（194 年群雄割据）—— 真实地理版
 *
 * 坐标取自各城池的真实经纬度，经 core/Geo.ts 投影到屏幕坐标。
 * 相邻关系（borders）**显式声明**，依据真实地理接壤与史书记载的用兵路线，
 * 不再由网格几何推导——这样城池能摆在真实位置上，而不会被格子绑死。
 *
 * ⚠ 铁律：**不能越过中间还有城的直达**。玩家看到 A 与 B 之间隔着 C，
 * 就绝不应该能从 A 直接打 B；这类连接要拆成 A-C、C-B 两段。
 * 历史上已删掉「襄阳-长沙（隔江陵）」「姑臧-天水（隔金城）」两条，
 * `tools/sim-routes.ts` 会按几何距离守住这条规则，别再补回去。
 *
 * 州郡划分参照东汉十三州：幽州、冀州、并州、凉州、司隶、兖州、豫州、
 * 徐州、青州、荆州、扬州、益州、交州。
 */
export const PROVINCES: ProvinceDef[] = [
    // ================= 幽州 =================
    {
        id: 'xiangping', name: '襄平', lat: 41.27, lon: 123.17,
        city: true, pop: 16, fort: 2, region: '幽州',
        borders: ['beiping'],
    },
    {
        id: 'beiping', name: '北平', lat: 39.90, lon: 119.30,
        city: false, pop: 19, fort: 2, region: '幽州',
        borders: ['xiangping', 'ji', 'nanpi'],
    },
    {
        id: 'ji', name: '蓟', lat: 39.90, lon: 116.40,
        city: true, pop: 24, fort: 3, region: '幽州',
        borders: ['beiping', 'zhongshan', 'nanpi'],
    },

    // ================= 冀州 =================
    {
        id: 'zhongshan', name: '中山', lat: 38.52, lon: 114.99,
        city: false, pop: 21, fort: 2, region: '冀州',
        borders: ['ji', 'nanpi', 'ye', 'jinyang'],
    },
    {
        id: 'nanpi', name: '南皮', lat: 38.03, lon: 116.70,
        city: false, pop: 23, fort: 2, region: '冀州',
        borders: ['ji', 'beiping', 'zhongshan', 'ye', 'beihai'],
    },
    {
        id: 'ye', name: '邺', lat: 36.55, lon: 114.45,
        city: true, pop: 36, fort: 4, region: '冀州',
        borders: ['zhongshan', 'nanpi', 'jinyang', 'puyang', 'luoyang'],
    },
    {
        id: 'beihai', name: '北海', lat: 36.71, lon: 119.10,
        city: false, pop: 20, fort: 2, region: '青州',
        borders: ['nanpi', 'langya', 'puyang'],
    },

    // ================= 并州 =================
    {
        id: 'jinyang', name: '晋阳', lat: 37.87, lon: 112.55,
        city: true, pop: 22, fort: 3, region: '并州',
        borders: ['zhongshan', 'ye', 'yunzhong', 'shuofang', 'luoyang'],
    },
    {
        id: 'yunzhong', name: '云中', lat: 40.80, lon: 111.70,
        city: false, pop: 13, fort: 1, region: '并州',
        borders: ['jinyang', 'shuofang'],
    },

    // ================= 凉州 =================
    {
        id: 'shuofang', name: '朔方', lat: 38.47, lon: 106.27,
        city: false, pop: 11, fort: 1, region: '凉州',
        borders: ['yunzhong', 'jinyang', 'guzang', 'jincheng'],
    },
    {
        id: 'guzang', name: '姑臧', lat: 37.93, lon: 102.63,
        city: true, pop: 19, fort: 2, region: '凉州',
        // 不再直连天水：金城正挡在中间，改走 姑臧→金城→天水
        borders: ['shuofang', 'jincheng'],
    },
    {
        id: 'jincheng', name: '金城', lat: 36.06, lon: 103.83,
        city: false, pop: 12, fort: 1, region: '凉州',
        borders: ['guzang', 'shuofang', 'tianshui'],
    },
    {
        id: 'tianshui', name: '天水', lat: 34.58, lon: 105.72,
        city: false, pop: 14, fort: 1, region: '凉州',
        // 对称移除姑臧，保留 金城→天水
        borders: ['jincheng', 'changan', 'hanzhong'],
    },

    // ================= 司隶 =================
    {
        id: 'changan', name: '长安', lat: 34.27, lon: 108.94,
        city: true, pop: 30, fort: 4, region: '司隶',
        borders: ['tianshui', 'hanzhong', 'luoyang'],
    },
    {
        id: 'luoyang', name: '洛阳', lat: 34.62, lon: 112.45,
        city: true, pop: 32, fort: 4, region: '司隶',
        borders: ['changan', 'ye', 'jinyang', 'xuchang', 'wan'],
    },

    // ================= 兖州 / 豫州 =================
    {
        id: 'puyang', name: '濮阳', lat: 35.40, lon: 115.25,
        city: false, pop: 24, fort: 3, region: '兖州',
        borders: ['ye', 'beihai', 'langya', 'qiao', 'xuchang'],
    },
    {
        id: 'xuchang', name: '许昌', lat: 33.95, lon: 113.85,
        city: true, pop: 28, fort: 3, region: '豫州',
        borders: ['luoyang', 'puyang', 'qiao', 'wan'],
    },
    {
        id: 'qiao', name: '谯', lat: 33.87, lon: 115.78,
        city: false, pop: 18, fort: 2, region: '豫州',
        borders: ['puyang', 'xuchang', 'xiapi', 'shouchun'],
    },

    // ================= 徐州 =================
    {
        id: 'langya', name: '琅琊', lat: 35.45, lon: 118.70,
        city: false, pop: 21, fort: 2, region: '徐州',
        borders: ['beihai', 'puyang', 'xiapi'],
    },
    {
        id: 'xiapi', name: '下邳', lat: 34.20, lon: 118.00,
        city: true, pop: 26, fort: 3, region: '徐州',
        borders: ['langya', 'qiao', 'guangling', 'shouchun'],
    },
    {
        id: 'guangling', name: '广陵', lat: 32.55, lon: 120.20,
        city: false, pop: 19, fort: 2, region: '徐州',
        borders: ['xiapi', 'jianye'],
    },

    // ================= 荆州 =================
    {
        id: 'hanzhong', name: '汉中', lat: 33.07, lon: 107.03,
        city: true, pop: 20, fort: 4, region: '荆州',
        borders: ['tianshui', 'changan', 'wan', 'chengdu'],
    },
    {
        id: 'wan', name: '宛', lat: 33.20, lon: 112.35,
        city: true, pop: 23, fort: 2, region: '荆州',
        borders: ['luoyang', 'xuchang', 'hanzhong', 'xiangyang'],
    },
    {
        id: 'xiangyang', name: '襄阳', lat: 32.04, lon: 112.14,
        city: true, pop: 31, fort: 4, region: '荆州',
        // 不再直连长沙：江陵正挡在中间，改走 襄阳→江陵→长沙
        borders: ['wan', 'jiangling', 'shouchun'],
    },
    {
        id: 'jiangling', name: '江陵', lat: 30.35, lon: 112.19,
        city: false, pop: 22, fort: 3, region: '荆州',
        borders: ['xiangyang', 'changsha', 'jiangzhou'],
    },
    {
        id: 'changsha', name: '长沙', lat: 28.23, lon: 112.94,
        city: false, pop: 22, fort: 2, region: '荆州',
        // 对称移除襄阳，保留 江陵→长沙
        borders: ['jiangling', 'shouchun', 'guiyang'],
    },

    // ================= 扬州 =================
    {
        id: 'shouchun', name: '寿春', lat: 32.58, lon: 116.78,
        city: true, pop: 26, fort: 3, region: '扬州',
        borders: ['qiao', 'xiapi', 'xiangyang', 'changsha', 'jianye'],
    },
    {
        id: 'jianye', name: '建业', lat: 32.06, lon: 118.80,
        city: true, pop: 27, fort: 3, region: '扬州',
        borders: ['guangling', 'shouchun', 'kuaiji'],
    },
    {
        id: 'kuaiji', name: '会稽', lat: 30.00, lon: 120.58,
        city: false, pop: 19, fort: 2, region: '扬州',
        borders: ['jianye', 'nanhai'],
    },

    // ================= 益州 =================
    {
        id: 'chengdu', name: '成都', lat: 30.57, lon: 104.07,
        city: true, pop: 38, fort: 4, region: '益州',
        borders: ['hanzhong', 'jiangzhou', 'jianning'],
    },
    {
        id: 'jiangzhou', name: '江州', lat: 29.56, lon: 106.55,
        city: false, pop: 20, fort: 2, region: '益州',
        borders: ['chengdu', 'jiangling', 'jianning'],
    },
    {
        id: 'jianning', name: '建宁', lat: 24.88, lon: 102.83,
        city: false, pop: 11, fort: 1, region: '益州',
        borders: ['chengdu', 'jiangzhou', 'jiaozhi'],
    },

    // ================= 交州 =================
    {
        id: 'guiyang', name: '桂阳', lat: 25.77, lon: 113.02,
        city: false, pop: 13, fort: 1, region: '交州',
        borders: ['changsha', 'nanhai'],
    },
    {
        id: 'nanhai', name: '南海', lat: 23.13, lon: 113.26,
        city: false, pop: 15, fort: 1, region: '交州',
        borders: ['guiyang', 'kuaiji', 'jiaozhi'],
    },
    {
        id: 'jiaozhi', name: '交趾', lat: 21.03, lon: 105.85,
        city: false, pop: 12, fort: 1, region: '交州',
        borders: ['jianning', 'nanhai'],
    },
];

export const PROVINCE_MAP: Record<string, ProvinceDef> = (() => {
    const m: Record<string, ProvinceDef> = {};
    for (const p of PROVINCES) {
        m[p.id] = p;
    }
    return m;
})();

/** 初始归属：省份 id -> 势力 id */
export const INITIAL_OWNER: Record<string, string> = {
    // 公孙度 — 辽东
    xiangping: 'gongsun_du',

    // 公孙瓒 — 幽州
    beiping: 'gongsun_zan',
    ji: 'gongsun_zan',

    // 袁绍 — 冀州、并州
    zhongshan: 'yuan_shao',
    nanpi: 'yuan_shao',
    ye: 'yuan_shao',
    jinyang: 'yuan_shao',
    yunzhong: 'yuan_shao',

    // 孔融 — 青州
    beihai: 'kongrong',

    // 马腾 — 凉州
    shuofang: 'mateng',
    guzang: 'mateng',
    jincheng: 'mateng',
    tianshui: 'mateng',

    // 李傕 — 长安
    changan: 'lijue',

    // 曹操 — 中原
    luoyang: 'cao',
    xuchang: 'cao',
    qiao: 'cao',

    // 吕布 — 濮阳
    puyang: 'lvbu',

    // 刘备 — 徐州
    langya: 'liu',
    xiapi: 'liu',
    guangling: 'liu',

    // 张鲁 — 汉中
    hanzhong: 'zhanglu',

    // 张绣 — 宛
    wan: 'zhangxiu',

    // 刘表 — 荆州
    xiangyang: 'liubiao',
    jiangling: 'liubiao',
    changsha: 'liubiao',

    // 袁术 — 淮南
    shouchun: 'yuanshu',

    // 孙策 — 江东
    jianye: 'sun',
    kuaiji: 'sun',

    // 刘璋 — 益州
    chengdu: 'liuzhang',
    jiangzhou: 'liuzhang',
    jianning: 'liuzhang',

    // 士燮 — 交州
    guiyang: 'shixie',
    nanhai: 'shixie',
    jiaozhi: 'shixie',
};
