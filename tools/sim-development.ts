/**
 * 回归：城池发展度与内政
 *
 * 背景：以前每座城的产出只由人口决定，玩家除了「征兵 / 进攻」没有别的选择，
 * 城与城之间也没有养成感。现在每座城有一个 0~100 的发展度：
 *   - 发展度越高，每回合的金币、粮草、月募兵都越多（四项产出共用 devFactor）；
 *   - 每城每回合只能下一道内政指令（治理 / 屯田 / 筑城 / 征兵 四选一），
 *     玩家必须在「现在补兵」和「投资未来」之间取舍；
 *   - 攻占会让发展度受损，打烂的城要重新经营。
 *
 * 本测试守住：
 *   1) 初始发展度合法且与人口/大城加成一致（旧存档回退也用同一套公式）；
 *   2) 三条产出曲线随发展度单调递增，不能出现「发展度高了反而更少」；
 *   3) 四道内政指令的资源收支方向正确，失败不扣资源也不吃行动点；
 *   4) 每城每回合只有一次内政，军事行动不占用这个行动点，换回合会重置；
 *   5) 月募兵受粮草与驻军上限双重约束，AI 拿的是公开打折后的量；
 *   6) 攻占后发展度按 captureDevLoss 受损；
 *   7) 存档往返保留 dev / food / acted / pending，旧存档缺字段时能回退；
 *   8) UI 接线：四个内政按钮、粮草 HUD、面板发展度、自动开关都不被改丢；
 *   9) **回合内只登记、结束回合统一结算**：登记不改数值，一城一令、绝不执行两遍。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-development.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-development.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { Balance } from '../assets/scripts/core/Balance.ts';
import { PROVINCES } from '../assets/scripts/data/Provinces.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

/** 取某个方法/函数的源码片段，用于做 UI 接线静态守卫 */
function bodyOf(src: string, start: string, end: string): string {
    const s = src.indexOf(start);
    if (s < 0) return '';
    const e = end ? src.indexOf(end, s + start.length) : -1;
    // 找不到结束标记时返回「从这里到文件末尾」，别返回数字：
    // 调用方会对结果做 .indexOf()，返回 number 会直接抛 TypeError。
    return e > s ? src.slice(s, e) : src.slice(s);
}

const gs = new GameState();
gs.reset();

// ----------------------------------------------------------------------
console.log('== 1. 初始发展度 ==');
// ----------------------------------------------------------------------
let devBad = 0;
let formulaBad = 0;
for (const p of gs.provinces.values()) {
    if (!(p.dev >= Balance.devMin && p.dev <= Balance.devMax)) {
        devBad++;
    }
    if (p.dev !== gs.initialDev(p)) {
        formulaBad++;
    }
}
check(devBad === 0, `全部 ${gs.provinces.size} 座城的发展度落在 ${Balance.devMin}~${Balance.devMax}`);
check(formulaBad === 0, '开局发展度一律由 initialDev() 推算（旧存档回退用的是同一套公式）');

// 人口越多、州治大城，开局越繁华
const sorted = Array.from(gs.provinces.values()).sort((a, b) => b.pop - a.pop);
const biggest = sorted[0];
const smallest = sorted[sorted.length - 1];
check(biggest.dev > smallest.dev,
    `人口最多的 ${biggest.name}（pop ${Math.round(biggest.pop)}）发展度高于最末的 ${smallest.name}`);

// 同样人口下，大城应该更高
const samePop = Array.from(gs.provinces.values())
    .filter((p) => p.def.pop === 30);
if (samePop.length >= 2) {
    const cityOne = samePop.filter((p) => p.def.city);
    const townOne = samePop.filter((p) => !p.def.city);
    if (cityOne.length > 0 && townOne.length > 0) {
        check(cityOne[0].dev > townOne[0].dev,
            `同人口时州治大城 ${cityOne[0].name} 的发展度高于普通城 ${townOne[0].name}`);
    }
}

// ----------------------------------------------------------------------
console.log('\n== 2. 产出随发展度单调递增 ==');
// ----------------------------------------------------------------------
const probe = gs.provinces.get('luoyang') || gs.provincesOf('cao')[0];
const savedDev = probe.dev;
const rows: Array<{ dev: number; gold: number; food: number; rein: number }> = [];
for (const d of [0, 25, 50, 75, 100]) {
    probe.dev = d;
    rows.push({
        dev: d,
        gold: gs.provinceIncome(probe),
        food: gs.foodIncome(probe),
        rein: gs.autoReinforce(probe),
    });
}
let monoGold = true;
let monoFood = true;
let monoRein = true;
for (let i = 1; i < rows.length; i++) {
    if (rows[i].gold <= rows[i - 1].gold) monoGold = false;
    if (rows[i].food <= rows[i - 1].food) monoFood = false;
    if (rows[i].rein <= rows[i - 1].rein) monoRein = false;
}
check(monoGold, `金币月收随发展度递增（dev0 ${rows[0].gold} → dev100 ${rows[4].gold}）`);
check(monoFood, `粮草月产随发展度递增（dev0 ${rows[0].food} → dev100 ${rows[4].food}）`);
check(monoRein, `月募兵随发展度递增（dev0 ${rows[0].rein} → dev100 ${rows[4].rein}）`);
// 旧版 dev=0 时补兵为 0，人口/规模与发展度被写进同一条公式里耦合了两遍。
// 现在「人口定规模、发展度定效率」：0 也有基础兵役，满发展度正好翻倍。
check(rows[0].rein > 0 && rows[4].rein >= rows[0].rein * 1.9
    && rows[4].rein <= rows[0].rein * 2.1,
`发展度 0 有基础兵役，100 时正好翻倍（${rows[0].rein} → ${rows[4].rein}）`);
// 四项产出共用同一个 devFactor，不许再冒出第二套系数
const ratio = 1 + Balance.devOutputFactor;
check(Math.abs(rows[4].gold / rows[0].gold - ratio) < 0.06
    && Math.abs(rows[4].food / rows[0].food - ratio) < 0.06,
`金币 / 粮草都用同一个发展度倍率（满级 / 0 级 ≈ ${ratio}）`);
// 满发展度的产出至少要比 0 发展度高 50%，否则「经营」没有意义
check(rows[4].gold >= rows[0].gold * 1.5, '满发展度的金币产出比 0 发展度高 50% 以上');
probe.dev = savedDev;

