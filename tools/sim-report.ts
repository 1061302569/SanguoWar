/**
 * 战报分级 + 敌情预警回归：**AI 变强之后，玩家必须看得懂发生了什么**
 *
 * 二次试玩探针量化出来的问题不是数值，而是信息：
 *   - AI 增强后一回合写 7.8~8.9 条战报、峰值 18~19 条，
 *     而窗口只有最后 4 行，玩家相关要闻 42%~59% 被挤出；
 *   - AI「自后方集结、图谋某城」只在战报里闪一下，玩家下回合
 *     根本不知道该往哪调兵，于是刚打下的城下一回合又丢。
 *
 * 这里把两条修法钉成断言：recentLogs() 要闻置顶、threats 留到玩家回合，
 * 并用运行时钩子验证重要度真的接在每个战报源上（不是只改了 UI）。
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { NEUTRAL } from '../assets/scripts/data/Factions.ts';
import { ProvinceState } from '../assets/scripts/data/Types.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';

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

function fresh(seed = 20241112): GameState {
    let s = seed;
    setRandom(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    });
    return new GameState();
}

/** 包住 pushLog，精确记录每条战报的重要度（不靠文本猜） */
function hookLogs(gs: GameState): Array<{ msg: string; p: number }> {
    const rec: Array<{ msg: string; p: number }> = [];
    const orig = gs.pushLog.bind(gs);
    gs.pushLog = (msg: string, priority = 0): void => {
        rec.push({ msg, p: priority });
        orig(msg, priority);
    };
    return rec;
}

/**
 * 造一个「AI 只剩一个玩家硬目标、后方有兵、主攻城空着」的局面：
 * 必然触发 aiConcentrate()，因此必定写一条图谋玩家城的敌情。
 */
function concentrationScene(): { gs: GameState; target: ProvinceState } {
    const gs = fresh();
    const player = gs.playerFaction;
    let fid = '';
    for (const p of gs.provinces.values()) {
        if (p.owner === player || p.owner === NEUTRAL) continue;
        if (gs.attackTargets(p).some((t) => t.owner === player)) { fid = p.owner; break; }
    }
    gs.provinces.forEach((p) => { if (p.owner !== player) p.owner = fid; });
    const pc = gs.provincesOf(player);
    const keep = pc[0];
    for (const p of pc) {
        if (p !== keep) p.owner = fid;
    }
    const mine = gs.provincesOf(fid);
    const fronts = mine.filter((p) => gs.attackTargets(p).length > 0);
    const main = fronts.slice().sort((a, b) => gs.garrisonCap(b) - gs.garrisonCap(a))[0];
    // 后方只留 0.45 倍上限的余兵：够让 AI 觉得「值得集结」，
    // 但不足以当回合打穿 2.5 倍超编的坚城 —— 正是预警最有用的僵持局面。
    for (const p of mine) {
        p.troops = Math.round(gs.garrisonCap(p) * 0.45);
        p.dev = 100;
    }
    main.troops = 150;
    keep.troops = Math.round(gs.garrisonCap(keep) * 2.5);
    gs.gold.set(fid, 50000);
    gs.food.set(fid, 20000);
    return { gs, target: keep };
}

// ----------------------------------------------------------------------
section('1. recentLogs()：要闻钉在顶部，普通日志只补位');
// ----------------------------------------------------------------------
{
    const gs = fresh();
    check(gs.recentLogs().length === 0, '没有战报时返回空数组（不显示 undefined）');
    gs.pushLog('甲势力治理', 0);
    gs.pushLog('玩家丢城：许昌', 2);
    gs.pushLog('内政结算', 1);
    gs.pushLog('乙势力互殴', 0);
    gs.pushLog('曹操集结图谋邺', 2);
    gs.pushLog('丙势力募兵', 0);

    const r = gs.recentLogs(3, 5);
    check(r.length === 5, `窗口固定 ${r.length} 行（不会随日志增多撑破面板）`);
    check(r[0].important && r[0].text.indexOf('许昌') >= 0,
        '第一条要闻是时间较早的「玩家丢城」');
    check(r[1].important && r[1].text.indexOf('图谋邺') >= 0,
        '第二条要闻是较晚的「集结图谋」，要闻之间按时间正序');
    check(r.slice(0, 2).every((x) => x.important)
        && r.slice(2).every((x) => !x.important),
        '重要项全部排在前面，普通项跟在后面');
    check(new Set(r.map((x) => x.text)).size === r.length,
        '同一条战报不会被取两次（要闻不会和补位日志重复）');
    check(!r.some((x) => x.text.indexOf('甲势力治理') >= 0),
        '最早的普通日志被挤出窗口，但没有任何要闻被挤掉');

    const tight = gs.recentLogs(1, 3);
    check(tight.length === 3 && tight[0].important
        && tight[0].text.indexOf('图谋邺') >= 0,
        '只要 1 条要闻时取最近的一条，且仍置顶');
}

