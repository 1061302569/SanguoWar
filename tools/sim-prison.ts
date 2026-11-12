/**
 * 回归：君主 / 武将·文官 / 忠诚度 / 生擒·招降·放归
 *
 * 一条因果链，没有第二条：
 *   攻破敌城 → 按公开概率生擒守将 → 俘虏营二选一（招降 / 放归）
 *   → 招降失败：忠诚升，越劝越硬
 *   → 放归：回原势力、忠诚降（旧主猜忌），下次被俘更容易招降
 *
 * 本测试守住：
 *   1) 君主唯一且不可招降；武将 / 文官都有忠诚度，身份不影响成功率；
 *   2) 招降成功率只由 (100 - 忠诚)/100 决定，UI 与状态层共用同一答案；
 *   3) 生擒只发生在玩家攻占时，俘虏不在任何城的 generals 里；
 *   4) 招降成功改旗易帜并安置，失败升忠诚且人仍在营里；
 *   5) 放归降忠诚、君主例外、亡国将领不凭空消失；
 *   6) 「放归 → 再俘 → 更易招」的成功率确实单调变高；
 *   7) 在城 + 在营守恒，存档往返保留 faction / loyalty / captiveOf；
 *   8) UI 接线：顶栏入口、俘虏营弹窗互斥、面板显示君主与忠诚。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-prison.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-prison.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { Balance } from '../assets/scripts/core/Balance.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';
import { GENERALS, ROLE_NAME, RULER_OF } from '../assets/scripts/data/Generals.ts';
import { FACTION_MAP, NEUTRAL } from '../assets/scripts/data/Factions.ts';
import { GeneralState, ProvinceState } from '../assets/scripts/data/Types.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}
function section(title: string): void {
    console.log(`\n== ${title} ==`);
}

/** 测试夹具：把某将领从所有城上摘下来，模拟「已被生擒」 */
function jail(gs: GameState, gid: string): void {
    gs.provinces.forEach((p) => {
        p.generals = p.generals.filter((id) => id !== gid);
    });
    const g = gs.generals.get(gid)!;
    g.captiveOf = gs.playerFaction;
}

function inAnyCity(gs: GameState, gid: string): boolean {
    let found = false;
    gs.provinces.forEach((p) => {
        if (p.generals.indexOf(gid) >= 0) found = true;
    });
    return found;
}

// ----------------------------------------------------------------------
section('1. 数据层：君主唯一、身份与忠诚');
// ----------------------------------------------------------------------
const gs = new GameState();
gs.reset();

const rulers = GENERALS.filter((g) => g.ruler);
const rulerFactions = new Set(rulers.map((g) => g.faction));
check(rulers.length === rulerFactions.size,
    `每个势力最多一位君主（${rulers.length} 位君主 / ${rulerFactions.size} 个势力）`);
check(rulers.every((g) => g.loyalty === Balance.loyaltyMax),
    '君主开局忠诚拉满，不会一开口就投降');
check(Object.keys(RULER_OF).length === rulers.length,
    'RULER_OF 从将领表自动派生，没有第二份真相源');
const myRuler = gs.rulerOf(gs.playerFaction);
check(!!myRuler && myRuler.ruler === true,
    `rulerOf() 取到我方君主 ${myRuler ? myRuler.name : '（无）'}`);
check(gs.rulerOf('no_such_faction') === null, '无将领势力返回 null，不抛异常');

let roleBad = 0;
let loyaltyBad = 0;
for (const def of GENERALS) {
    if (!ROLE_NAME[def.role] || (def.role !== 'military' && def.role !== 'civil')) {
        roleBad++;
    }
    if (!(def.loyalty >= Balance.loyaltyMin && def.loyalty <= Balance.loyaltyMax)) {
        loyaltyBad++;
    }
}
check(roleBad === 0, `全部 ${GENERALS.length} 名将领都有武将 / 文官身份`);
check(loyaltyBad === 0, '全部将领开局忠诚落在合法区间');
let stateBad = 0;
gs.generals.forEach((g) => {
    if (g.faction !== g.def.faction || g.captiveOf !== ''
        || g.loyalty !== g.def.loyalty) {
        stateBad++;
    }
});
check(stateBad === 0, '开局状态：当前势力 = 初始势力、忠诚 = 配置值、无人坐牢');

