/**
 * 回归：上线增长 P2 —— 「明天还回来」
 *
 * P1 解决的是「第一次进来知道干什么、赢完有得晒」。P2 要解决的是
 * 「今天关掉之后，明天为什么还开」：
 *   - 成就图鉴：跨对局的长期目标，覆盖不同玩法（收降 / 仁义 / 铁壁 /
 *     绝地翻盘 / 换剧本 / 每日挑战），不是「只有赢才解锁」；
 *   - 每日挑战：固定剧本 + 固定势力 + 固定种子，同一天所有人同一局面，
 *     比的是决策而不是肝度。
 *
 * 本测试守住的工程红线：
 *   1) 成就判定只看「已经发生的事实」+ 记录前档案，不发任何资源；
 *   2) 判定顺序不能反：先算 unlockedBy 再写档案，否则「累计 10 局」永远差一局；
 *   3) 每日挑战的种子由日期纯函数推导，读档 / 换设备 / 隔天都能重算；
 *   4) 存档仍不升版本：daily 是可选字段，脏值回退成普通局；
 *   5) 档案只保留「今天」的挑战记录，跨天整条替换，不无限膨胀。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-achievement.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-achievement.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';
import { SCENARIOS } from '../assets/scripts/data/Scenarios.ts';
import {
    ACHIEVEMENTS, AchievementDef, RunResult, PlayerProfile, RunStats,
    defaultProfile, sanitizeProfile, recordResult, unlockedBy, achievementLine,
    dailyKeyOf, dailyChallengeOf, makeSeededRandom, dailyLine, recordDaily,
    dayDiff, isDateKey, PROFILE_VERSION,
} from '../assets/scripts/core/Profile.ts';

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string): void {
    if (ok) {
        pass++;
        console.log(`  ok   ${label}`);
    } else {
        fail++;
        console.log(`  FAIL ${label}`);
    }
}
function section(t: string): void {
    console.log(`\n== ${t} ==`);
}

/** 固定随机源：构造状态时不受真实随机影响 */
function fresh(seed = 20241113): GameState {
    let s = seed;
    setRandom(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    });
    return new GameState();
}

function stats(over: Partial<RunStats> = {}): RunStats {
    return {
        openingCities: 3,
        captures: 10,
        losses: 2,
        persuaded: 1,
        released: 2,
        maxCities: 20,
        ...over,
    };
}

function result(over: Partial<RunResult> = {}): RunResult {
    return {
        win: true,
        faction: '曹操',
        scenario: '群雄割据',
        scenarioId: 'qunxiong_194',
        turns: 19,
        cities: 35,
        total: 35,
        stats: stats(),
        ...over,
    };
}

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
    return { ...defaultProfile(), ...over };
}

function ids(list: AchievementDef[]): string[] {
    return list.map((a) => a.id);
}

function unlocked(over: Partial<RunResult>, p: PlayerProfile = profile()): string[] {
    return ids(unlockedBy(result(over), p));
}

// ----------------------------------------------------------------------
console.log('成就图鉴 + 每日挑战回归\n');

section('1. 成就定义：数量、唯一性、可读性');

check(ACHIEVEMENTS.length >= 10,
    `成就数量 ${ACHIEVEMENTS.length} 条（够撑起一本图鉴）`);
const idSet = new Set(ACHIEVEMENTS.map((a) => a.id));
check(idSet.size === ACHIEVEMENTS.length, '成就 id 无重复');
check(ACHIEVEMENTS.every((a) => a.name.length > 0 && a.desc.length > 0),
    '每条成就都有名称与描述（图鉴不出现空白行）');
check(ACHIEVEMENTS.every((a) => a.name.length <= 8 && a.desc.length <= 20),
    '名称 ≤ 8 字、描述 ≤ 20 字（600px 行宽放得下，不换行溢出）');
check(achievementLine(defaultProfile()) === `成就 0/${ACHIEVEMENTS.length}`,
    '图鉴摘要从 0 开始计数');

section('2. 成就判定：每条都按事实解锁，不靠运气');

