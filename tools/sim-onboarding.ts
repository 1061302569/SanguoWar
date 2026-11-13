/**
 * 回归：上线增长 P1 —— 「首次体验 → 目标感 → 炫耀 → 回来再玩」
 *
 * 这一轮不动任何平衡数值。二次试玩已经证明发奖励 / 改保护期会把
 * 18~21 回合的节奏推坏，所以新增的正反馈一律只是「信息」：
 *   - 任务式引导：玩家真的做完一步才推进，不弹遮罩、不拦截点击；
 *   - 阶段目标：把一局 18~40 回合切成「立足 / 破局 / 问鼎」三段；
 *   - 局外档案：独立存档 key，跨对局保留统一次数与最快回合；
 *   - 本局战绩：攻占 / 丢城 / 收降 / 放归 / 最大版图；
 *   - 战绩结算 + 分享理由：可比较的「你能几回合？」。
 *
 * 本测试同时守住几条工程红线：
 *   1) SAVE_VERSION 仍是 1，旧档缺 stats 时按当前局面重建；
 *   2) 局面存档照旧会被新开一局清掉，累计档案走独立 key 不受影响；
 *   3) 结算面板可能被反复打开，档案只能记一次；
 *   4) UI 五根引导线、目标条、分享按钮、动态分享文案全部真的接线。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-onboarding.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-onboarding.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';
import { FACTIONS, FACTION_MAP, NEUTRAL } from '../assets/scripts/data/Factions.ts';
import { ProvinceState } from '../assets/scripts/data/Types.ts';
import {
    PROFILE_KEY, PROFILE_VERSION, TUTORIAL_STEPS, OBJECTIVE_IDS, OBJECTIVE_NAMES,
    defaultProfile, sanitizeProfile, emptyStats, sanitizeStats, objectiveTargets,
    objectivesOf, objectiveLevel, tutorialLine, objectiveLines, gradeOf,
    shareTextOf, recordResult, profileLine, RunResult,
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

/** 固定随机源：招降 / 生擒 / 战斗噪声全部可复现 */
function fresh(seed = 20241113): GameState {
    let s = seed;
    setRandom(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    });
    return new GameState();
}

function sampleResult(overrides: Partial<RunResult> = {}): RunResult {
    return {
        win: true,
        faction: '曹操',
        scenario: '群雄割据',
        turns: 19,
        cities: 35,
        total: 35,
        stats: {
            openingCities: 3,
            captures: 88,
            losses: 31,
            persuaded: 12,
            released: 40,
            maxCities: 35,
        },
        ...overrides,
    };
}

// ----------------------------------------------------------------------
section('1. 局外档案：默认值与脏数据兜底');
// ----------------------------------------------------------------------
const p0 = defaultProfile();
check(p0.version === PROFILE_VERSION && p0.plays === 0 && p0.wins === 0
    && p0.bestTurns === 0 && p0.tutorialStep === 0
    && p0.objectives.length === 0 && p0.lastResult === '',
'新玩家档案全为 0 / 空，不会一进游戏就显示「已通关」');
check(PROFILE_KEY.indexOf('profile') >= 0 && PROFILE_KEY !== 'sanguowar_save_v1',
    `局外档案使用独立 key（${PROFILE_KEY}），不会被新开一局清掉`);

let badSafe = 0;
for (const raw of [null, undefined, 0, 'oops', [], true]) {
    const p = sanitizeProfile(raw);
    if (p.plays !== 0 || p.wins !== 0 || p.tutorialStep !== 0
        || p.objectives.length !== 0 || p.lastResult !== '') {
        badSafe++;
    }
}
check(badSafe === 0, '任意脏输入都回退到默认档案，绝不因为一条坏字段进不了游戏');

const dirty = sanitizeProfile({
    plays: -9,
    wins: 999,
    bestTurns: Number.NaN,
    tutorialStep: 999,
    objectives: ['ok', 3, null, ''],
    lastResult: 'x'.repeat(500),
});
check(dirty.plays === 0 && dirty.wins === 0 && dirty.bestTurns === 0,
    '负数 / NaN / wins 大于 plays 全部夹到合法区间');