// ----------------------------------------------------------------------
console.log('\n== 3. 四道内政指令的收支 ==');
// ----------------------------------------------------------------------
{
    const g = new GameState();
    g.reset();
    const p = g.provincesOf('cao')[0];
    const fid = p.owner;
    p.dev = 40;
    g.gold.set(fid, 5000);
    g.food.set(fid, 1000);

    // 治理：花金币换发展度
    const goldBefore = g.gold.get(fid)!;
    const devBefore = p.dev;
    const r1 = g.executeDomestic(p, 'govern', false);
    check(r1.ok && p.dev === devBefore + Balance.governDevGain,
        `治理：发展度 +${Balance.governDevGain}（${devBefore}→${p.dev}）`);
    check(g.gold.get(fid) === goldBefore - Balance.governGoldCost,
        `治理：扣 ${Balance.governGoldCost} 金`);
    check(p.acted, '治理会占用本回合内政行动点');

    // 屯田：不花资源，直接加粮
    const g2 = new GameState();
    g2.reset();
    const p2 = g2.provincesOf('cao')[0];
    const f2 = p2.owner;
    const foodBefore = g2.food.get(f2)!;
    const r2 = g2.executeDomestic(p2, 'farm', false);
    check(r2.ok && r2.amount > 0, `屯田：粮草 +${r2.amount}`);
    check(g2.food.get(f2) === foodBefore + r2.amount, '屯田：粮草进的是势力国库');

    // 筑城：金币 + 粮草换工事
    const g3 = new GameState();
    g3.reset();
    const p3 = g3.provincesOf('cao')[0];
    const f3 = p3.owner;
    g3.gold.set(f3, 5000);
    g3.food.set(f3, 5000);
    const fortBefore = p3.fort;
    const r3 = g3.executeDomestic(p3, 'fortify', false);
    check(r3.ok && p3.fort === fortBefore + Balance.fortifyFortGain,
        `筑城：工事 ${fortBefore}→${p3.fort}`);
    check(g3.gold.get(f3) === 5000 - Balance.fortifyGoldCost
        && g3.food.get(f3) === 5000 - Balance.fortifyFoodCost,
    '筑城：金币与粮草都扣对了');

    // 征兵：立刻补兵，消耗金币与人口
    const g4 = new GameState();
    g4.reset();
    const p4 = g4.provincesOf('cao')[0];
    const f4 = p4.owner;
    g4.gold.set(f4, 5000);
    p4.troops = 0;
    const capBefore = g4.garrisonCap(p4);
    const r4 = g4.executeDomestic(p4, 'recruit', false);
    check(r4.ok && p4.troops === r4.amount, `征兵：补 ${r4.amount} 兵`);
    check(g4.gold.get(f4)! < 5000, '征兵：消耗金币');
    // 旧版 want = 全部金币 / 单价：点一下国库清零，自动征兵时排序第一的城
    // 把钱全拿走。现在一次只动四分之一国库，其他城也分得到钱。
    check(g4.gold.get(f4)! >= 5000 * (1 - Balance.recruitGoldShare) - 1,
        `单次征兵最多动 ${Balance.recruitGoldShare * 100}% 国库，不会一次清零`);
    check(r4.amount <= Math.ceil(capBefore * Balance.recruitFillRatio) + 1,
        `单次征兵只补 ${Balance.recruitFillRatio * 100}% 缺口，不一次补满`);
}

// ----------------------------------------------------------------------
console.log('\n== 4. 每城每回合只有一次内政 ==');
// ----------------------------------------------------------------------
{
    const g = new GameState();
    g.reset();
    const p = g.provincesOf('cao')[0];
    const fid = p.owner;
    g.gold.set(fid, 5000);
    g.food.set(fid, 5000);

    check(!p.acted, '开局没有下过内政');
    const first = g.executeDomestic(p, 'govern', false);
    check(first.ok, '第一道内政成功');
    const goldAfter = g.gold.get(fid)!;
    const devAfter = p.dev;
    const second = g.executeDomestic(p, 'farm', false);
    check(!second.ok && second.reason.indexOf('已下令') >= 0,
        `同一回合第二道内政被拒：${second.reason}`);
    check(g.gold.get(fid) === goldAfter && p.dev === devAfter,
        '被拒的内政不扣资源、不改数值');

    // 军事行动不占用内政行动点
    const ally = g.provincesOf(fid).filter((q) => q.id !== p.id && g.isAdjacent(p, q))[0];
    if (ally) {
        p.troops = 1000;
        g.moveTroops(p, ally, 100);
        check(p.acted, '调兵不改变内政行动点（已经用过的仍是已用）');
    }
    const fresh = g.provincesOf(fid).filter((q) => !q.acted)[0];
    if (fresh && ally) {
        fresh.troops = 1000;
        g.moveTroops(fresh, ally, 100);
        check(!fresh.acted, '调兵本身不消耗内政行动点（可以既内政又出兵）');
    }

    // 失败的内政不吃行动点
    const g2 = new GameState();
    g2.reset();
    const p2 = g2.provincesOf('cao')[0];
    p2.dev = Balance.devMax;
    const bad = g2.executeDomestic(p2, 'govern', false);
    check(!bad.ok && !p2.acted, '发展度已满时治理失败，且不占用行动点');

    // 换回合重置
    g.endTurn();
    check(!p.acted, 'endTurn() 后内政行动点重置');
}