check(unlocked({ stats: stats({ captures: 1 }) }).indexOf('first_blood') >= 0
    && unlocked({ stats: stats({ captures: 0 }) }).indexOf('first_blood') < 0,
'初战告捷：攻占 ≥ 1 城才解锁');
check(unlocked({ win: true }).indexOf('first_win') >= 0
    && unlocked({ win: false }).indexOf('first_win') < 0,
'一统天下：只有胜利解锁');
check(unlocked({ turns: 20 }).indexOf('speed_s') >= 0
    && unlocked({ turns: 21 }).indexOf('speed_s') < 0,
'神速：20 回合内统一（21 回合不算）');
check(unlocked({ turns: 28 }).indexOf('speed_a') >= 0
    && unlocked({ turns: 29 }).indexOf('speed_a') < 0,
'稳健：28 回合内统一（29 回合不算）');
check(unlocked({ stats: stats({ persuaded: 5 }) }).indexOf('persuader') >= 0
    && unlocked({ stats: stats({ persuaded: 4 }) }).indexOf('persuader') < 0,
'折冲樽俎：单局收降 5 人');
check(unlocked({ stats: stats({ released: 10 }) }).indexOf('merciful') >= 0
    && unlocked({ stats: stats({ released: 9 }) }).indexOf('merciful') < 0,
'仁义之师：单局放归 10 人');
check(unlocked({ stats: stats({ losses: 0 }) }).indexOf('iron_wall') >= 0
    && unlocked({ stats: stats({ losses: 1 }) }).indexOf('iron_wall') < 0,
'铁壁无缺：一城不失统一');
check(unlocked({ stats: stats({ losses: 10 }) }).indexOf('comeback') >= 0
    && unlocked({ stats: stats({ losses: 9 }) }).indexOf('comeback') < 0,
'绝地反击：丢城 10 次以上仍统一');

// 遍历群雄：必须「换一个剧本」才解锁，同一个剧本刷第二遍不算
check(unlocked({ scenarioId: 'guandu_200' }, profile({ scenariosWon: ['qunxiong_194'] }))
    .indexOf('two_scenarios') >= 0,
'遍历群雄：已统一过一个剧本，再统一另一个剧本时解锁');
check(unlocked({ scenarioId: 'qunxiong_194' }, profile({ scenariosWon: ['qunxiong_194'] }))
    .indexOf('two_scenarios') < 0,
'遍历群雄：同一个剧本刷第二遍不解锁');
check(unlocked({ scenarioId: 'guandu_200' }, profile({ scenariosWon: [] }))
    .indexOf('two_scenarios') < 0,
'遍历群雄：第一次统一（还没有别的剧本成绩）不解锁');

check(unlocked({ daily: true }).indexOf('daily_first') >= 0
    && unlocked({ daily: false }).indexOf('daily_first') < 0,
'应战：只有每日挑战局解锁');
check(unlocked({ daily: true, turns: 20 }).indexOf('daily_s') >= 0
    && unlocked({ daily: true, turns: 21 }).indexOf('daily_s') < 0
    && unlocked({ daily: false, turns: 18 }).indexOf('daily_s') < 0,
'今日之最：每日挑战 20 回合内统一（普通局不算）');

check(unlocked({}, profile({ plays: 9 })).indexOf('veteran') >= 0
    && unlocked({}, profile({ plays: 8 })).indexOf('veteran') < 0,
'百战老卒：本局是第 10 局时解锁（判定用记录前档案 +1）');

section('3. 解锁不重复：同一成就只进档案一次');

const owned = profile({ achievements: ['first_blood', 'first_win'] });
const again = ids(unlockedBy(result({ win: true }), owned));
check(again.indexOf('first_blood') < 0 && again.indexOf('first_win') < 0,
    '已拥有的成就不再出现在「新解锁」列表里');
check(again.indexOf('speed_s') >= 0, '同一局里其它满足条件的成就照常解锁');

const p0 = profile();
const p1 = recordResult(p0, result());
check(p0.achievements.length === 0,
    'recordResult 是纯函数：不改传进来的档案');
check(p1.achievements.indexOf('first_blood') >= 0
    && p1.achievements.indexOf('first_win') >= 0
    && p1.achievements.indexOf('speed_s') >= 0,
'结算写入成就：初战 / 一统 / 神速 一次进档');
check(p1.scenariosWon.length === 1 && p1.scenariosWon[0] === 'qunxiong_194',
'胜利会把剧本 id 记进 scenariosWon');

const p2 = recordResult(p1, result());
check(p2.achievements.length === p1.achievements.length,
    '同一局结算两次（面板反复打开）成就不会重复累加');