check(dirty.tutorialStep === TUTORIAL_STEPS.length,
    '引导进度夹到步骤总数（不会卡在不存在的第 999 步）');
check(dirty.objectives.length === 1 && dirty.objectives[0] === 'ok'
    && dirty.lastResult.length === 200,
'成就列表过滤脏项，最近战绩文案限长');

const older = sanitizeProfile({ plays: 3, bestTurns: 22, wins: 0 });
check(older.wins === 1 && older.bestTurns === 22,
    '旧版本只记了最快回合时，至少保住 1 次统一纪录');

// ----------------------------------------------------------------------
section('2. 任务式引导与阶段目标：可感知的进展');
// ----------------------------------------------------------------------
check(TUTORIAL_STEPS.length === 5
    && TUTORIAL_STEPS.every((s) => s.text.length > 0 && s.done.length > 0),
`任务式引导 ${TUTORIAL_STEPS.length} 步，每步都有指令与达成反馈`);
check(tutorialLine(0).indexOf('1/5') >= 0
    && tutorialLine(4).indexOf('5/5') >= 0
    && tutorialLine(5) === '' && tutorialLine(-1) === '',
'引导条文案按步数显示，完成后交还给阶段目标');

const t35 = objectiveTargets(35, 3);
check(t35.length === 3 && t35[0] < t35[1] && t35[1] < t35[2] && t35[2] === 35,
    `35 城剧本目标单调递增且终于统一（${t35.join(' / ')}）`);
check(objectiveTargets(3, 5).every((x) => x <= 3)
    && objectiveTargets(1, 0).every((x) => x >= 1 && x <= 1),
'城数很少 / 开局城数大于总城数的边界不产生越界目标');
const objs = objectivesOf(35, 3);
check(objs.length === 3 && objs.every((o, i) => o.id === OBJECTIVE_IDS[i]
    && o.name === OBJECTIVE_NAMES[i] && o.desc.length > 0 && o.target === t35[i]),
'三段目标 id / 名称 / 说明 / 门槛一一对应');
check(objectiveLevel(2, 35, 3) === 0
    && objectiveLevel(t35[0], 35, 3) >= 1
    && objectiveLevel(t35[1], 35, 3) >= 2
    && objectiveLevel(35, 35, 3) === 3,
'阶段目标随城数推进，丢城会回退');
check(objectiveLines(2, 35, 3, p0)[0].indexOf('立足') >= 0
    && objectiveLines(2, 35, 3, p0).length === 2,
'目标条两行：当前进度 + 下一条要做的事');
check(objectiveLines(35, 35, 3, p0)[1].indexOf('累计') >= 0,
'三段全达成后，目标条第二行换成局外档案摘要');

// ----------------------------------------------------------------------
section('3. 评价、分享文案与档案更新（纯函数）');
// ----------------------------------------------------------------------
check(gradeOf(false, 12).indexOf('未竟') >= 0, '败局评价不羞辱玩家，给「再起一局」');
check(gradeOf(true, 20).indexOf('S') >= 0 && gradeOf(true, 21).indexOf('A') >= 0
    && gradeOf(true, 29).indexOf('B') >= 0 && gradeOf(true, 41).indexOf('C') >= 0,
'评价按回合数分档，不按金币存量（不诱导囤钱不打）');

const winText = shareTextOf(sampleResult());
check(winText.indexOf('19 回合') >= 0 && winText.indexOf('88 城') >= 0
    && winText.indexOf('12 人') >= 0 && winText.indexOf('你能几回合') >= 0,
`胜利文案把可比较的数字放最前（${winText.slice(0, 28)}…）`);
const loseText = shareTextOf(sampleResult({
    win: false, turns: 24, cities: 0, total: 35,
    stats: { openingCities: 3, captures: 20, losses: 30, persuaded: 2, released: 9, maxCities: 11 },
}));
check(loseText.indexOf('最多 11/35 城') >= 0 && loseText.indexOf('丢城 30 次') >= 0,
    '败局文案用最大版图而非归零的当前城数（这局不是白打）');