// ----------------------------------------------------------------------
console.log('\n== 5. 月募兵 ==');
// ----------------------------------------------------------------------
{
    // 经济结算单独跑：endTurn() 里 AI 会顺手打掉兵力空虚的城，
    // 那样断言的就是「城被攻占」而不是「补兵」，测不出真东西。
    const g = new GameState();
    g.reset();
    const p = g.provincesOf('cao')[0];
    const fid = p.owner;
    p.dev = 100;
    p.troops = 0;
    g.food.set(fid, 100000);
    const econ = (g as any).runEconomy() as { foodIncome: number; reinforced: number };
    check(econ.reinforced > 0, `经济结算月募兵 ${econ.reinforced}`);
    // 人口在结算里会长一点，所以补兵量要跟结算后的 autoReinforce 对
    check(p.troops === g.autoReinforce(p),
        `粮草充足时补满 ${g.autoReinforce(p)}（实际 ${p.troops}）`);
    check(econ.foodIncome > 0, `战报带上月粮产出 ${econ.foodIncome}`);

    // 粮草不够就一点也补不出来（这才是「屯田」存在的理由）
    const g2 = new GameState();
    g2.reset();
    const p2 = g2.provincesOf('cao')[0];
    const f2 = p2.owner;
    p2.dev = 100;
    p2.troops = 0;
    g2.food.set(f2, 0);
    const savedCost = Balance.foodPerAutoTroop;
    Balance.foodPerAutoTroop = 100000;   // 临时把粮草变成硬约束
    try {
        (g2 as any).runEconomy();
    } finally {
        Balance.foodPerAutoTroop = savedCost;
    }
    check(p2.troops === 0, '粮草不足时不补兵（不会白送兵）');

    // 驻军已满则不越过上限
    const g3 = new GameState();
    g3.reset();
    const p3 = g3.provincesOf('cao')[0];
    const f3 = p3.owner;
    p3.dev = 100;
    p3.troops = g3.garrisonCap(p3);
    g3.food.set(f3, 100000);
    (g3 as any).runEconomy();
    check(p3.troops <= g3.garrisonCap(p3), '驻军不会被补兵顶破上限');

    // 战报字段：一次完整回合后 report 里带着补兵数
    const g4 = new GameState();
    g4.reset();
    const p4 = g4.provincesOf('cao')[0];
    p4.troops = Math.max(0, g4.garrisonCap(p4) - 200);
    const rep = g4.endTurn();
    check(typeof rep.reinforced === 'number' && rep.reinforced >= 0,
        `回合战报带月募兵数（${rep.reinforced}）`);
    check(rep.goldIncome > 0 && rep.foodIncome > 0,
        '战报的钱粮是本月实收（不再用 AI 行动后的下月预测值）');

    // AI 折扣是难度设定，不是隐藏修补：参数存在且文档必须写明
    check(Balance.aiSupplyFactor > 0 && Balance.aiSupplyFactor < 1,
        `AI 月募兵效率 ${Balance.aiSupplyFactor * 100}%（避免 17 家滚雪球）`);
}

// ----------------------------------------------------------------------
console.log('\n== 6. 攻占后发展度受损 ==');
// ----------------------------------------------------------------------
{
    const g = new GameState();
    g.reset();
    const from = g.provincesOf('cao')[0];
    const target = g.attackTargets(from)[0];
    if (target) {
        target.troops = 1;
        from.troops = 50000;
        target.dev = 80;
        const res = g.attack(from, target);
        check(!!res && res.captured, `强攻 ${target.name} 成功`);
        check(target.dev === Math.max(Balance.devMin,
            Math.round(80 * (1 - Balance.captureDevLoss))),
        `攻占后发展度从 80 降到 ${target.dev}（打烂的城要重新经营）`);
    } else {
        check(false, '开局应有可攻目标，用于验证攻占后的发展度损失');
    }
}

// ----------------------------------------------------------------------
console.log('\n== 7. AI 也会经营 ==');
// ----------------------------------------------------------------------
{
    const g = new GameState();
    g.reset();
    // 关掉玩家方针：本节只关心 AI 的治理会不会刷玩家战报
    g.domesticPolicy = 'none';
    const aiCity = Array.from(g.provinces.values())
        .filter((p) => p.owner !== g.playerFaction && p.owner !== 'neutral')
        .sort((a, b) => a.dev - b.dev)[0];
    const devBefore = aiCity.dev;
    const logsBefore = g.logs.length;
    for (let i = 0; i < 6; i++) {
        g.endTurn();
    }
    const after = g.provinces.get(aiCity.id)!;
    check(after.dev >= devBefore, `AI 城 ${after.name} 发展度没有倒退（${devBefore}→${after.dev}）`);
    // AI 治理必须传 log=false，否则十几个势力每回合刷满玩家战报
    const aiGovernLogs = g.logs.slice(logsBefore)
        .filter((s) => s.indexOf('治理') >= 0);
    check(aiGovernLogs.length === 0,
        `AI 治理不写玩家战报（${g.logs.length - logsBefore} 条战报里 0 条治理）`);
}

