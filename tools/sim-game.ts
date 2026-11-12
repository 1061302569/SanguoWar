/**
 * 端到端玩法模拟：不依赖引擎，直接把一局游戏跑到结束。
 * 验证回合循环、AI 行动、经济、胜负判定在长时间运行下不会崩。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-game.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-game.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { Balance } from '../assets/scripts/core/Balance.ts';

const gs = new GameState();

function snapshot(label: string): void {
    const mine = gs.provincesOf(gs.playerFaction);
    console.log(
        `[${label}] ${gs.dateText()} 回合${gs.turn} `
        + `据点${mine.length} 兵力${gs.totalTroops(gs.playerFaction)} `
        + `金币${Math.round(gs.gold.get(gs.playerFaction) ?? 0)} `
        + `粮草${gs.foodOf(gs.playerFaction)} `
        + `武将${gs.generals.size}`,
    );
}

snapshot('初始');

let guard = 0;
let captures = 0;
let recruited = 0;
let released = 0;
while (!gs.isVictory() && !gs.isDefeat() && guard < 200) {
    guard++;

    // 模拟玩家经营俘虏营：好招的招、死忠的放回去降忠诚（下次再抓更好招），
    // 君主只能放归。以前长测完全不处置，30+ 名将领一直躺在营里，
    // 既测不到招降 / 放归，也把敌方守将全搬空、把战线推得虚高。
    for (const g of gs.prisonersOf(gs.playerFaction)) {
        if (g.def.ruler || gs.persuadeChance(g) < 0.4) {
            if (gs.release(g.def.id).ok) released++;
        } else if (gs.persuade(g.def.id).ok) {
            recruited++;
        }
    }

    // 模拟玩家内政：**打开自动开关**，剩下的交给结束回合统一结算。
    // 需要救急的城先「登记」征兵（不立刻执行），这正是新交互想验证的用法：
    // 玩家回合内只是做选择，一城一令、全回合只结算一次。
    const fid = gs.playerFaction;
    for (const p of gs.provincesOf(fid)) {
        if (p.troops < gs.garrisonCap(p) * 0.35
            && (gs.gold.get(fid) || 0) >= Balance.goldPerTroop * 300) {
            gs.queueDomestic(p, 'recruit');
        }
    }
    // queueDomestic 会把 lastOrder 改成刚登记的那道，所以方针放在后面设，
    // 免得「救急征兵」顺手把全境方针也改成征兵。
    gs.domesticPolicy = gs.foodOf(fid) < 200 ? 'farm' : 'govern';
    for (const p of gs.provincesOf(gs.playerFaction)) {
        if (p.troops < 600) continue;
        const targets = gs.attackTargets(p);
        let best: any = null;
        let bestRatio = 0;
        for (const t of targets) {
            const ratio = p.troops / Math.max(1, t.troops * (1 + t.fort * 0.08));
            if (ratio > bestRatio) {
                bestRatio = ratio;
                best = t;
            }
        }
        if (best && bestRatio > 1.4) {
            const res = gs.attack(p, best);
            if (res && res.captured) captures++;
        }
    }

    gs.endTurn();

    if (guard % 20 === 0) snapshot('进行中');
}

console.log('\n==== 结果 ====');
snapshot('结束');
console.log(`玩家占领：${gs.provincesOf(gs.playerFaction).length} / ${gs.provinces.size}`);
console.log(`游戏内时长：${gs.turn} 回合（约 ${(gs.turn / 12).toFixed(1)} 年）`);
console.log(`玩家攻占次数：${captures}`);
console.log(`俘虏处置：招降成功 ${recruited} 人次 · 放归 ${released} 人次`);
console.log(`胜利=${gs.isVictory()} 失败=${gs.isDefeat()}`);

const alive: Record<string, number> = {};
gs.provinces.forEach((p) => { alive[p.owner] = (alive[p.owner] || 0) + 1; });
console.log('\n存活势力：', Object.entries(alive)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`).join('  '));

let placed = 0;
gs.provinces.forEach((p) => { placed += p.generals.length; });
// 被生擒的将领关在俘虏营里，不在任何城上；守恒要按「在城 + 在营」算。
let jailed = 0;
gs.generals.forEach((g) => { if (g.captiveOf !== '') jailed++; });
console.log(`武将：总${gs.generals.size} 在城${placed} 在营${jailed} `
    + `${placed + jailed === gs.generals.size ? '守恒' : '丢失!'}`);