let p = defaultProfile();
p = recordResult(p, sampleResult({ turns: 19 }));
check(p.plays === 1 && p.wins === 1 && p.bestTurns === 19
    && p.lastResult.indexOf('19 回合') >= 0,
'第一局胜利：场次 / 统一数 / 最快回合 / 最近战绩同步落地');
p = recordResult(p, sampleResult({ turns: 25 }));
check(p.plays === 2 && p.wins === 2 && p.bestTurns === 19,
    '更慢的一局不会覆盖最快纪录');
p = recordResult(p, sampleResult({ turns: 16 }));
check(p.bestTurns === 16 && p.wins === 3,
    '更快的一局刷新纪录');
const beforeObj = p.objectives.length;
p = recordResult(p, sampleResult({ win: false, turns: 30, cities: 0 }));
check(p.plays === 4 && p.wins === 3 && p.objectives.length === beforeObj,
    '败局也计入场次，但不虚增统一数、不重复记成就');
check(profileLine(defaultProfile()).indexOf('尚无统一纪录') >= 0
    && profileLine(p).indexOf('最快 16 回合') >= 0,
'档案摘要在零胜 / 有胜两种状态下都可读');

// ----------------------------------------------------------------------
section('4. 本局战绩：状态层真的接线，且只记事实');
// ----------------------------------------------------------------------
const gs = fresh();
const opening = gs.provincesOf(gs.playerFaction).length;
check(gs.stats.openingCities === opening && gs.stats.maxCities === opening
    && gs.stats.captures === 0 && gs.stats.losses === 0
    && gs.stats.persuaded === 0 && gs.stats.released === 0,
`开局按剧本初始化 stats（${opening} 城），其余计数归零`);

const foe = (FACTIONS.find((f) => f.id !== gs.playerFaction && f.id !== NEUTRAL)
    || FACTIONS[0]).id;
check(!!FACTION_MAP[foe] && foe !== gs.playerFaction,
    `取到一个非玩家势力 ${foe} 用于构造攻防场景`);

function adjacentPair(g: GameState): { a: ProvinceState; b: ProvinceState } | null {
    const list = Array.from(g.provinces.values());
    for (const a of list) {
        for (const b of list) {
            if (a !== b && g.isAdjacent(a, b)) {
                return { a, b };
            }
        }
    }
    return null;
}

/** 造一次必胜攻城；byPlayer=true 玩家攻占，false 则 AI 夺玩家城 */
function forceCapture(g: GameState, byPlayer: boolean): boolean {
    const pair = adjacentPair(g);
    if (!pair) {
        return false;
    }
    const { a, b } = pair;
    a.owner = byPlayer ? g.playerFaction : foe;
    b.owner = byPlayer ? foe : g.playerFaction;
    a.attacked = false;
    b.attacked = false;
    a.troops = 200000;
    b.troops = 20;
    b.fort = 0;
    const res = g.attack(a, b);
    return !!(res && res.captured);
}

const citiesBefore = gs.provincesOf(gs.playerFaction).length;
check(forceCapture(gs, true), '构造场景：玩家必胜攻城成功');
const citiesAfter = gs.provincesOf(gs.playerFaction).length;
check(gs.stats.captures === 1 && gs.stats.losses === 0,
    '玩家攻占只加 captures，AI 之间互殴不计入');
check(gs.stats.maxCities === citiesAfter && citiesAfter > citiesBefore,
    `最大版图即时刷新（${citiesBefore} → ${citiesAfter} 城，不等下一次 endTurn）`);
const maxBefore = gs.stats.maxCities;
check(forceCapture(gs, false), '构造场景：AI 夺走玩家一座城成功');
check(gs.stats.losses === 1 && gs.stats.captures === 1,
    'AI 夺城只加 losses，不把玩家的战果算成 AI 的');
check(gs.stats.maxCities === maxBefore,
    '丢城不会把历史最大版图倒退（档案里这局确实打到过那么多城）');