// ----------------------------------------------------------------------
section('2. 200 条上限：logs 与重要度数组必须同步裁剪');
// ----------------------------------------------------------------------
{
    const gs = fresh();
    for (let i = 0; i < 210; i++) {
        gs.pushLog(`背景 ${i}`, 0);
    }
    gs.pushLog('玩家要闻', 2);
    const any = gs as any;
    check(gs.logs.length === 200, `战报裁剪到 ${gs.logs.length} 条（上限 200）`);
    check(any.logPriority.length === gs.logs.length,
        '重要度数组与战报一一对应（没有错位或残留）');
    check(gs.recentLogs(2, 4)[0].text === '玩家要闻',
        '裁剪后仍能正确识别并置顶要闻');
    check(gs.recentLogs().every((x) => typeof x.text === 'string' && x.text.length > 0),
        '返回的每条文本都有效（不会出现 undefined）');
}

// ----------------------------------------------------------------------
section('3. 重要度接线：玩家战况是 2，AI 互殴是 0');
// ----------------------------------------------------------------------
{
    const gs = fresh();
    const rec = hookLogs(gs);
    const a = gs.provincesOf(gs.playerFaction)[0];
    const t = gs.attackTargets(a)[0];
    if (t) {
        a.troops = Math.round(gs.garrisonCap(a) * 3);
        a.attacked = false;
        t.troops = 20;
        t.fort = 0;
        gs.attack(a, t);
    }
    const capture = rec.find((x) => x.msg.indexOf('攻占') >= 0);
    check(!!capture && capture.p === 2,
        `玩家攻城战报钉为要闻（实际 priority=${capture ? capture.p : '无'}）`);

    const gs2 = fresh();
    const rec2 = hookLogs(gs2);
    gs2.queueDomestic(gs2.provincesOf(gs2.playerFaction)[0], 'govern');
    gs2.settleDomestic();
    check(rec2.length === 0 || rec2.every((x) => x.p !== 2),
        '玩家自己的内政日志不算「敌情要闻」（不会抢置顶名额）');
}

// ----------------------------------------------------------------------
section('4. 敌情预警：AI 的意图留到玩家回合，且只对仍属于我的城生效');
// ----------------------------------------------------------------------
{
    const { gs, target } = concentrationScene();
    const rec = hookLogs(gs);
    check(gs.liveThreats().length === 0, '开局没有任何敌情预警');
    gs.endTurn();
    const intent = rec.find((x) => x.msg.indexOf('图谋') >= 0 && x.msg.indexOf('集结') >= 0);
    check(!!intent && intent.p === 2,
        `AI 集结图谋玩家城写进战报且为要闻（priority=${intent ? intent.p : '无'}）`);
    const live = gs.liveThreats();
    check(live.length > 0, `玩家回合能看到 ${live.length} 处敌情预警`);
    check(live.some((x) => x.id === target.id),
        '预警精确指向被图谋的那座我方城');
    check(!!live[0] && live[0].text.indexOf('集结') >= 0
        && /\d/.test(live[0].text),
        '预警写明集结方、兵力与集结地（玩家能判断要不要回防）');
    // 这个场景里所有城都归同一势力，AI 互殴日志少；手动灌入一批背景战报，
    // 复现试玩探针里「一回合十几条」的真实密度。
    for (let i = 0; i < 12; i++) {
        gs.pushLog(`其他势力动态 ${i}`, 0);
    }
    const window = gs.recentLogs(3, 5);
    check(gs.logs.length > 10 && window[0].important
        && window[0].text.indexOf('图谋') >= 0,
        `灌入 12 条背景战报后「图谋」要闻仍钉在顶部（共 ${gs.logs.length} 条）`);
    check(window.filter((x) => !x.important)
        .every((x) => x.text.indexOf('其他势力动态') >= 0),
        '窗口剩余空位才由普通日志补上');
    check(live[0].text.indexOf('集结') >= 0,
        '战报窗口之外，敌情条仍留着这条可回防的意图');

    // 城已经被打下 → 这条意图过期，不能再让玩家「回防」一座敌城
    target.owner = 'some_ai_faction';
    check(gs.liveThreats().length === 0,
        '城池易主后预警自动失效（liveThreats 按当前归属过滤）');
}