// ----------------------------------------------------------------------
section('2. 招降成功率：忠诚 + 我方君威，没有隐藏修正');
// ----------------------------------------------------------------------
const chanceBonus = gs.persuadeBonus();
let chanceBad = 0;
gs.generals.forEach((g) => {
    const base = (Balance.loyaltyMax - g.loyalty) / Balance.loyaltyMax;
    const expect = gs.isReigning(g) ? 0 : Math.min(1, base + chanceBonus);
    if (Math.abs(gs.persuadeChance(g) - expect) > 1e-9) chanceBad++;
});
check(chanceBad === 0,
    `成功率 = (100-忠诚)/100 + 我方君威 ${Math.round(chanceBonus * 100)}%，无隐藏修正`);
check(gs.persuadeChance(gs.generals.get('cao_cao')!) === 0, '在位君主招降成功率恒为 0');
const civil = Array.from(gs.generals.values()).find((g) => g.def.role === 'civil')!;
const military = Array.from(gs.generals.values())
    .find((g) => g.def.role === 'military' && !g.def.ruler)!;
civil.loyalty = 60;
military.loyalty = 60;
check(Math.abs(gs.persuadeChance(civil) - gs.persuadeChance(military)) < 1e-9,
    `同忠诚的文官 ${civil.def.name} 与武将 ${military.def.name} 成功率相同`);

// ----------------------------------------------------------------------
section('3. 生擒：只有玩家攻占才会抓人');
// ----------------------------------------------------------------------
setRandom(() => 0); // 0 < captureGeneralChance，必然生擒
const cap = new GameState();
cap.reset();
let from = null as any;
let to = null as any;
cap.provincesOf(cap.playerFaction).forEach((p) => {
    if (from) return;
    const t = cap.attackTargets(p).filter((q) => q.generals.length > 0)[0];
    if (t) {
        from = p;
        to = t;
    }
});
check(!!from && !!to, '找到一对「己方城 + 有守将的相邻敌城」');
const defenders = to.generals.slice();
from.troops = 30000;
to.troops = 200;
to.fort = 0;
const capRes = cap.attack(from, to);
check(!!capRes && capRes.captured, '压倒性兵力攻下该城');
const jailed = cap.prisonersOf(cap.playerFaction);
check(jailed.length === defenders.length,
    `守将全部被生擒（${jailed.length} / ${defenders.length} 人）`);
check(defenders.every((gid: string) => !inAnyCity(cap, gid)),
    '俘虏不在任何城的 generals 里（一个将领只有一处去处）');
check(defenders.every((gid: string) => cap.generals.get(gid)!.captiveOf === cap.playerFaction),
    '俘虏的 captiveOf 指向玩家势力');

// AI 攻城不生擒：AI 没有招降界面，关着只会让将领从地图上消失
setRandom(() => 0);
const ai = new GameState();
ai.reset();
let aiFrom = null as any;
let aiTo = null as any;
ai.provinces.forEach((p) => {
    if (aiFrom || p.owner === ai.playerFaction || p.owner === 'neutral') return;
    const t = ai.attackTargets(p).filter((q) => q.generals.length > 0)[0];
    if (t) {
        aiFrom = p;
        aiTo = t;
    }
});
check(!!aiFrom && !!aiTo, '找到一对「AI 城 + 有守将的相邻目标」');
aiFrom.troops = 30000;
aiTo.troops = 200;
aiTo.fort = 0;
const aiRes = ai.attack(aiFrom, aiTo);
check(!!aiRes && aiRes.captured, 'AI 也能正常攻下城池');
check(ai.prisonersOf(ai.playerFaction).length === 0,
    'AI 攻占不生擒（不对称设计：玩家才有俘虏营）');
check(ai.generals.size === GENERALS.length, 'AI 攻城后武将总数不变');

// ----------------------------------------------------------------------
section('4. 招降：成功改旗易帜，失败越劝越硬');
// ----------------------------------------------------------------------
const win = new GameState();
win.reset();
const winId = GENERALS.find((g) => !g.ruler && g.faction !== win.playerFaction)!.id;
jail(win, winId);
win.generals.get(winId)!.loyalty = 0; // chance = 1
setRandom(() => 0);
const winRes = win.persuade(winId);
const winG = win.generals.get(winId)!;
check(winRes.ok && Math.abs(winRes.chance - 1) < 1e-9, '忠诚 0 时招降成功（成功率 100%）');
check(winG.faction === win.playerFaction && winG.captiveOf === '',
    '归降后改旗易帜、恢复自由身');
check(winG.loyalty === Balance.recruitLoyalty, '归降后以 recruitLoyalty 重新积累信任');
check(inAnyCity(win, winId), '归降将领被安置到我方城池，没有凭空消失');