// ----------------------------------------------------------------------
console.log('\n== 8. 存档兼容 ==');
// ----------------------------------------------------------------------
{
    const g = new GameState();
    g.reset();
    const p = g.provincesOf('cao')[0];
    const fid = p.owner;
    g.gold.set(fid, 5000);
    p.dev = 66;
    g.executeDomestic(p, 'govern', false);
    g.food.set(fid, 1234);
    const devSaved = p.dev;
    const actedSaved = p.acted;

    const raw = JSON.parse(JSON.stringify(g.serialize()));
    check(raw.provinces[p.id].dev === devSaved, `存档写入 dev=${devSaved}`);
    check(raw.food[fid] === 1234, '存档写入粮草');

    const g2 = new GameState();
    check(g2.deserialize(raw), '存档可以读回');
    const p2 = g2.provinces.get(p.id)!;
    check(p2.dev === devSaved, `读档后发展度保持 ${p2.dev}`);
    check(p2.acted === actedSaved, '读档后「本回合已下令」状态保持');
    check(g2.food.get(fid) === 1234, '读档后粮草保持');

    // 旧存档：没有 dev / food 字段
    const legacy = JSON.parse(JSON.stringify(g.serialize()));
    delete legacy.food;
    for (const id of Object.keys(legacy.provinces)) {
        delete legacy.provinces[id].dev;
        delete legacy.provinces[id].acted;
    }
    const g3 = new GameState();
    check(g3.deserialize(legacy), '旧存档（无 dev / food）仍可读');
    let legacyBad = 0;
    for (const q of g3.provinces.values()) {
        if (q.dev !== g3.initialDev(q)) {
            legacyBad++;
        }
    }
    check(legacyBad === 0, '旧存档按 initialDev() 补齐发展度');
    check(g3.foodOf(g3.playerFaction) === Balance.startFood,
        `旧存档按 startFood=${Balance.startFood} 补齐粮草`);
}

