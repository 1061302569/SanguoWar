import { FactionDef } from './Types';

/**
 * 势力表（194 年群雄割据）
 *
 * 所有在剧本开局版图里有城的势力都可以执掌，`playable` 只是历史遗留的
 * 「推荐起始势力」标记，不再是白名单；见 Scenarios.selectableFactions()。
 */
export const FACTIONS: FactionDef[] = [
    {
        id: 'cao',
        name: '曹操',
        color: '#3b6bd6',
        desc: '奉天子以令不臣，占据中原沃土。兵精粮足，四面受敌。',
        playable: true,
    },
    {
        id: 'liu',
        name: '刘备',
        color: '#2fae5a',
        desc: '汉室宗亲，仁德布于四海。地狭兵少，却多良将死士。',
        playable: true,
    },
    {
        id: 'sun',
        name: '孙策',
        color: '#e0b12c',
        desc: '江东猛虎，席卷六郡。水乡富庶，可坐断东南。',
        playable: true,
    },
    {
        id: 'yuan_shao',
        name: '袁绍',
        color: '#8b5cf6',
        desc: '四世三公，门生故吏遍天下。带甲十万，雄踞河北。',
        playable: false,
    },
    {
        id: 'lvbu',
        name: '吕布',
        color: '#d9483b',
        desc: '人中吕布，马中赤兔。骁勇无双，然无谋少断。',
        playable: false,
    },
    {
        id: 'gongsun_zan',
        name: '公孙瓒',
        color: '#e8e3d3',
        desc: '白马义从威震塞外，困守幽州一隅。',
        playable: false,
    },
    {
        id: 'gongsun_du',
        name: '公孙度',
        color: '#7f8c8d',
        desc: '割据辽东，远避中原烽火。',
        playable: false,
    },
    {
        id: 'kongrong',
        name: '孔融',
        color: '#16a085',
        desc: '北海相，名士之风，兵微将寡。',
        playable: false,
    },
    {
        id: 'taoqian',
        name: '陶谦',
        color: '#b8a06a',
        desc: '徐州牧，年迈守成，境内富庶。',
        playable: false,
    },
    {
        id: 'yuanshu',
        name: '袁术',
        color: '#c0392b',
        desc: '据淮南而称帝，骄奢自大，众叛亲离。',
        playable: false,
    },
    {
        id: 'liubiao',
        name: '刘表',
        color: '#2d8f8f',
        desc: '荆州牧，坐守荆襄九郡，兵多而无进取之心。',
        playable: false,
    },
    {
        id: 'liuyao',
        name: '刘繇',
        color: '#9b6bb3',
        desc: '扬州刺史，与孙策争夺江东。',
        playable: false,
    },
    {
        id: 'liuzhang',
        name: '刘璋',
        color: '#4a8f3c',
        desc: '益州牧，天府之国，闭关自守。',
        playable: false,
    },
    {
        id: 'zhanglu',
        name: '张鲁',
        color: '#a5763f',
        desc: '五斗米道，据汉中天险。',
        playable: false,
    },
    {
        id: 'mateng',
        name: '马腾',
        color: '#c47b2a',
        desc: '西凉铁骑，纵横雍凉，骑战天下无双。',
        playable: false,
    },
    {
        id: 'lijue',
        name: '李傕',
        color: '#6b6b6b',
        desc: '董卓旧部，挟持天子于长安。',
        playable: false,
    },
    {
        id: 'zhangxiu',
        name: '张绣',
        color: '#5f7d8c',
        desc: '北地枪王，屯兵宛城。',
        playable: false,
    },
    {
        id: 'shixie',
        name: '士燮',
        color: '#3f7a5c',
        desc: '交州士氏，偏安岭南。',
        playable: false,
    },
];

/** 按 id 建立索引 */
export const FACTION_MAP: Record<string, FactionDef> = (() => {
    const m: Record<string, FactionDef> = {};
    for (const f of FACTIONS) {
        m[f.id] = f;
    }
    return m;
})();

/** 中立/无主势力 id */
export const NEUTRAL = 'neutral';