const lose = new GameState();
lose.reset();
const loseId = GENERALS.find((g) => !g.ruler && g.faction !== lose.playerFaction)!.id;
jail(lose, loseId);
const beforeLoyalty = 88;
lose.generals.get(loseId)!.loyalty = beforeLoyalty;
setRandom(() => 0.99); // > chance，必定失败
const loseRes = lose.persuade(loseId);
check(!loseRes.ok, '随机值高于成功率时招降失败');
check(lose.generals.get(loseId)!.loyalty === beforeLoyalty + Balance.persuadeFailLoyaltyGain,
    `失败后忠诚升 ${Balance.persuadeFailLoyaltyGain} 点（越劝越硬）`);
check(lose.generals.get(loseId)!.captiveOf === lose.playerFaction
    && !inAnyCity(lose, loseId), '失败的人仍关在营里，不会偷偷跑回城上');

const rulerTry = new GameState();
rulerTry.reset();
const rulerId = GENERALS.find((g) => g.ruler && g.faction !== rulerTry.playerFaction)!.id;
jail(rulerTry, rulerId);
const rulerTryRes = rulerTry.persuade(rulerId);
check(!rulerTryRes.ok && rulerTryRes.chance === 0, '君主不可招降，UI 之外也拦住');

// ----------------------------------------------------------------------
section('5. 放归：降忠诚、君主例外、亡国不丢人');
// ----------------------------------------------------------------------
const rel = new GameState();
rel.reset();
const relId = GENERALS.find((g) => !g.ruler && g.faction !== rel.playerFaction)!.id;
jail(rel, relId);
const relG = rel.generals.get(relId)!;
relG.loyalty = 80;
const homeFaction = relG.faction;
const relRes = rel.release(relId);
check(relRes.ok && relG.loyalty === 80 - Balance.releaseLoyaltyDrop,
    `放归降 ${Balance.releaseLoyaltyDrop} 点忠诚（80 → ${relG.loyalty}）`);
check(relG.captiveOf === '' && inAnyCity(rel, relId), '放归后回到城上');
const home = Array.from(rel.provinces.values())
    .filter((p) => p.generals.indexOf(relId) >= 0)[0];
check(!!home && (home.owner === homeFaction || FACTION_MAP[home.owner] === undefined),
    '优先回原势力人口最多的城（原势力已亡才流亡）');

const rulerRel = new GameState();
rulerRel.reset();
const rulerRelId = GENERALS.find((g) => g.ruler && g.faction !== rulerRel.playerFaction)!.id;
jail(rulerRel, rulerRelId);
const rulerRelG = rulerRel.generals.get(rulerRelId)!;
const rulerLoyaltyBefore = rulerRelG.loyalty;
rulerRel.release(rulerRelId);
check(rulerRelG.loyalty === rulerLoyaltyBefore,
    '君主放归不降忠诚（他是主不是臣，不存在被旧主猜忌）');

const extinct = new GameState();
extinct.reset();
const extId = GENERALS.find((g) => !g.ruler && g.faction !== extinct.playerFaction)!.id;
jail(extinct, extId);
const extFaction = extinct.generals.get(extId)!.faction;
extinct.provincesOf(extFaction).forEach((p) => { p.owner = extinct.playerFaction; });
const extRes = extinct.release(extId);
check(extRes.ok && inAnyCity(extinct, extId),
    '原势力已亡时流亡到中立 / 非玩家城，「放归→再俘」链条不断');
check(extinct.generals.get(extId)!.captiveOf === '', '流亡将领不再算俘虏');

// ----------------------------------------------------------------------
section('6. 放归 → 再俘 → 更容易招降');
// ----------------------------------------------------------------------
const chain = new GameState();
chain.reset();
const chainId = GENERALS.find((g) => !g.ruler && g.faction !== chain.playerFaction)!.id;
jail(chain, chainId);
const chainG = chain.generals.get(chainId)!;
const chanceBefore = chain.persuadeChance(chainG);
chain.release(chainId);
const chanceAfter = chain.persuadeChance(chainG);
check(chanceAfter > chanceBefore,
    `放归后招降成功率 ${Math.round(chanceBefore * 100)}% → ${Math.round(chanceAfter * 100)}%`);
check(Math.abs((chanceAfter - chanceBefore) * Balance.loyaltyMax
    - Balance.releaseLoyaltyDrop) < 1e-9,
    '成功率增量严格等于放归降的忠诚，没有额外暗改');