// ----------------------------------------------------------------------
console.log('\n== 9. 内政自动化：一个开关 + 最后一道指令 ==');
// ----------------------------------------------------------------------
{
    /** 玩家城池的总发展度（用来判断「这回合到底有没有被治理」） */
    const sumDev = (g: GameState): number => {
        let s = 0;
        for (const p of g.provincesOf(g.playerFaction)) {
            s += p.dev;
        }
        return s;
    };
    /** 是否有非我方邻城（前线判定，与 GameState.hasEnemyNeighbor 一致） */
    const hasEnemy = (g: GameState, p: any): boolean => {
        for (const id of p.borders) {
            const q = g.provinces.get(id);
            if (q && q.owner !== p.owner) {
                return true;
            }
        }
        return false;
    };
    /** 把玩家城池的驻军补满，避免 AI 在测试回合里夺城干扰断言 */
    const holdLine = (g: GameState): void => {
        for (const p of g.provincesOf(g.playerFaction)) {
            p.troops = g.garrisonCap(p);
        }
    };
    /** 把 AI 兵力清零：本回合不会有任何进攻，断言只反映「自动内政」本身 */
    const disarmAi = (g: GameState): void => {
        for (const p of g.provinces.values()) {
            if (p.owner !== g.playerFaction) {
                p.troops = 0;
            }
        }
    };

    // 默认关掉自动 = 纯手动
    const g0 = new GameState();
    g0.reset();
    check(g0.domesticPolicy === 'none', '默认关掉自动（= 手动）：没表态就不该偷偷花钱');

    // 状态就是「最后一道指令 + 一个自动开关」，不再单独存方针
    const gA = new GameState();
    gA.reset();
    gA.rememberOrder('farm');
    check(gA.domesticPolicy === 'none', '没开自动时，最后一道指令不会生效');
    gA.autoDomestic = true;
    check(gA.domesticPolicy === 'farm', '打开自动后，按最后一道指令执行');
    gA.domesticPolicy = 'none';
    check(!gA.autoDomestic, '把 domesticPolicy 设成 none 等于关掉自动');

    // none：不选就是手动
    const g1 = new GameState();
    g1.reset();
    g1.domesticPolicy = 'none';
    holdLine(g1);
    const dev1 = sumDev(g1);
    const rep1 = g1.endTurn();
    check(rep1.autoOrders === 0, '没开自动时 autoOrders = 0');
    check(sumDev(g1) <= dev1, '没开自动时没有任何城被自动治理');

    // govern：自动补齐
    const g2 = new GameState();
    g2.reset();
    g2.domesticPolicy = 'govern';
    g2.gold.set(g2.playerFaction, 5000);
    holdLine(g2);
    disarmAi(g2);
    const before2 = new Map<string, number>();
    for (const p of g2.provincesOf(g2.playerFaction)) {
        before2.set(p.id, p.dev);
    }
    const rep2 = g2.endTurn();
    let governed = 0;
    for (const id of Array.from(before2.keys())) {
        const p = g2.provinces.get(id)!;
        if (p.owner === g2.playerFaction && p.dev > before2.get(id)!) {
            governed++;
        }
    }
    check(rep2.autoOrders > 0, `自动治理下令 ${rep2.autoOrders} 城`);
    check(governed === rep2.autoOrders, 'autoOrders 与实际发展度提升的城数一致');

    // 排序：钱只够一次时，优先补发展度最低的那座
    const g3 = new GameState();
    g3.reset();
    g3.domesticPolicy = 'govern';
    const mine3 = g3.provincesOf(g3.playerFaction);
    const devs3 = [20, 55, 80];
    for (let i = 0; i < mine3.length && i < devs3.length; i++) {
        mine3[i].dev = devs3[i];
    }
    holdLine(g3);
    g3.gold.set(g3.playerFaction, Balance.governGoldCost);   // 只够治理一座
    g3.endTurn();
    const lowCity = g3.provinces.get(mine3[0].id)!;
    check(lowCity.dev === 28,
        `钱只够一次时，先治理发展度最低的 ${lowCity.name}（20→${lowCity.dev}）`);

    // 手动优先：回合内登记过的城，结束回合只执行这一道，不会被自动方针再补一次
    const g4 = new GameState();
    g4.reset();
    g4.domesticPolicy = 'govern';
    g4.gold.set(g4.playerFaction, 9999);
    const first4 = g4.provincesOf(g4.playerFaction)[0];
    holdLine(g4);
    const dev4 = first4.dev;
    check(g4.queueDomestic(first4, 'govern') === 'selected', '回合内可以登记一道内政');
    check(first4.dev === dev4, '登记只改选择，不立刻提高发展度');
    g4.endTurn();
    const after4 = g4.provinces.get(first4.id)!;
    check(after4.dev === dev4 + Balance.governDevGain,
        '手动登记的城只被结算一次（+8 而不是 +16）');

    // 自动筑城：前线优先，但后方城也会轮到 —— 选了方针就不该偷偷跳过几座
    const g5 = new GameState();
    g5.reset();
    g5.domesticPolicy = 'fortify';
    g5.gold.set(g5.playerFaction, 99999);
    g5.food.set(g5.playerFaction, 99999);
    holdLine(g5);
    const front: string[] = [];
    const rear: string[] = [];
    for (const p of g5.provincesOf(g5.playerFaction)) {
        (hasEnemy(g5, p) ? front : rear).push(p.id);
    }
    const fortBefore = new Map<string, number>();
    for (const p of g5.provincesOf(g5.playerFaction)) {
        fortBefore.set(p.id, p.fort);
    }
    g5.endTurn();
    let frontUp = 0;
    let rearUp = 0;
    for (const id of front) {
        const p = g5.provinces.get(id)!;
        if (p.owner === g5.playerFaction && p.fort > fortBefore.get(id)!) {
            frontUp++;
        }
    }
    for (const id of rear) {
        const p = g5.provinces.get(id)!;
        if (p.owner === g5.playerFaction && p.fort > fortBefore.get(id)!) {
            rearUp++;
        }
    }
    check(frontUp > 0, `自动筑城给前线城加工事（${frontUp} 座）`);
    if (rear.length > 0) {
        check(rearUp > 0,
            `后方城也会执行（${rearUp}/${rear.length} 座），不再被静默剔除`);
    }

    // 资源只够筑一座时，排序必须让前线城先拿到 —— 优化的是「先花在哪」，
    // 而不是直接替玩家把后方城删掉
    const g5b = new GameState();
    g5b.reset();
    g5b.domesticPolicy = 'fortify';
    g5b.gold.set(g5b.playerFaction, Balance.fortifyGoldCost);
    g5b.food.set(g5b.playerFaction, Balance.fortifyFoodCost);
    holdLine(g5b);
    const fort5bBefore = new Map<string, number>();
    for (const p of g5b.provincesOf(g5b.playerFaction)) {
        fort5bBefore.set(p.id, p.fort);
    }
    (g5b as any).settleDomestic();
    const gained5b = g5b.provincesOf(g5b.playerFaction)
        .filter((p) => p.owner === g5b.playerFaction && p.fort > fort5bBefore.get(p.id)!);
    check(gained5b.length > 0 && gained5b.every((p) => hasEnemy(g5b, p)),
        '钱只够一座时优先给前线城筑城（后方只是排后面，不是被剔除）');

    // 粮草充足时自动屯田照样对每座城执行：旧版有个隐藏阈值 600，
    // 玩家选了方针却整轮没动静，非常难理解，已删掉
    const g6 = new GameState();
    g6.reset();
    g6.domesticPolicy = 'farm';
    holdLine(g6);
    g6.food.set(g6.playerFaction, 99999);
    const cities6 = g6.provincesOf(g6.playerFaction).length;
    const rep6 = g6.endTurn();
    check(rep6.autoOrders === cities6,
        `粮草充足时自动屯田仍对全部 ${cities6} 座城执行（不再偷偷跳过）`);
    const rep6b = g6.endTurn();
    check(rep6b.autoOrders >= 0, '自动屯田连续回合不会崩');

    // 自动征兵：预算分给多座城，不再让排序第一的城一次吃光国库
    const g6c = new GameState();
    g6c.reset();
    g6c.domesticPolicy = 'recruit';
    g6c.gold.set(g6c.playerFaction, 3000);
    for (const p of g6c.provincesOf(g6c.playerFaction)) {
        p.troops = 0;
    }
    const done6c = (g6c as any).settleDomestic().auto as number;
    const armed6c = g6c.provincesOf(g6c.playerFaction).filter((p) => p.troops > 0).length;
    check(done6c >= 2 && armed6c >= 2,
        `自动征兵时 ${armed6c} 座城都分到预算（旧版第一座吃光国库，其余全失败）`);

    // 资源不足：静默跳过，不抛错
    const g7 = new GameState();
    g7.reset();
    g7.domesticPolicy = 'govern';
    g7.gold.set(g7.playerFaction, 0);
    holdLine(g7);
    const rep7 = g7.endTurn();
    check(rep7.autoOrders === 0, '金币为 0 时自动治理全部跳过，不报错');

    // 存档
    const g8 = new GameState();
    g8.reset();
    g8.domesticPolicy = 'fortify';
    const raw8 = JSON.parse(JSON.stringify(g8.serialize()));
    check(raw8.autoDomestic === true && raw8.lastOrder === 'fortify',
        '存档写入「自动开关 + 最后一道指令」');
    const g9 = new GameState();
    check(g9.deserialize(raw8), '带自动内政设置的存档可读回');
    check(g9.autoDomestic && g9.lastOrder === 'fortify', '读档恢复自动开关与最后指令');

    // 上一版只有 policy 字段（当时是五个方针按钮）
    const legacy = JSON.parse(JSON.stringify(g8.serialize()));
    delete legacy.autoDomestic;
    delete legacy.lastOrder;
    legacy.policy = 'farm';
    const g10 = new GameState();
    g10.deserialize(legacy);
    check(g10.autoDomestic && g10.lastOrder === 'farm',
        "旧档 policy='farm' 折算为「开自动 + 屯田」");
    legacy.policy = 'manual';
    const g11 = new GameState();
    g11.deserialize(legacy);
    check(!g11.autoDomestic && g11.domesticPolicy === 'none',
        "旧档 policy='manual' 折算为「关自动」");
}

