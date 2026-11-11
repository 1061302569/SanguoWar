/**
 * 战斗平衡调参脚本：扫描关键系数，找出「均势攻城」胜率落在目标区间的参数。
 */
const AXIS = [];

function resolveBattle(p) {
    const { atkTroops, defTroops, atkRating, defRating, fort, rounds, attrition, spread, collapse, rand } = p;
    const atkMul = 1 + atkRating * 0.05;
    const defMul = (1 + defRating * 0.05) * (1 + fort * 0.08);
    let a = atkTroops;
    let d = defTroops;
    for (let r = 0; r < rounds; r++) {
        if (a <= 0 || d <= 0) break;
        const ap = a * atkMul;
        const dp = d * defMul;
        const share = ap / (ap + dp);
        const noise = (rand() * 2 - 1) * spread;
        const eff = Math.min(0.95, Math.max(0.05, share + noise));
        const intensity = attrition / rounds * 2.2;
        const dLoss = d * intensity * eff;
        const aLoss = a * intensity * (1 - eff);
        a = Math.max(0, a - aLoss);
        d = Math.max(0, d - dLoss);
    }
    const collapseLine = defTroops * collapse;
    let win;
    if (Math.round(d) <= 0) win = Math.round(a) > 0;
    else if (Math.round(a) <= 0) win = false;
    else if (d <= collapseLine) win = true;
    else win = (a / atkTroops) > (d / defTroops) * 1.15 && d < defTroops * 0.6;
    return win;
}

function simulate(params, n = 2000) {
    let wins = 0;
    let seed = 12345;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    for (let i = 0; i < n; i++) {
        if (resolveBattle({ ...params, rand })) wins++;
    }
    return wins / n;
}

console.log('=== 均势攻城（3000 vs 3000，工事 0，无将领） ===');
for (const attrition of [0.45, 0.55, 0.65, 0.75]) {
    for (const rounds of [3, 4, 5]) {
        const rate = simulate({
            atkTroops: 3000, defTroops: 3000, atkRating: 0, defRating: 0,
            fort: 0, rounds, attrition, spread: 0.10, collapse: 0.35,
        });
        console.log(`  attrition=${attrition} rounds=${rounds} -> ${(rate * 100).toFixed(1)}%`);
    }
}

console.log('\n=== 兵力优势 2:1（6000 vs 3000，工事 3） ===');
for (const attrition of [0.55, 0.65, 0.75]) {
    const rate = simulate({
        atkTroops: 6000, defTroops: 3000, atkRating: 5, defRating: 3,
        fort: 3, rounds: 4, attrition, spread: 0.10, collapse: 0.35,
    });
    console.log(`  attrition=${attrition} -> ${(rate * 100).toFixed(1)}%`);
}

console.log('\n=== 兵力劣势（2000 vs 4000，工事 4） ===');
for (const attrition of [0.55, 0.65, 0.75]) {
    const rate = simulate({
        atkTroops: 2000, defTroops: 4000, atkRating: 3, defRating: 6,
        fort: 4, rounds: 4, attrition, spread: 0.10, collapse: 0.35,
    });
    console.log(`  attrition=${attrition} -> ${(rate * 100).toFixed(1)}%`);
}