// ----------------------------------------------------------------------
section('7. 守恒与存档兼容');
// ----------------------------------------------------------------------
let placed = 0;
cap.provinces.forEach((p) => { placed += p.generals.length; });
check(placed + cap.prisonersOf(cap.playerFaction).length === cap.generals.size,
    `在城 ${placed} + 在营 ${cap.prisonersOf(cap.playerFaction).length} = ${cap.generals.size}（守恒）`);

const saved = win.serialize() as any;
const savedGen = saved.generals[winId];
check(savedGen.faction === win.playerFaction
    && savedGen.loyalty === Balance.recruitLoyalty
    && savedGen.captiveOf === '',
'存档写入 faction / loyalty / captiveOf');
const loaded = new GameState();
check(loaded.deserialize(JSON.parse(JSON.stringify(saved))), '存档能读回');
const loadedGen = loaded.generals.get(winId)!;
check(loadedGen.faction === win.playerFaction
    && loadedGen.loyalty === Balance.recruitLoyalty
    && loadedGen.captiveOf === '', '读档后所属 / 忠诚 / 自由身都保留');

// 旧档：三个字段全缺，必须回退到配置初值，不能有人凭空坐牢
// 用 win（全员都在城上）当底稿，避免把「新档里本就有俘虏」混进旧档场景
const legacy = JSON.parse(JSON.stringify(win.serialize()));
Object.keys(legacy.generals).forEach((k) => {
    delete legacy.generals[k].faction;
    delete legacy.generals[k].loyalty;
    delete legacy.generals[k].captiveOf;
});
const oldLoad = new GameState();
check(oldLoad.deserialize(legacy), '旧存档（缺新字段）能读回');
let oldBad = 0;
oldLoad.generals.forEach((g) => {
    if (g.faction !== g.def.faction || g.loyalty !== g.def.loyalty || g.captiveOf !== '') {
        oldBad++;
    }
});
check(oldBad === 0, '旧档缺字段时回退到初始势力 / 初始忠诚 / 自由身');
let dirty = 0;
oldLoad.provinces.forEach((p) => p.generals.forEach((gid) => {
    const g = oldLoad.generals.get(gid);
    if (g && g.captiveOf !== '') dirty++;
}));
check(dirty === 0, '读档兜底：俘虏不会同时挂在某座城的 generals 里');

setRandom(Math.random);

// ----------------------------------------------------------------------
section('8. 亡国君主可招降 + 君威加成');
// ----------------------------------------------------------------------
const gs2 = new GameState();
gs2.reset();
const me = gs2.playerFaction;

// 找靶子：某势力只剩这一座城，且君主本人就在城内。
// 只挑「一城势力」是为了让一次攻城就等于灭国，不用连着打好几座。
const singles: ProvinceState[] = [];
gs2.provinces.forEach((p) => {
    if (p.owner === me || p.owner === NEUTRAL) return;
    if (gs2.provincesOf(p.owner).length !== 1) return;
    if (gs2.generalsAt(p).some((g) => g.def.ruler)) singles.push(p);
});
const target = singles[0];
const fallenRuler = target
    ? gs2.generalsAt(target).filter((g) => g.def.ruler)[0] as GeneralState | undefined
    : undefined;

check(!!target && !!fallenRuler,
    `找到靶子：${target ? target.name : '（无）'} 是某势力最后一城，君主在城内`);