// ----------------------------------------------------------------------
console.log('\n== 10. 回合内只登记，结束回合统一结算 ==');
// ----------------------------------------------------------------------
{
    /** 让 AI 这一回合不会攻城，断言只反映内政结算 */
    const freezeWar = (g: GameState): void => {
        for (const p of g.provincesOf(g.playerFaction)) {
            p.troops = g.garrisonCap(p);
        }
        for (const p of g.provinces.values()) {
            if (p.owner !== g.playerFaction) {
                p.troops = 0;
            }
        }
    };

    // 复现用户报的 bug：开自动 + 方针筑城 + 回合内点一次筑城
    const g = new GameState();
    g.reset();
    g.domesticPolicy = 'fortify';
    g.gold.set(g.playerFaction, 99999);
    g.food.set(g.playerFaction, 99999);
    freezeWar(g);
    const mine = g.provincesOf(g.playerFaction);
    const fort0 = new Map(mine.map((p) => [p.id, p.fort]));
    const gold0 = g.gold.get(g.playerFaction)!;
    const food0 = g.food.get(g.playerFaction)!;

    const first = mine[0];
    check(g.queueDomestic(first, 'fortify') === 'selected',
        `回合内点「筑城」→ ${first.name} 只登记，不执行`);
    check(first.pendingDomestic === 'fortify' && !first.acted,
        '登记落在 pendingDomestic，行动点 acted 仍是 false');
    check(g.effectiveOrder(first) === 'fortify',
        'effectiveOrder() 给出这座城将要执行的唯一指令');
    check(first.fort === fort0.get(first.id)
        && g.gold.get(g.playerFaction) === gold0
        && g.food.get(g.playerFaction) === food0,
    '回合内工事 / 金币 / 粮草一律不变（不再立刻筑城）');

    const rep = g.endTurn();
    let up = 0;
    let doubled = 0;
    for (const id of Array.from(fort0.keys())) {
        const p = g.provinces.get(id)!;
        const delta = p.fort - fort0.get(id)!;
        if (delta === Balance.fortifyFortGain) up++;
        if (delta > Balance.fortifyFortGain) doubled++;
    }
    check(doubled === 0, '没有任何一座城一回合筑了两次（每城最多 +1 工事）');
    check(up === mine.length, `结束回合统一结算：${up}/${mine.length} 座城各执行一次`);
    check(rep.domesticOrders === mine.length
        && rep.autoOrders === mine.length - 1,
    `战报：共执行 ${rep.domesticOrders} 城，其中自动补 ${rep.autoOrders} 城`);
    check(first.pendingDomestic === 'none' && !first.acted,
        '结算后登记与行动点都清空，下一回合可以重新选');

    // 关自动：只执行玩家登记的那座城，其余一动不动
    const g2 = new GameState();
    g2.reset();
    g2.domesticPolicy = 'none';
    g2.gold.set(g2.playerFaction, 9999);
    freezeWar(g2);
    const mine2 = g2.provincesOf(g2.playerFaction);
    const dev2 = new Map(mine2.map((p) => [p.id, p.dev]));
    g2.queueDomestic(mine2[0], 'govern');
    check(g2.provinces.get(mine2[0].id)!.dev === dev2.get(mine2[0].id),
        '关自动时，回合内点治理也不会立刻改发展度');
    const rep2 = g2.endTurn();
    const changed2 = mine2.filter((p) => p.dev !== dev2.get(p.id)).length;
    check(changed2 === 1 && rep2.domesticOrders === 1 && rep2.autoOrders === 0,
        `关自动时只执行登记的 1 座城（实际 ${changed2} 座）`);

    // 再点同一道 = 取消；点另一道 = 改选
    const g3 = new GameState();
    g3.reset();
    g3.domesticPolicy = 'none';
    const p3 = g3.provincesOf(g3.playerFaction)[0];
    g3.queueDomestic(p3, 'farm');
    check(g3.queueDomestic(p3, 'farm') === 'cleared' && p3.pendingDomestic === 'none',
        '再点同一道内政键 = 取消选择（选错能反悔，不消耗回合）');
    g3.queueDomestic(p3, 'fortify');
    g3.queueDomestic(p3, 'recruit');
    check(p3.pendingDomestic === 'recruit' && g3.effectiveOrder(p3) === 'recruit',
        '点另一道 = 改选，一座城始终只有一道待执行指令');

    // 手动登记优先于自动方针，且失败的登记不会被自动方针拿去重试
    const g4 = new GameState();
    g4.reset();
    g4.domesticPolicy = 'farm';
    g4.gold.set(g4.playerFaction, 0);       // 治理会失败，屯田不需要钱
    freezeWar(g4);
    const mine4 = g4.provincesOf(g4.playerFaction);
    const p4 = mine4[0];
    g4.queueDomestic(p4, 'govern');
    g4.domesticPolicy = 'farm';              // 把方针设回屯田
    check(g4.effectiveOrder(p4) === 'govern', '手动登记的指令优先于自动方针');
    const rep4 = g4.endTurn();
    check(rep4.domesticOrders === mine4.length - 1
        && rep4.autoOrders === mine4.length - 1,
    '登记失败的城不会被自动方针二次执行（每城只尝试一次）');

    // effectiveOrder 的三种情况
    const g5 = new GameState();
    g5.reset();
    const p5 = g5.provincesOf(g5.playerFaction)[0];
    check(g5.effectiveOrder(p5) === 'none', '没开自动、没登记 → 不执行内政');
    g5.domesticPolicy = 'govern';
    check(g5.effectiveOrder(p5) === 'govern', '只开自动 → 执行方针');
    g5.queueDomestic(p5, 'fortify');
    check(g5.effectiveOrder(p5) === 'fortify', '登记 + 自动 → 以登记为准');

    // 中途存档：已经选好、还没结算的内政不能丢
    const g6 = new GameState();
    g6.reset();
    const p6 = g6.provincesOf(g6.playerFaction)[0];
    g6.queueDomestic(p6, 'farm');
    const raw6 = JSON.parse(JSON.stringify(g6.serialize()));
    check(raw6.provinces[p6.id].pending === 'farm', '存档写入 pending 指令');
    const g7 = new GameState();
    check(g7.deserialize(raw6), '带 pending 的存档可读回');
    check(g7.provinces.get(p6.id)!.pendingDomestic === 'farm', '读档恢复待执行指令');
    const legacy6 = JSON.parse(JSON.stringify(raw6));
    for (const id of Object.keys(legacy6.provinces)) {
        delete legacy6.provinces[id].pending;
    }
    const g8 = new GameState();
    check(g8.deserialize(legacy6), '旧存档（无 pending）仍可读');
    check(g8.provinces.get(p6.id)!.pendingDomestic === 'none',
        '旧存档缺 pending 时回退为「未选择」');
}