/** 把某将领从所有城上摘下来，模拟「已被生擒」 */
function jail(g: GameState, gid: string): void {
    g.provinces.forEach((c) => {
        c.generals = c.generals.filter((id) => id !== gid);
    });
    const gen = g.generals.get(gid)!;
    gen.captiveOf = g.playerFaction;
    gen.loyalty = 0;
}
const captives = Array.from(gs.generals.values())
    .filter((x) => !x.def.ruler && x.faction !== gs.playerFaction)
    .slice(0, 2);
check(captives.length === 2, '取到两名非君主俘虏用于招降 / 放归');
setRandom(() => 0);
jail(gs, captives[0].def.id);
jail(gs, captives[1].def.id);
check(gs.persuade(captives[0].def.id).ok, '构造场景：招降成功');
check(gs.release(captives[1].def.id).ok, '构造场景：放归成功');
check(gs.stats.persuaded === 1 && gs.stats.released === 1,
    '招降 / 放归成功各计一次，失败不计数');

// ----------------------------------------------------------------------
section('5. 存档兼容：旧档不炸、版本不升、档案不随新局清空');
// ----------------------------------------------------------------------
check(GameState.SAVE_VERSION === 1,
    'SAVE_VERSION 仍为 1（新增 stats 是可选字段，不写迁移、不拒旧档）');
const saved = gs.serialize();
check(!!saved.stats && saved.stats.captures === 1 && saved.stats.losses === 1
    && saved.stats.persuaded === 1 && saved.stats.released === 1,
'serialize() 把本局战绩一起写进局面存档');
const gs2 = fresh();
check(gs2.deserialize(saved), '带 stats 的新档可以正常读回');
check(gs2.stats.captures === 1 && gs2.stats.losses === 1
    && gs2.stats.persuaded === 1 && gs2.stats.released === 1
    && gs2.stats.maxCities === saved.stats!.maxCities,
'读档后本局战绩完整保留');
check(gs2.logs.length === 0 && gs2.threats.size === 0,
    '读档仍然不重建战报与敌情（上一局的过程信息不串场）');

const legacy: any = gs.serialize();
delete legacy.stats;
const gs3 = fresh();
check(gs3.deserialize(legacy), '不含 stats 的旧存档照样能读');
const legacyCities = gs3.provincesOf(gs3.playerFaction).length;
check(gs3.stats.captures === 0 && gs3.stats.losses === 0
    && gs3.stats.openingCities >= 1 && gs3.stats.maxCities >= legacyCities,
`旧档按当前局面重建 stats（${legacyCities} 城），不把战绩清零也不虚报`);

const s0 = emptyStats(4);
check(s0.maxCities === 4 && s0.captures === 0, 'emptyStats() 用开局城数当最大版图基线');
const sd = sanitizeStats({ captures: 'x', losses: -5, maxCities: 999 }, 3, 7);
check(sd.captures === 0 && sd.losses === 0 && sd.maxCities >= 7
    && sd.openingCities === 3,
'sanitizeStats() 逐字段夹取脏数据，旧档 / 手改存档都不会污染结算页');
gs.reset();
check(gs.stats.captures === 0 && gs.stats.losses === 0
    && gs.stats.maxCities === gs.provincesOf(gs.playerFaction).length,
'新开一局 reset() 清零本局战绩（局外档案不在这里，不受影响）');

