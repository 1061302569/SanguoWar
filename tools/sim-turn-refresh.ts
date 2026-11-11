/**
 * 回归：对手回合攻下我方城池后，地图势力颜色必须刷新
 *
 * 背景：AI 阶段会直接改写 ProvinceState.owner，而地图版图颜色只在
 * MapRenderer.draw() 里按 owner 重新填充（update() 每帧只画选中光晕）。
 * 以前 GameState.onTurnEnd 是个从不触发的死钩子，GameController.onEndTurn()
 * 也没调 refreshAll()，于是「城已经丢了，到我方回合地图还是旧颜色」。
 * 玩家自己进攻不受影响，因为 doAttack() 里显式调了 refreshAll()。
 *
 * 两层守卫：
 *   1) 逻辑层：构造 AI 必胜攻城，验证 onTurnEnd 在状态结算完成后触发，
 *      且回调里读到的 owner / 回合号都是新值（等价于 UI 重绘拿新数据）；
 *   2) 接线层：静态检查状态层确实触发回调、UI 层确实订阅并 refreshAll()。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-turn-refresh.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-turn-refresh.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { NEUTRAL } from '../assets/scripts/data/Factions.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

// 固定随机源，让「AI 必胜」这件事可复现
setRandom(() => 0.5);

async function main(): Promise<void> {
    // 动态 import：bundle-test.mjs 会把模块体包进工厂函数，
    // 顶层静态 import 在那里是非法语法，只能放在 async 函数里动态加载。
    const { readFileSync } = await import('node:fs');

    console.log('== 构造一个「对手回合必然攻下我方城池」的确定局面 ==');
    const gs = new GameState();
    let victim: any = null;
    let attacker: any = null;

    gs.provincesOf(gs.playerFaction).forEach((v) => {
        if (victim) return;
        gs.provinces.forEach((e) => {
            if (victim || e.owner === gs.playerFaction || e.owner === NEUTRAL) return;
            // AI 的 attackTargets 用 isAdjacent(出发城, 目标城)，按同方向检查
            if (gs.isAdjacent(e, v)) {
                victim = v;
                attacker = e;
            }
        });
    });
    check(!!(victim && attacker), `找到相邻的敌我城池：${victim ? victim.name : '?'} ← ${attacker ? attacker.name : '?'}`);
    if (!victim || !attacker) {
        console.log('\n结果：场景构造失败');
        process.exit(1);
    }

    const attackerFaction = attacker.owner;
    // 除这两座城外全部归为进攻方，保证 AI 只有一个可打目标；
    // 兵力清零后只有 attacker 满足「>= 500 才出兵」的门槛。
    gs.provinces.forEach((p) => {
        if (p !== attacker && p !== victim) {
            p.owner = attackerFaction;
        }
        p.troops = 0;
    });
    attacker.troops = 99999;
    victim.troops = 1;

    const ownersBefore: Record<string, string> = {};
    gs.provinces.forEach((p) => { ownersBefore[p.id] = p.owner; });

    // 模拟 UI 的订阅：回调里做一次「全量快照」，等价于 refreshAll() 读取状态
    let calls = 0;
    let turnAtCallback = 0;
    let reportAtCallback: any = null;
    const ownersAtCallback: Record<string, string> = {};
    gs.onTurnEnd = (report: any) => {
        calls++;
        turnAtCallback = gs.turn;
        reportAtCallback = report;
        gs.provinces.forEach((p) => { ownersAtCallback[p.id] = p.owner; });
    };

    console.log('\n== 逻辑层：回合结算信号 ==');
    const report = gs.endTurn();

    const ownersAfter: Record<string, string> = {};
    gs.provinces.forEach((p) => { ownersAfter[p.id] = p.owner; });

    check(ownersAfter[victim.id] === attackerFaction,
        `AI 确实攻下了 ${victim.name}（${ownersBefore[victim.id]} → ${ownersAfter[victim.id]}）`);
    check(calls === 1, 'onTurnEnd 在一次 endTurn() 中恰好触发一次');
    check(reportAtCallback === report, '回调拿到的是本次回合战报');
    check(turnAtCallback === gs.turn && turnAtCallback === 2,
        `回调在结算末尾触发，此时回合号已是新值（${turnAtCallback}）`);
    check(ownersAtCallback[victim.id] === ownersAfter[victim.id],
        '回调里读到的 owner 已是新值（重绘会画出新的势力色）');

    let allSame = true;
    for (const id of Object.keys(ownersAfter)) {
        if (ownersAtCallback[id] !== ownersAfter[id]) allSame = false;
    }
    check(allSame, '回调里的全量归属快照与 endTurn() 返回后完全一致');

    check(report.lostCities.length === 1 && report.lostCities[0] === victim.id,
        `战报精确给出失守城池（${report.lostCities.join('、')}）`);
    check(report.provinceCount === 0, '战报里的玩家据点数与结算后一致');

    // 没有失守的回合也必须发出信号（刷新兵力/日期/战报），且不能误报失守
    const report2 = gs.endTurn();
    check(calls === 2, '第二个回合同样触发刷新信号');
    check(report2.lostCities.length === 0, '没有城池易主时 lostCities 为空');

    // onDestroy 解绑后不能残留回调
    gs.onTurnEnd = null;
    gs.endTurn();
    check(calls === 2, '解绑订阅后 endTurn() 仍安全，不会触发已销毁的 UI');

    console.log('\n== 接线层：静态守卫（防止以后有人把刷新链路改丢） ==');
    const stateSrc = readFileSync('assets/scripts/core/GameState.ts', 'utf8');
    const ctrl = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const rendererSrc = readFileSync('assets/scripts/ui/MapRenderer.ts', 'utf8');

    check(/if \(this\.onTurnEnd\)[\s\S]{0,200}this\.onTurnEnd\(report\);/.test(stateSrc),
        'GameState.endTurn() 真的触发 onTurnEnd（不是死钩子）');
    check(/this\.state\.onTurnEnd\s*=\s*\(\)\s*=>\s*this\.refreshAll\(\);/.test(ctrl),
        'GameController.onLoad 订阅回调，且订阅体调用 refreshAll()');
    // draw() 的参数以后可能增加（例如当前会多传一个 playerFaction），
    // 这里只守卫「确实调了 draw(list, ...)」，不要锁死参数列表。
    check(/private refreshAll\(\): void \{[\s\S]{0,1200}this\.mapRenderer\.draw\(list[^;]*\);/.test(ctrl),
        'refreshAll() 会重绘底图（版图颜色唯一来源）');
    check(/private onEndTurn\(\): void \{[\s\S]{0,1800}this\.state\.endTurn\(\);/.test(ctrl),
        '结束回合走 state.endTurn()，因此会走统一刷新');
    check(/onDestroy\(\): void \{[\s\S]{0,900}this\.state\.onTurnEnd = null;/.test(ctrl),
        '组件销毁时解绑回调');
    check(/FACTION_MAP\[p\.owner\]/.test(rendererSrc),
        'MapRenderer 按当前 owner 取色，重绘即可刷新势力颜色');

    console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