check(p2.plays === 2, '但局数照常累加（面板只会记录一次，这里模拟两次）');

const failRun = result({ win: false, turns: 40, stats: stats({ captures: 3 }) });
const p3 = recordResult(p0, failRun);
check(p3.achievements.indexOf('first_win') < 0
    && p3.achievements.indexOf('first_blood') >= 0,
'输掉也会拿到「初战告捷」：成就不只奖励赢，打不过也不至于零成就');
check(p3.scenariosWon.length === 0, '败局不记 scenariosWon');

section('4. 档案兜底：v1 旧档 / 脏数据 / 越界值');

const oldRaw = { version: 1, plays: 7, wins: 3, bestTurns: 18, tutorialStep: 5 };
const migrated = sanitizeProfile(oldRaw);
check(migrated.plays === 7 && migrated.wins === 3 && migrated.bestTurns === 18,
    'v1 旧档读入后累计成绩原样保留');
check(migrated.achievements.length === 0 && migrated.scenariosWon.length === 0
    && migrated.daily.date === '' && migrated.dailyStreak === 0,
'v1 旧档没有新字段：图鉴与挑战记录从空开始，不报错');
check(migrated.version === PROFILE_VERSION, `档案版本升到 v${PROFILE_VERSION}`);

const dirty = sanitizeProfile({
    version: 2,
    plays: 3,
    wins: 99,
    achievements: ['first_blood', 'first_blood', 42, '', 'x'.repeat(99)],
    scenariosWon: ['a', 'a', null],
    dailyStreak: -5,
    daily: { date: '2026-13-45', bestTurns: 'abc', plays: -2, cleared: 'yes' },
});
check(dirty.wins <= dirty.plays, 'wins 被夹到不超过 plays（脏档不会显示 99 次统一）');
check(dirty.achievements.length === 2, '成就列表去重并丢掉非字符串项');
check(dirty.scenariosWon.length === 1, '剧本列表去重');
check(dirty.dailyStreak === 0, '负数连续天数被夹到 0');
check(dirty.daily.date === '' && dirty.daily.plays === 0 && dirty.daily.cleared === false,
'非法日期 / 负数次数 / 非布尔标记全部回退成空记录');

check(isDateKey('2026-11-13') && !isDateKey('2026-13-45')
    && !isDateKey('2026-1-3') && !isDateKey(''),
'日期键校验：格式与真实日期都要对');
check(dayDiff('2026-11-13', '2026-11-14') === 1
    && dayDiff('2026-11-13', '2026-11-16') === 3
    && dayDiff('2026-11-13', '2026-11-13') === 0,
'日期差按 UTC 天数计算，不受时区影响');

section('5. 每日挑战：同一天同一局面，跨天自动换');

const d1 = new Date(2026, 10, 13, 9, 30);
const d2 = new Date(2026, 10, 13, 23, 50);
check(dailyKeyOf(d1) === '2026-11-13' && dailyKeyOf(d2) === '2026-11-13',
    '本地日期键：同一天的不同时刻算同一天');

const key = '2026-11-13';
const chA = dailyChallengeOf(key, SCENARIOS);
const chB = dailyChallengeOf(key, SCENARIOS);
check(chA.scenarioId === chB.scenarioId && chA.factionId === chB.factionId
    && chA.seed === chB.seed,
'同一天反复计算：剧本 / 势力 / 种子完全一致（可复现）');
check(chA.scenarioId.length > 0 && chA.factionId.length > 0,
    `今日配置：${chA.scenarioId} / ${chA.factionId}`);
check(!!SCENARIOS.find((s) => s.id === chA.scenarioId),
    '选中的剧本真实存在');
const chSc = SCENARIOS.find((s) => s.id === chA.scenarioId)!;
check(chSc.playable.indexOf(chA.factionId) >= 0,
    '选中的势力在该剧本可玩列表里（不会给一个选不了的势力）');
check(chA.seed >= 1 && chA.seed < 0x80000000,
    `种子在合法区间（${chA.seed}）`);