// ----------------------------------------------------------------------
section('5. 预警每回合刷新，且不进存档');
// ----------------------------------------------------------------------
{
    const { gs } = concentrationScene();
    gs.endTurn();
    check(gs.liveThreats().length > 0, '第一回合结算后出现预警');
    // 手动伪造一条旧预警，下一次 AI 阶段必须清掉
    gs.threats.set('bogus_city', '旧势力 集结 999 兵于 旧城');
    gs.endTurn();
    check(!gs.threats.has('bogus_city'),
        'runAiPhase() 开头清掉上一回合的过期预警（不会越积越多）');

    const saved = gs.serialize();
    gs.threats.set(targetIdOf(gs), '脏数据 集结 1 兵');
    gs.logs.push('上一局的战报');
    const ok = gs.deserialize(saved);
    check(ok, '存档能正常读回');
    check(gs.threats.size === 0 && gs.logs.length === 0,
        '读档清空敌情与战报（旧局的过程信息不会挂到新局面上）');
    check((gs as any).logPriority.length === 0,
        '读档同步清空重要度数组');
}
function targetIdOf(gs: GameState): string {
    const p = gs.provincesOf(gs.playerFaction)[0];
    return p ? p.id : '';
}

// ----------------------------------------------------------------------
section('6. 源码守卫：UI 真的在读这些字段，不是只改了状态层');
// ----------------------------------------------------------------------
function bodyOf(src: string, start: string, end: string): string {
    const i = src.indexOf(start);
    if (i < 0) return '';
    const e = end ? src.indexOf(end, i + start.length) : -1;
    return e > i ? src.slice(i, e) : src.slice(i);
}

async function guards(): Promise<void> {
    // 动态 import：bundle-test.mjs 只转换相对路径的静态 import
    const { readFileSync } = await import('node:fs');
    const state = readFileSync('assets/scripts/core/GameState.ts', 'utf8');
    const ui = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    const runAi = bodyOf(state, 'private runAiPhase(', 'private aiGovern(');
    check(runAi.indexOf('this.threats.clear()') >= 0,
        'runAiPhase() 每回合刷新敌情（旧预警不会留成永久噪音）');
    check(bodyOf(state, 'public reset(', 'public initialDev(').indexOf('this.threats.clear()') >= 0,
        '新开一局清空敌情');
    check(bodyOf(state, 'public deserialize(', 'public static readonly SAVE_VERSION')
        .indexOf('this.threats.clear()') >= 0,
        '读档清空敌情');
    check(state.indexOf('this.markThreat(target, desc)') >= 0,
        'AI 集结玩家城时确实写入预警（不是只写了条战报）');
    check(bodyOf(state, 'public pushLog(', 'public recentLogs(')
        .indexOf('this.logPriority.shift()') >= 0,
        '战报裁剪时同步裁剪重要度');

    const refreshHud = bodyOf(ui, 'private refreshHud(', 'update(dt: number)');
    check(refreshHud.indexOf('recentLogs(') >= 0,
        '战报窗口走 recentLogs() 要闻置顶，而不是 slice(-4)');
    check(refreshHud.indexOf('liveThreats()') >= 0,
        'HUD 读 liveThreats() 显示敌情条');
    check(refreshHud.indexOf('threatNode.active') >= 0,
        '没有敌情时整条隐藏（平时不占地图视野）');
    check(ui.indexOf('this.state.threats.has(p.id)') >= 0,
        '城池面板标题标出「敌军图谋此城」');
    check(ui.indexOf("x.important ? '! ' : '  '") >= 0,
        '要闻用 ! 前缀标出（不引入缺字形的勾选符号）');
    check(ui.indexOf('Label.Overflow.CLAMP') >= 0
        && ui.indexOf('Label.VerticalAlign.TOP') >= 0,
        '战报文字顶部对齐 + 裁剪，不会溢出压住城池标签');
    check(ui.indexOf('LogBox\', 340, 140') >= 0,
        '战报窗口加高到 5 行');
    check(ui.indexOf("makeRectStroke('LogBox'") >= 0,
        '战报框有半透明底板（文字不会压在地图城池标签上读不清）');

    check(readme.indexOf('战报要闻') >= 0 && readme.indexOf('敌情预警') >= 0,
        'README 写清「战报要闻」与「敌情预警」两条新规则');

    console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}（${pass} 通过 / ${pass + fail}）`);
    if (fail > 0) {
        process.exitCode = 1;
    }
}

guards();