// ----------------------------------------------------------------------
console.log('\n== 11. UI 接线守卫 ==');
// ----------------------------------------------------------------------

async function uiGuards(): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const ctrl = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const state = readFileSync('assets/scripts/core/GameState.ts', 'utf8');

    // 四个内政按钮都要存在，且指向各自的内政指令
    check(ctrl.indexOf("this.makeActionButton(panel, '治理'") >= 0
        && ctrl.indexOf("this.makeActionButton(panel, '屯田'") >= 0
        && ctrl.indexOf("this.makeActionButton(panel, '筑城'") >= 0
        && ctrl.indexOf("this.makeActionButton(panel, '征兵'") >= 0,
    '面板上有「治理 / 屯田 / 筑城 / 征兵」四个内政按钮');

    const domestic = bodyOf(ctrl, 'private doDomestic(', 'private onAttackMode');
    check(domestic.indexOf('this.state.queueDomestic(p, order)') >= 0,
        '内政按钮统一走 GameState.queueDomestic()：回合内只登记，规则只有一处');
    check(domestic.indexOf('executeDomestic(') < 0,
        'UI 层不得直接执行内政（否则又出现「回合内一次 + 结束回合一次」）');
    check(domestic.indexOf('结束回合执行') >= 0,
        '登记后的 toast 明说「结束回合执行」，玩家不会以为点了没反应');
    check(ctrl.indexOf("private onRecruit(): void {\n        this.doDomestic('recruit');") >= 0,
        '征兵也走内政入口，因此同样占用行动点');

    // 不能再绕过内政层直接征兵（否则「每回合一次」形同虚设）
    const callDirect = /this\.state\.recruit\(/.test(ctrl);
    check(!callDirect, 'GameController 不再直接调用 state.recruit() 绕过行动点');

    // 面板要显示发展度 / 月粮 / 月募兵
    check(ctrl.indexOf('发展度 ${p.dev}') >= 0, '城池面板显示发展度');
    check(ctrl.indexOf('this.state.foodIncome(p)') >= 0, '城池面板显示月粮产出');
    check(ctrl.indexOf('this.state.autoReinforce(p)') >= 0, '城池面板显示每回合月募兵');
    check(ctrl.indexOf('待执行：') >= 0, '城池面板写出「待执行」的指令，而不是「已下令」');
    check(ctrl.indexOf('this.state.effectiveOrder(p)') >= 0,
        '面板问 state.effectiveOrder()，和结算用同一个答案');

    // HUD 常驻粮草
    check(ctrl.indexOf('this.foodLabel.string = `粮草 ${st.foodOf(st.playerFaction)}`') >= 0,
        '顶栏常驻显示粮草余额');
    check(state.indexOf('public foodOf(factionId: string)') >= 0,
        'HUD 通过 state.foodOf() 取粮草，不直接读 Map');

    // 选择可以改，内政键不能再变暗（旧版「已下令才变暗」，现在那是结算时的事）
    check(ctrl.indexOf('private setDomesticDim(') < 0
        && ctrl.indexOf('this.setDomesticDim(') < 0,
    '不再把内政键变暗：登记只是选择，玩家随时能改选 / 取消');

    // 军事与内政分两行，别再挤成一行
    check(ctrl.indexOf('const bottom = row === 0 ? 64 : 8;') >= 0,
        '面板按钮分两行（上排内政、下排军事）');

    // ---- 内政自动化：一套按钮 + 一个「自动」开关，词只出现一次 ----
    check(ctrl.indexOf("makeBox('PolicyBar'") < 0,
        '标题行不再摆第二套内政按钮（同一批词出现两遍，玩家分不清）');
    check(ctrl.indexOf("private onSetPolicy(") < 0
        && ctrl.indexOf('this.refreshPolicyButtons()') < 0,
    '旧的「方针开关」实现已彻底移除');
    let dupWords = 0;
    for (const pid of ['govern', 'farm', 'fortify', 'recruit']) {
        if (ctrl.indexOf(`['${pid}',`) >= 0) {
            dupWords++;
        }
    }
    check(dupWords === 0, '没有第二份内政指令数组（内政词只在按钮上出现一次）');
    check(ctrl.indexOf("makeRectStroke('AutoDomestic'") >= 0,
        '面板上有一个「自动」开关');
    const onToggleAuto = bodyOf(ctrl, 'private onToggleAuto(', 'private onResetView');
    check(onToggleAuto.indexOf('this.state.autoDomestic = !this.state.autoDomestic') >= 0,
        '「自动」是一个开/关，不是第五个方针选项');
    check(onToggleAuto.indexOf('this.saveGame()') >= 0,
        'onToggleAuto 存档（下次进游戏还是这个选择）');
    check(onToggleAuto.indexOf('this.refreshAutoButton()') >= 0
        && onToggleAuto.indexOf('this.refreshDomesticButtons()') >= 0,
    '切换自动后立刻重画开关与按钮高亮');
    // 自动在做什么，必须能从同一套按钮上看出来
    const refreshDomestic = bodyOf(ctrl, 'private refreshDomesticButtons(', 'private onToggleAuto');
    check(refreshDomestic.indexOf('this.state.effectiveOrder(sel)') >= 0
        && refreshDomestic.indexOf('active === order') >= 0,
    '这座城将要执行的指令，在对应内政按钮上高亮（不再另开一套开关）');
    check(ctrl.indexOf('this.autoLabel.string = \'自动\';') >= 0
        && ctrl.indexOf('g.fillColor = on ? new Color(146, 106, 38, 255)') >= 0,
    '自动开关有明确的开关态（亮底金边 + 亮字，不用可能缺字形的符号）');
    check(ctrl.indexOf('✓') < 0 && ctrl.indexOf('✔') < 0,
        '界面文案里没有 ✓ 这类符号（系统字体缺字形会渲染成豆腐块）');
    const queueBody = bodyOf(state, 'public queueDomestic(', 'public effectiveOrder(');
    check(queueBody.indexOf('this.rememberOrder(order)') >= 0,
        '最后选的那道指令会成为自动方针（记住玩家最后一次选择）');
    check(queueBody.indexOf('executeDomestic(') < 0
        && queueBody.indexOf('st.pendingDomestic = order') >= 0,
    'queueDomestic() 只写登记字段，不执行、不扣资源');
    check(bodyOf(ctrl, 'private refreshAll(', 'private refreshHud(')
        .indexOf('this.refreshAutoButton()') >= 0,
    'refreshAll() 同步自动开关态（读档 / 换势力后不串台）');
    check(ctrl.indexOf('report.domesticOrders') >= 0
        && ctrl.indexOf('report.autoOrders') >= 0,
    '回合结算提示里说明「本回合执行了几城内政、其中几城是自动」');

    // ---- 回合顺序：一条因果链，别再打乱 ----
    const endTurnBody = bodyOf(state, 'public endTurn(', 'this.advanceDate();');
    const iDomestic = endTurnBody.indexOf('this.settleDomestic()');
    const iEcon = endTurnBody.indexOf('this.runEconomy()');
    const iAi = endTurnBody.indexOf('this.runAiPhase()');
    check(iDomestic >= 0 && iEcon > iDomestic && iAi > iEcon,
        '回合顺序：内政统一结算 → 经济结算 → AI 行动');
    check(state.indexOf('runAutoDomestic') < 0,
        '删掉回合内/回合末两套执行入口，只剩 settleDomestic() 一处');
    check(!/this\.state\.executeDomestic\(/.test(ctrl),
        'UI 层没有任何 executeDomestic 调用，玩家回合内不可能改数值');
    const settleBody = bodyOf(state, 'private settleDomestic(', 'private hasEnemyNeighbor');
    check(settleBody.indexOf('p.pendingDomestic = \'none\'') >= 0,
        '统一结算后清空登记，选择不会漏到下回合');
    check(endTurnBody.indexOf('report.goldIncome = econ.goldIncome') >= 0
        && endTurnBody.indexOf('report.foodIncome = econ.foodIncome') >= 0,
    '战报钱粮填本月实收，不混 AI 行动后的下月预测');

    // ---- 规则透明：不留假参数、隐藏阈值、没公开的暗改 ----
    const { readdirSync } = await import('node:fs');
    const walk = (dir: string): string[] => {
        let out: string[] = [];
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const f = `${dir}/${e.name}`;
            if (e.isDirectory()) {
                out = out.concat(walk(f));
            } else if (f.endsWith('.ts')) {
                out.push(f);
            }
        }
        return out;
    };
    const wholeSrc = walk('assets/scripts').map((f) => readFileSync(f, 'utf8')).join('\n');
    const balanceSrc = readFileSync('assets/scripts/core/Balance.ts', 'utf8');
    const keys = [...balanceSrc.matchAll(/^\s{4}(\w+):\s*[^,]+,/gm)].map((m) => m[1]);
    const dead = keys.filter((k) => !new RegExp(`Balance\\.${k}\\b`).test(wholeSrc));
    check(keys.length > 20 && dead.length === 0,
        `Balance 里没有从未接线的假参数（${keys.length} 项全有引用）`);
    check(balanceSrc.indexOf('autoFarmFoodFloor') < 0
        && state.indexOf('hasEnemyNeighbor(p))') < 0,
    '不再有「粮草够了整轮跳过」「后方城直接剔除」这类隐藏过滤');
    const readme = readFileSync('README.md', 'utf8');
    check(readme.indexOf('aiSupplyFactor') >= 0,
        'AI 补给折扣在 README 公开（难度设定，不是隐藏规则）');
    check(readme.indexOf('结束回合统一结算') >= 0
        && readme.indexOf('settleDomestic()') >= 0,
    'README 写清「回合内只选、结束回合统一结算」这条唯一执行时点');
    check(readme.indexOf('已下令的城四个内政键一起变暗') < 0,
        'README 不再描述旧的「已下令就变暗」交互');
    check(ctrl.indexOf('自动：') >= 0 && ctrl.indexOf('自动方针→') >= 0,
        '面板常驻显示自动方针，手动改方针时 toast 明确告知');
    check(ctrl.indexOf('月募兵') >= 0 && ctrl.indexOf('自动补兵') < 0,
        '面板用「月募兵」，不再和「自动内政」撞词');
    // 四项产出只有一个倍率入口
    const factorUses = (state.match(/devFactor\(st\)/g) || []).length;
    check(factorUses >= 4,
        `金币 / 粮草 / 月募兵 / 屯田共用 devFactor()（源码中出现 ${factorUses} 次）`);
}

uiGuards().then(() => {
    console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
    if (failures > 0) {
        process.exitCode = 1;
    }
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