const seeds = new Set<number>();
const scen = new Set<string>();
const fac = new Set<string>();
for (let i = 0; i < 60; i++) {
    const dt = new Date(2026, 10, 1 + i);
    const c = dailyChallengeOf(dailyKeyOf(dt), SCENARIOS);
    seeds.add(c.seed);
    scen.add(c.scenarioId);
    fac.add(c.factionId);
}
check(seeds.size === 60, '60 天里种子无碰撞（每天都是新局面）');
check(scen.size >= 2, `60 天覆盖 ${scen.size} 个剧本（不会天天同一个）`);
check(fac.size >= 2, `60 天覆盖 ${fac.size} 个可玩势力`);

const empty = dailyChallengeOf(key, []);
check(empty.scenarioId === '' && empty.factionId === '' && empty.seed >= 1,
    '剧本池为空时不崩：返回空 id 交给 UI 提示，不抛异常');
check(dailyChallengeOf('坏日期', SCENARIOS).date === '1970-01-01',
    '非法日期键回退到固定值（不会算出随机的今日挑战）');

// 种子发生器必须落在 [0,1)，且同种子可复现
const r1 = makeSeededRandom(chA.seed);
const r2 = makeSeededRandom(chA.seed);
let inRange = true;
let same = true;
for (let i = 0; i < 200; i++) {
    const a = r1();
    const b = r2();
    if (!(a >= 0 && a < 1)) {
        inRange = false;
    }
    if (a !== b) {
        same = false;
    }
}
check(inRange, '固定种子随机数全部落在 [0,1)');
check(same, '同种子两次生成序列完全一致（每日挑战可复现）');
const spread = (() => {
    const g = makeSeededRandom(12345);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 500; i++) {
        const v = g();
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
    }
    return hi - lo;
})();
check(spread > 0.9, `500 次采样覆盖 ${spread.toFixed(2)} 的值域（不是常数序列）`);

section('6. 今日成绩：破纪录才算，跨天重置');

let pd = defaultProfile();
check(dailyLine(pd, key).indexOf('尚未应战') >= 0,
    '没打过时菜单显示「尚未应战」');

pd = recordDaily(pd, key, true, 19);
check(pd.daily.bestTurns === 19 && pd.daily.cleared && pd.daily.plays === 1,
    '首次通关：记录最佳 19 回合');
check(pd.dailyStreak === 1, '首次参与：连续天数 1');
check(dailyLine(pd, key).indexOf('最佳 19 回合') >= 0,
    '菜单摘要显示今日最佳回合数');

const beforeReplay = pd;
pd = recordDaily(pd, key, true, 21);
check(pd.daily.plays === 2 && pd.daily.bestTurns === 19,
    '同日再战更慢：次数 +1，最佳仍是 19');
check(beforeReplay.daily.plays === 1 && beforeReplay.daily.bestTurns === 19,
    'recordDaily 是纯函数：不改传进来的档案');

pd = recordDaily(pd, key, true, 17);
check(pd.daily.bestTurns === 17, '同日刷新纪录：最佳更新为 17');

pd = recordDaily(pd, key, false, 40);
check(pd.daily.bestTurns === 17 && pd.daily.cleared && pd.daily.plays === 4,
    '同日失败：不覆盖最佳，次数照加');

pd = recordDaily(pd, '2026-11-14', false, 12);
check(pd.daily.date === '2026-11-14' && pd.daily.plays === 1
    && pd.daily.bestTurns === 0 && pd.daily.cleared === false,
'跨天：整条记录替换成新的一天（旧成绩不残留）');
check(pd.dailyStreak === 2, '连续第二天参与：连续天数 2');
check(dailyLine(pd, '2026-11-14').indexOf('尚未通关') >= 0,
    '当天失败后菜单显示「尚未通关」，不谎报成绩');

pd = recordDaily(pd, '2026-11-17', true, 18);
check(pd.dailyStreak === 1, '断了两天再来：连续天数重置为 1');

const dirtyKey = recordDaily(pd, '坏日期', true, 10);
check(dirtyKey.daily.date === '2026-11-17',
    '非法日期不会把当天记录改成脏值（沿用上一次合法日期）');

section('7. 存档兼容：daily 标记可选，SAVE_VERSION 不变');

const gs = fresh();
check(gs.dailyDate === '', '新局默认是普通局（dailyDate 为空串）');

gs.dailyDate = '2026-11-13';
const saved = gs.serialize();
check((saved as any).daily === '2026-11-13', 'serialize() 写出每日挑战标记');
check(saved.version === GameState.SAVE_VERSION,
    `SAVE_VERSION 仍是 ${GameState.SAVE_VERSION}（旧档不会被拒绝）`);

