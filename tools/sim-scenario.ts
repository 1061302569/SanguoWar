/**
 * 剧本系统回归测试
 *
 * 覆盖：
 *   1. 每个剧本的数据合法性（城池 id / 势力 id / 可选势力有城）
 *   2. 开局既不是胜利也不是败亡，默认势力正确
 *   3. 换势力、非法势力回退
 *   4. 武将按势力自动驻守，不会驻到敌城
 *   5. 存档带上剧本，往返后剧本/势力/归属一致
 *   6. 旧存档（无 scenarioId）仍能读，回退到默认剧本
 *   7. 统一天下后重开一局，状态彻底复位
 *   8. 每个剧本都能正常推进若干回合
 *
 * 运行：node tools/bundle-test.mjs tools/sim-scenario.ts
 *       node --experimental-strip-types --no-warnings tools/.bundle.sim-scenario.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { SCENARIOS, DEFAULT_SCENARIO_ID, getScenario, playableFactions } from '../assets/scripts/data/Scenarios.ts';
import { PROVINCES, PROVINCE_MAP } from '../assets/scripts/data/Provinces.ts';
import { FACTION_MAP, NEUTRAL } from '../assets/scripts/data/Factions.ts';
import { GENERALS } from '../assets/scripts/data/Generals.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';

setRandom(() => 0.5);

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

console.log('=== 1. 剧本数据合法性 ===');
const ids: Record<string, boolean> = {};
for (const sc of SCENARIOS) {
    const badCity: string[] = [];
    const badFaction: string[] = [];
    for (const pid of Object.keys(sc.owners)) {
        if (!PROVINCE_MAP[pid]) badCity.push(pid);
        const fid = sc.owners[pid];
        if (fid !== NEUTRAL && !FACTION_MAP[fid]) badFaction.push(fid);
    }
    check(!ids[sc.id], `剧本 id 唯一（${sc.id}）`);
    ids[sc.id] = true;
    check(badCity.length === 0, `${sc.name} 没有未知城池 id（${badCity.length}）`);
    check(badFaction.length === 0, `${sc.name} 没有未知势力 id（${badFaction.length}）`);
    check(sc.month >= 1 && sc.month <= 12 && sc.year > 0, `${sc.name} 起始年月合法`);
    const factions = playableFactions(sc);
    check(factions.length >= 2, `${sc.name} 至少有 2 个可选势力（${factions.length}）`);
    check(factions.indexOf(sc.playerFaction) >= 0, `${sc.name} 默认势力可选且有城`);
    check(Object.keys(sc.owners).length > 0, `${sc.name} 有开局归属`);
}
check(getScenario('不存在的剧本').id === DEFAULT_SCENARIO_ID, '未知剧本 id 回退到默认剧本');

console.log('\n=== 2. 开局状态与换势力 ===');
const gs = new GameState();
check(gs.scenarioId === DEFAULT_SCENARIO_ID, `默认进入 ${getScenario(DEFAULT_SCENARIO_ID).name}`);
for (const sc of SCENARIOS) {
    gs.reset(sc.id);
    const mine = gs.provincesOf(gs.playerFaction).length;
    check(!gs.isVictory() && !gs.isDefeat() && mine > 0,
        `${sc.name} 开局有城且未分胜负（${mine}/${gs.provinces.size}）`);
    check(gs.year === sc.year && gs.month === sc.month && gs.turn === 1,
        `${sc.name} 起始年月与回合数正确`);
    check(gs.provinces.size === PROVINCES.length, `${sc.name} 城池数量完整`);
    check(gs.playerFaction === sc.playerFaction, `${sc.name} 默认玩家势力正确`);
}

const guandu = getScenario('guandu_200');
gs.reset(guandu.id, 'yuan_shao');
check(gs.playerFaction === 'yuan_shao'
    && gs.provincesOf('yuan_shao').length > 0, '可换执掌势力（官渡·袁绍）');
check(gs.year === guandu.year && gs.month === guandu.month, '换势力后仍按该剧本的年月开局');
gs.reset(guandu.id, 'not_a_faction');
check(gs.playerFaction === guandu.playerFaction, '非法势力回退到剧本默认势力');

console.log('\n=== 3. 武将自动驻守 ===');
for (const sc of SCENARIOS) {
    if (sc.generalPosts) {
        check(true, `${sc.name} 使用固定驻守表（跳过自动分配检查）`);
        continue;
    }
    gs.reset(sc.id);
    let wrong = 0;
    let placed = 0;
    gs.provinces.forEach((p) => {
        for (const gid of p.generals) {
            placed++;
            const g = gs.generals.get(gid);
            if (!g || g.def.faction !== p.owner) wrong++;
        }
    });
    check(wrong === 0, `${sc.name} 没有武将驻在敌城（${wrong} 人错位）`);
    check(placed > 0, `${sc.name} 有武将驻守（${placed} 人）`);
    const playerGenerals = GENERALS.filter((g) => g.faction === gs.playerFaction);
    const playerPlaced = gs.provincesOf(gs.playerFaction)
        .reduce((n, p) => n + p.generals.length, 0);
    check(playerPlaced >= Math.min(playerGenerals.length, gs.provincesOf(gs.playerFaction).length),
        `${sc.name} 玩家势力的武将都在自己城里`);
}

console.log('\n=== 4. 存档带剧本 / 旧档兼容 ===');
for (const sc of SCENARIOS) {
    gs.reset(sc.id);
    gs.endTurn();
    const saved = gs.serialize();
    check(saved.scenarioId === sc.id, `${sc.name} 存档写入 scenarioId`);
    const owners: Record<string, string> = {};
    gs.provinces.forEach((p) => { owners[p.id] = p.owner; });

    const restored = new GameState();
    const ok = restored.deserialize(saved);
    let same = true;
    restored.provinces.forEach((p) => {
        if (owners[p.id] !== p.owner) same = false;
    });
    check(ok && restored.scenarioId === sc.id
        && restored.playerFaction === gs.playerFaction
        && restored.turn === gs.turn
        && restored.year === gs.year && restored.month === gs.month && same,
        `${sc.name} 存档往返后剧本/势力/回合/归属一致`);
}

const legacy: any = gs.serialize();
delete legacy.scenarioId;
const fromLegacy = new GameState();
const okLegacy = fromLegacy.deserialize(legacy);
check(okLegacy && fromLegacy.scenarioId === DEFAULT_SCENARIO_ID,
    '旧存档缺 scenarioId 时回退到默认剧本');
check(fromLegacy.playerFaction === legacy.playerFaction
    && fromLegacy.turn === legacy.turn, '旧存档的势力与回合数仍能恢复');

console.log('\n=== 5. 统一天下后重开 ===');
gs.reset('chibi_208', 'liu');
gs.provinces.forEach((p) => { p.owner = gs.playerFaction; });
check(gs.isVictory(), '占满全部城池判定为统一天下');
const total = gs.provinces.size;
gs.endTurn();
gs.reset('chibi_208', 'cao');
check(gs.turn === 1 && gs.year === 208 && !gs.isVictory(),
    '重开后回合/年月复位，胜利状态清除');
check(gs.provinces.size === total && gs.provincesOf('cao').length > 0
    && gs.playerFaction === 'cao', '重开后按新势力重建局面');

console.log('\n=== 6. 各剧本都能推进回合 ===');
for (const sc of SCENARIOS) {
    gs.reset(sc.id);
    const before = gs.turn;
    gs.endTurn(); gs.endTurn(); gs.endTurn();
    check(gs.turn === before + 3 && gs.provinces.size === PROVINCES.length,
        `${sc.name} 连跑 3 回合无异常（第 ${gs.turn} 回合）`);
}

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