// ----------------------------------------------------------------------
async function guards(): Promise<void> {
    // 动态 import：bundle-test.mjs 只转换相对路径的静态 import
    const { readFileSync } = await import('node:fs');
    const state = readFileSync('assets/scripts/core/GameState.ts', 'utf8');
    const profile = readFileSync('assets/scripts/core/Profile.ts', 'utf8');
    const ui = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const wx = readFileSync('assets/scripts/platform/WeChatAdapter.ts', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    section('6. 源码守卫：状态层 / 目标条 / 结算页 / 分享钩子真的接线');

    check(state.indexOf("from './Profile'") >= 0
        && state.indexOf('public stats: RunStats') >= 0,
    'GameState 引入 Profile 并持有本局战绩');
    const srcChecks: Array<[string, string]> = [
        ['this.stats.captures++', '玩家攻占计入 captures'],
        ['this.stats.losses++', 'AI 夺城计入 losses'],
        ['this.stats.persuaded++', '招降成功计入 persuaded'],
        ['this.stats.released++', '放归成功计入 released'],
        ['stats: this.stats', 'serialize() 写出战绩'],
        ['sanitizeStats(', 'deserialize() 对旧档兜底'],
        ['emptyStats(this.provincesOf(this.playerFaction).length)', 'reset() 按开局城数初始化'],
    ];
    for (const [needle, label] of srcChecks) {
        check(state.indexOf(needle) >= 0, label);
    }
    check(state.indexOf("stats?: RunStats") >= 0,
        'SaveData.stats 是可选字段（SAVE_VERSION 不必升）');
    check(profile.indexOf('Balance') < 0 && profile.indexOf('gold.set') < 0,
        '档案层不碰 Balance、不发资源：新增正反馈只有信息，不改节奏');

    check(ui.indexOf("makeRectStroke('GoalBox'") >= 0
        && ui.indexOf('addWidget(this.goalNode') >= 0
        && ui.indexOf('this.goalNode.on(') < 0,
    '常驻目标条存在且不注册点击：不弹遮罩、不拦截地图交互');
    check(ui.indexOf('PROFILE_KEY') >= 0
        && ui.indexOf('saveData(PROFILE_KEY, this.profile)') >= 0
        && ui.indexOf('saveData(SAVE_KEY, null)') >= 0,
    '局外档案走独立 key；新开一局只清局面存档');
    const steps = ui.split('this.advanceTutorial(').length - 1;
    check(steps >= 5,
        `任务式引导接了 ${steps} 根真实操作线（选城 / 内政 / 结束回合 / 攻占 / 看要闻）`);
    check(ui.indexOf('this.noteObjective(') >= 0
        && ui.indexOf('this.refreshGoalBar(') >= 0
        && ui.indexOf('goalShownLevel') >= 0,
    '阶段目标在 HUD 刷新里推进，丢城回退不重复播报');
    check(ui.indexOf("makeRectStroke('ResultShareBtn'") >= 0
        && ui.indexOf('this.onShareResult()') >= 0,
    '结算页新增「分享战绩」按钮且不挤掉原有三个入口');
    const resultChecks: Array<[string, string]> = [
        ['shareTextOf(result)', '结算页生成可比较的战绩文案'],
        ['recordResult(this.profile, result)', '结算页更新局外档案'],
        ['gradeOf(win, this.state.turn)', '结算页显示回合评价'],
        ['profileLine(this.profile)', '结算页显示累计成绩'],
        ['setShareText(share)', '结算后右上角转发立刻换成战绩'],
        ['this.resultRecorded', '结算面板反复打开时档案只记一次'],
    ];
    for (const [needle, label] of resultChecks) {
        check(ui.indexOf(needle) >= 0, label);
    }
    check(ui.indexOf('this.resultRecorded = false') >= 0,
        '新开一局重置「已记录」标记');
    check(wx.indexOf('export function setShareText(') >= 0
        && wx.indexOf('export function currentShareText(') >= 0
        && wx.indexOf('title: currentShareText()') >= 0
        && wx.indexOf('export function copyText(') >= 0,
    '分享文案可动态更新，转发回调每次读最新值，无剪贴板时也能降级');

    check(readme.indexOf('任务式引导') >= 0
        && readme.indexOf('阶段目标') >= 0
        && readme.indexOf('局外档案') >= 0
        && readme.indexOf('战绩结算') >= 0
        && readme.indexOf('sim-onboarding.ts') >= 0,
    'README 写清 P1 的四件事与新增回归脚本');

    console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}（${pass} 通过 / ${pass + fail}）`);
    if (fail > 0) {
        process.exitCode = 1;
    }
}

guards();