if (!target || !fallenRuler) {
    check(false, '找不到「只剩一城且君主在城内」的势力，无法验证亡国招降');
} else {
    const froms: ProvinceState[] = [];
    for (const bid of target.def.borders) {
        const p = gs2.provinces.get(bid);
        if (p) froms.push(p);
    }
    const from = froms[0];
    if (!from) {
        check(false, '靶子没有邻城，无法构造攻城场景');
    } else {
        // 布阵：出发城交给玩家并堆满兵，靶城只留 1 兵 —— 攻城必下
        const fallenFaction = target.owner;
        from.owner = me;
        from.troops = 200000;
        from.generals = [];
        target.troops = 1;
        target.fort = 0;

        const before = fallenRuler.loyalty;
        check(gs2.isReigning(fallenRuler), `攻灭之前 ${fallenRuler.def.name} 仍是在位君主`);
        check(gs2.persuadeChance(fallenRuler) === 0, '在位君主成功率恒为 0，招不了');

        // 随机源钉死 0：生擒必中、招降必成，整段可复现
        setRandom(() => 0);
        const res = gs2.attack(from, target);
        setRandom(Math.random);

        check(!!res && res.captured, `攻破最后一城 ${target.name}`);
        check(fallenRuler.captiveOf === me, `君主 ${fallenRuler.def.name} 被生擒，押入俘虏营`);
        check(!gs2.isReigning(fallenRuler), '失去所有城池后不再是「在位君主」');
        check(fallenRuler.loyalty === Math.max(Balance.loyaltyMin,
            before - Balance.fallenLoyaltyDrop),
        `亡国降忠诚 ${before} → ${fallenRuler.loyalty}（-${Balance.fallenLoyaltyDrop}）`);
        const ch = gs2.persuadeChance(fallenRuler);
        check(ch > 0, `亡国君主可以招降，成功率 ${Math.round(ch * 100)}%`);

        setRandom(() => 0);
        const pr = gs2.persuade(fallenRuler.def.id);
        setRandom(Math.random);
        check(pr.ok, `招降亡国君主成功：${pr.reason}`);
        check(fallenRuler.faction === me, '归降后改旗易帜到我方');
        check(!gs2.isReigning(fallenRuler), '归降后不再是君主，只是带加成的客将');
        check(gs2.rulerOf(fallenFaction) === null,
            `${FACTION_MAP[fallenFaction] ? FACTION_MAP[fallenFaction].name : fallenFaction}`
            + ' 不再认他为君主，不会出现「一朝两主」');
        check(fallenRuler.loyalty === Balance.recruitLoyalty,
            `归降后忠诚重置为 ${Balance.recruitLoyalty}`);

        // ---- 君威加成：数值必须真的进公式 ----
        const home = gs2.cityOfGeneral(fallenRuler.def.id);
        check(!!home, `归降的旧主落脚在 ${home ? home.name : '（无）'}`);

        const goldRuler = Array.from(gs2.generals.values())
            .find((g) => g.def.bonus && (g.def.bonus.gold || 0) > 0);
        if (home && goldRuler) {
            const saved = home.generals.slice();
            home.generals = [];
            const base = gs2.provinceIncome(home);
            home.generals = [goldRuler.def.id];
            const boosted = gs2.provinceIncome(home);
            home.generals = saved;
            const gb = (goldRuler.def.bonus && goldRuler.def.bonus.gold) || 0;
            const ratio = boosted / Math.max(1, base);
            check(Math.abs(ratio - (1 + gb)) < 0.02,
                `${goldRuler.def.name} 驻城后金币收入 ×${ratio.toFixed(2)}`
                + `（预期 ×${(1 + gb).toFixed(2)}）`);
        }

        const goldRulers = Array.from(gs2.generals.values())
            .filter((g) => g.def.bonus && (g.def.bonus.gold || 0) > 0);
        if (home && goldRulers.length >= 2) {
            const saved = home.generals.slice();
            home.generals = [goldRulers[0].def.id, goldRulers[1].def.id];
            const got = gs2.rulerBonusAt(home, 'gold');
            home.generals = saved;
            const a = (goldRulers[0].def.bonus && goldRulers[0].def.bonus.gold) || 0;
            const b = (goldRulers[1].def.bonus && goldRulers[1].def.bonus.gold) || 0;
            check(Math.abs(got - Math.max(a, b)) < 1e-9,
                `同城两位君主取最高（${Math.round(got * 100)}%），不叠加`);
        }
    }
}

// 数据完整性：君主必须带称号与至少一项加成，非君主不许带
let bonusBad = 0;
for (const def of GENERALS) {
    if (!def.ruler) {
        if (def.bonus) bonusBad++;
        continue;
    }
    const b = def.bonus;
    if (!b || !b.title) {
        bonusBad++;
        continue;
    }
    const sum = (b.atk || 0) + (b.def || 0) + (b.gold || 0) + (b.food || 0) + (b.persuade || 0);
    if (sum <= 0) bonusBad++;
}
check(bonusBad === 0,
    `${rulers.length} 位君主都有称号与至少一项加成，非君主不带 bonus`);

