/**
 * 验证「进攻不了」的失败路径现在都有明确提示
 *
 * 运行：node tools/bundle-test.mjs tools/verify-hints.ts
 *       node --experimental-strip-types --no-warnings tools/.bundle.verify-hints.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';

setRandom(() => 0.5);

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

const gs = new GameState();
const mine = gs.provincesOf(gs.playerFaction);

console.log('== 所有「进攻失败」路径都必须有可读原因 ==');
const cases: Array<[string, () => string]> = [
    ['打自己', () => gs.canAttack(mine[0], mine[0]).reason],
    ['打友军', () => {
        const ally = mine.find((p) => p.id !== mine[0].id);
        return ally ? gs.canAttack(mine[0], ally).reason : '（无友军，跳过）';
    }],
    ['打不相邻的敌城', () => {
        let far: any = null;
        gs.provinces.forEach((p) => {
            if (!far && p.owner !== gs.playerFaction && !gs.isAdjacent(mine[0], p)) far = p;
        });
        return far ? gs.canAttack(mine[0], far).reason : '（无）';
    }],
    ['无兵力进攻', () => {
        const targets = gs.attackTargets(mine[0]);
        if (targets.length === 0) return '（无可攻目标）';
        const saved = mine[0].troops;
        mine[0].troops = 0;
        const r = gs.canAttack(mine[0], targets[0]).reason;
        mine[0].troops = saved;
        return r;
    }],
];

for (const [name, fn] of cases) {
    const reason = fn();
    const ok = reason.length > 2 && reason !== '可以进攻';
    check(ok, `${name} → 「${reason}」`);
    // 理由必须包含具体信息，不能是空泛的"失败"
    check(!/^(失败|错误|不行)$/.test(reason), `${name} 的理由足够具体`);
}

console.log('\n== 面板提示信息完整性 ==');
for (const p of mine) {
    const targets = gs.attackTargets(p);
    const allies = gs.moveTargets(p);
    const hasInfo = targets.length > 0 || allies.length > 0 || p.troops <= 0;
    check(hasInfo, `${p.name}：可攻 ${targets.length} 座，可调兵 ${allies.length} 座（有信息可展示）`);
}

console.log('\n== 前线城池推荐 ==');
let withTargets = 0;
let borderOnly = 0;
for (const p of mine) {
    if (p.troops > 0 && gs.hasAttackTargets(p)) withTargets++;
    else if (gs.provinces.some((q: any) => q.owner !== gs.playerFaction && gs.isAdjacent(p, q))) borderOnly++;
}
console.log(`  可直接进攻的城：${withTargets}`);
console.log(`  仅接壤但无可攻目标：${borderOnly}`);
check(withTargets + borderOnly > 0, '至少有一座城值得玩家关注');

console.log('\n== 敌方城池也给出「从哪里打」的提示 ==');
let enemyWithHint = 0;
let enemyChecked = 0;
gs.provinces.forEach((p) => {
    if (p.owner !== gs.playerFaction) {
        enemyChecked++;
        const neighbors = gs.provincesOf(gs.playerFaction)
            .filter((q) => gs.isAdjacent(q, p));
        if (neighbors.length > 0) enemyWithHint++;
    }
});
console.log(`  敌方城池 ${enemyChecked} 座，其中 ${enemyWithHint} 座可以从我方进攻`);
check(enemyChecked > 0, '存在敌方城池');

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