const gs2 = fresh();
check(gs2.deserialize(saved) && gs2.dailyDate === '2026-11-13',
    'deserialize() 恢复每日挑战标记');

const legacy = gs.serialize() as any;
delete legacy.daily;
const gs3 = fresh();
check(gs3.deserialize(legacy) && gs3.dailyDate === '',
    '旧档没有 daily 字段：按普通局读入，不报错');

const bad = gs.serialize() as any;
bad.daily = '2026-13-45';
const gs4 = fresh();
check(gs4.deserialize(bad) && gs4.dailyDate === '',
    'daily 是脏值：回退成普通局（不会去更新一个不存在的日期）');

const gs5 = fresh();
gs5.reset();
check(gs5.dailyDate === '', 'reset() 清掉挑战标记（重开不会继承上一局的挑战身份）');

section('8. 源码守卫：UI / 状态层真的接线');

// `node:fs` 必须动态导入，且不能在顶层 await（bundle 后是 CJS）：
// 包一层 async 函数，末尾再统一输出汇总。
async function sourceGuards(): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const state = readFileSync('assets/scripts/core/GameState.ts', 'utf8');
    const prof = readFileSync('assets/scripts/core/Profile.ts', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    check(ui.indexOf("makeRectStroke('AchievePanel'") >= 0
        && ui.indexOf('this.refreshAchieveMenu()') >= 0,
    '成就图鉴面板存在且会刷新内容');
    check(ui.indexOf("makeRectStroke('AchieveBtn'") >= 0
        && ui.indexOf('this.openAchieveMenu()') >= 0,
    '剧本面板有「成就图鉴」入口');
    check(ui.indexOf("makeRectStroke('DailyBtn'") >= 0
        && ui.indexOf('this.startDailyChallenge()') >= 0,
    '剧本面板有「今日挑战」入口');
    check(ui.indexOf('ACHIEVE_PER_PAGE') >= 0
        && ui.indexOf('this.onAchievePage(') >= 0,
    '成就超过一页时可翻页（图鉴不截断）');
    check(ui.indexOf('this.achievePanel.active = false') >= 0,
        '成就面板与其它三个弹窗互斥（不会两层叠在一起）');

    const seeds: Array<[string, string]> = [
        ['applyDailySeed(this.state.dailyDate)', '读档后按局面恢复随机源'],
        ['setRandom(makeSeededRandom(ch.seed))', '每日挑战注入固定种子'],
        ['setRandom(Math.random)', '普通局 / 启动时回到真随机'],
        ['this.state.dailyDate = dailyDate', '新局写入挑战标记（读档才知道是挑战局）'],
    ];
    for (const [needle, label] of seeds) {
        check(ui.indexOf(needle) >= 0, label);
    }

    check(ui.indexOf('unlockedBy(result, this.profile)') >= 0
        && ui.indexOf('recordResult(this.profile, result)') >= 0,
    '结算时先算新解锁、再写档案（顺序反了「累计 10 局」会永远差一局）');
    check(ui.indexOf('recordDaily(') >= 0
        && ui.indexOf('dailyLine(this.profile, st.dailyDate)') >= 0,
    '结算记每日成绩，目标条在挑战局显示今日最佳');
    check(ui.indexOf('this.achievePanel.active = false') >= 0
        && ui.indexOf('fresh.map((a) => a.name).join') >= 0,
    '结算页展示本局新解锁的成就名');

    check(state.indexOf('public dailyDate') >= 0
        && state.indexOf('daily: this.dailyDate') >= 0
        && state.indexOf('isDateKey(data.daily)') >= 0,
    '状态层持有 / 往返 / 校验每日挑战标记');
    check(prof.indexOf('Balance') < 0 && prof.indexOf('gold.set') < 0,
        '档案层不碰 Balance、不发资源：P2 新增的仍只是信息');

    check(readme.indexOf('成就图鉴') >= 0
        && readme.indexOf('每日挑战') >= 0
        && readme.indexOf('固定种子') >= 0,
    'README 公开成就图鉴与每日挑战规则');
}

sourceGuards().then(() => {
    console.log(`\n结果：${fail === 0 ? '全部通过' : '有失败'}（${pass} 通过 / ${pass + fail}）`);
    if (fail > 0) {
        process.exit(1);
    }
});