// ----------------------------------------------------------------------
// 9. UI 接线静态守卫（node:fs 必须放在 async 函数里，顶层 await 会报错）
// ----------------------------------------------------------------------
async function uiGuards(): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const ctrl = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const state = readFileSync('assets/scripts/core/GameState.ts', 'utf8');
    const readme = readFileSync('README.md', 'utf8');
    const simGame = readFileSync('tools/sim-game.ts', 'utf8');
    const logicTest = readFileSync('tools/logic-test.ts', 'utf8');

    section('9. UI 接线');
    for (const name of ['openPrisonMenu', 'refreshPrisonMenu', 'refreshPrisonButton',
        'onPrisonRecruit', 'onPrisonRelease', 'onPrisonPage', 'paintPrisonButton']) {
        check(ctrl.indexOf(`private ${name}(`) >= 0, `GameController 实现了 ${name}()`);
    }
    check(ctrl.indexOf("makeRectStroke('PrisonBtn'") >= 0
        && ctrl.indexOf("makeRectStroke('PrisonPanel'") >= 0,
    '顶栏「俘虏」入口与俘虏营弹窗都建出来了');
    check((ctrl.match(/this\.prisonPanel\.active = false;/g) || []).length >= 2,
        '剧本 / 结算弹窗都会关掉俘虏营（三个弹窗共用遮罩，必须互斥）');
    check(ctrl.indexOf('this.state.persuadeChance(g)') >= 0
        && ctrl.indexOf('this.state.persuade(gid)') >= 0
        && ctrl.indexOf('this.state.release(gid)') >= 0,
    'UI 只调 state 的招降 / 放归，成功率不另写一套公式');
    check(ctrl.indexOf('不可招降') >= 0
        && ctrl.indexOf('失去所有城池后可招') >= 0,
    '俘虏营明说：在位君主不可招降、失去所有城池后可招');
    check(ctrl.indexOf('this.state.isReigning(g)') >= 0,
        '俘虏营按钮明暗由 isReigning 决定，不按 ruler 标记一刀切');
    check(ctrl.indexOf('this.bonusText(') >= 0
        && ctrl.indexOf('BONUS_KIND') >= 0,
    '面板按 BONUS_KIND 拼加成文本，不各写一套 if');
    check(state.indexOf("mul: 1 + this.rulerBonusAt(from, 'atk')") >= 0
        && state.indexOf("mul: 1 + this.rulerBonusAt(to, 'def')") >= 0,
    '君主加成接在战力上：进攻算 atk、防守算 def');
    check(state.indexOf('onFactionFallen(') >= 0
        && state.indexOf('Balance.fallenLoyaltyDrop') >= 0,
    '亡国时统一降忠诚，这是「君主失去土地后可招」的前提');
    check(ctrl.indexOf('this.rulerLine(p)') >= 0
        && ctrl.indexOf('this.loyaltyLine(p)') >= 0,
    '城池面板显示本城君主加成与守将忠诚');
    check(ctrl.indexOf('ROLE_NAME[g.def.role]') >= 0,
        '俘虏营显示完整的武将 / 文官身份名');
    check(ctrl.indexOf('this.refreshPrisonButton()') >= 0,
        'refreshAll() 会刷新顶栏俘虏提示（抓到人立刻可见）');
    check(ctrl.indexOf('newPrisoners') >= 0,
        '攻城结算点名生擒了谁，并引导玩家去俘虏营');
    check(ctrl.indexOf('const host = this.menuLayer') >= 0,
        '弹窗开着时 toast 挂到遮罩层，招降 / 放归的反馈不会被挡住');
    check(ctrl.indexOf('✓') < 0 && ctrl.indexOf('✔') < 0,
        '界面文案没有缺字形的勾选符号');

    check(state.indexOf('const mayCapture = captor === this.playerFaction') >= 0,
        '生擒只在玩家攻占时发生（AI 不关押俘虏）');
    check(state.indexOf('if (this.isReigning(g))') >= 0
        && state.indexOf('Balance.recruitLoyalty') >= 0,
    '状态层用 isReigning() 拦在位君主，归降给初始忠诚');
    check(simGame.indexOf('gs.prisonersOf(gs.playerFaction)') >= 0
        && simGame.indexOf('gs.persuade(') >= 0
        && simGame.indexOf('gs.release(') >= 0,
    '长测会经营俘虏营，招降 / 放归两条分支都被真跑到');
    check(logicTest.indexOf('prisonersOf') >= 0
        && logicTest.indexOf('在营') >= 0,
    'logic-test 的武将守恒口径改成「在城 + 在营」');
    check(readme.indexOf('俘虏营') >= 0
        && readme.indexOf('放归') >= 0
        && readme.indexOf('招降') >= 0,
    'README 写清君主 / 忠诚 / 俘虏营这套玩法');
}

uiGuards().then(() => {
    console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
    if (failures > 0) process.exitCode = 1;
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
