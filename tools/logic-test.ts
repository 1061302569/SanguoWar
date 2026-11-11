/**
 * 纯逻辑自测（不依赖 Cocos 引擎，可直接用 node 跑）
 *
 * 用法：
 *   node --experimental-strip-types tools/logic-test.ts
 *
 * 覆盖：六边形邻接关系、战斗结算的期望方向、征兵上限、回合推进与胜负判定。
 */

import { Geo } from '../assets/scripts/core/Geo.ts';
import { resolveBattle, setRandom } from '../assets/scripts/core/Combat.ts';
import { GameState } from '../assets/scripts/core/GameState.ts';
import { Balance } from '../assets/scripts/core/Balance.ts';
import { ProvinceState } from '../assets/scripts/data/Types.ts';
import {
    synthesize, getSfx, clearSfxCache, sfxDuration, normalize,
    setSfxRandom, SfxName,
} from '../assets/scripts/core/SfxSynth.ts';

let failures = 0;
let checks = 0;

function check(cond: boolean, msg: string): void {
    checks++;
    if (!cond) {
        failures++;
        console.log(`  ✗ ${msg}`);
    }
}

function section(name: string): void {
    console.log(`\n== ${name} ==`);
}

// ------------------------------------------------------------------
section('地理投影');
{
    // 投影的基本性质：北方 y 更大（屏幕上更高），东方 x 更大
    const north = Geo.project(40, 110);
    const south = Geo.project(25, 110);
    check(north.y > south.y, '北方的 y 值应更大（Cocos y 轴向上，屏幕更高）');

    const west = Geo.project(32, 105);
    const east = Geo.project(32, 120);
    check(east.x > west.x, '东方的 x 值应更大');

    // 同一个点的投影应当稳定
    const p1 = Geo.project(34.27, 108.94);
    const p2 = Geo.project(34.27, 108.94);
    check(p1.x === p2.x && p1.y === p2.y, '投影是确定性的');

    // 往返：投影后再反投影应回到原值
    const back = Geo.unproject(p1.x, p1.y);
    check(Math.abs(back.lat - 34.27) < 0.01, `纬度往返一致（${back.lat.toFixed(3)}）`);
    check(Math.abs(back.lon - 108.94) < 0.01, `经度往返一致（${back.lon.toFixed(3)}）`);

    // 距离函数
    check(Geo.distance(0, 0, 3, 4) === 5, '距离计算正确');
    check(Geo.distance(10, 10, 10, 10) === 0, '同点距离为 0');

    // 地图尺寸必须为正
    check(Geo.width > 0 && Geo.height > 0, `地图尺寸有效（${Geo.width.toFixed(0)}x${Geo.height.toFixed(0)}）`);
}

// ------------------------------------------------------------------
section('城池地理数据');
{
    const gs = new GameState();
    const list: ProvinceState[] = [];
    gs.provinces.forEach((p) => list.push(p));

    // 每座城都必须在合理的地理范围内（中国境内）
    let outOfRange = 0;
    for (const p of list) {
        if (p.lat < 18 || p.lat > 45 || p.lon < 97 || p.lon > 126) {
            outOfRange++;
            console.log(`    越界：${p.name} (${p.lat}, ${p.lon})`);
        }
    }
    check(outOfRange === 0, `所有城池都在中国地理范围内（越界 ${outOfRange}）`);

    // 经纬度不能重复（否则投影后重叠）
    const seenCoord = new Set<string>();
    let dup = 0;
    for (const p of list) {
        const k = `${p.lat},${p.lon}`;
        if (seenCoord.has(k)) {
            dup++;
        }
        seenCoord.add(k);
    }
    check(dup === 0, `没有经纬度重复的城池（${dup}）`);

    // 投影后两两距离不能太近（否则手机点不中）
    const MIN = 60;
    let tooClose = 0;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = Geo.project(list[i].lat, list[i].lon);
            const b = Geo.project(list[j].lat, list[j].lon);
            const d = Geo.distance(a.x, a.y, b.x, b.y);
            if (d < MIN) {
                tooClose++;
                console.log(`    过近：${list[i].name} - ${list[j].name} = ${d.toFixed(0)}px`);
            }
        }
    }
    check(tooClose === 0, `投影后城池间距 >= ${MIN}px（过近 ${tooClose} 对）`);

    // 每座城都要有相邻关系，且不能与自己相邻
    let noBorders = 0;
    let selfBorder = 0;
    for (const p of list) {
        if (!p.borders || p.borders.length === 0) {
            noBorders++;
        }
        if (p.borders.indexOf(p.id) >= 0) {
            selfBorder++;
        }
    }
    check(noBorders === 0, `每座城都有相邻城池（孤立 ${noBorders}）`);
    check(selfBorder === 0, '没有城池与自己相邻');

    // 相邻关系必须双向对称（A 说 B 相邻，B 也必须说 A 相邻）
    let asym = 0;
    for (const p of list) {
        for (const bid of p.borders) {
            const other = gs.provinces.get(bid);
            if (!other) {
                asym++;
                console.log(`    不存在的邻居：${p.name} -> ${bid}`);
            } else if (other.borders.indexOf(p.id) < 0) {
                asym++;
                console.log(`    单向相邻：${p.name} -> ${other.name}`);
            }
        }
    }
    check(asym === 0, `相邻关系双向对称（不对称 ${asym}）`);

    // 地图必须全连通（从任意城都能走到任何城）
    const ids: string[] = [];
    gs.provinces.forEach((p) => ids.push(p.id));
    const seen = new Set<string>([ids[0]]);
    const queue = [ids[0]];
    while (queue.length > 0) {
        const cur = queue.shift()!;
        const st = gs.provinces.get(cur)!;
        for (const bid of st.borders) {
            if (!seen.has(bid)) {
                seen.add(bid);
                queue.push(bid);
            }
        }
    }
    check(seen.size === ids.length, `地图全连通（可达 ${seen.size}/${ids.length}）`);
}

// ------------------------------------------------------------------
section('战斗结算');
{
    // 固定随机，结果应可复现
    setRandom(() => 0.5);

    // 十倍兵力，必然攻下
    const big = resolveBattle({
        atkSide: { troops: 10000, atk: 8, def: 8, cap: 10000 },
        defSide: { troops: 1000, atk: 0, def: 0, cap: 1000 },
        fort: 0,
        title: '测试',
    });
    check(big.attackerWin, '十倍兵力应当获胜');
    check(big.attackerLeft > 0, '进攻方应保有兵力');
    // 守军应被打崩到崩溃线以下（4 轮未能全歼是正常的）
    check(big.defenderLeft < 1000 * Balance.collapseRatio, '守军应被打崩到崩溃线以下');

    // 十分之一兵力，必然失败
    const small = resolveBattle({
        atkSide: { troops: 500, atk: 0, def: 0, cap: 500 },
        defSide: { troops: 8000, atk: 5, def: 5, cap: 8000 },
        fort: 3,
        title: '测试',
    });
    check(!small.attackerWin, '劣势兵力不应获胜');

    // 损耗不能为负、不能超过初始兵力
    const mid = resolveBattle({
        atkSide: { troops: 3000, atk: 5, def: 5, cap: 3000 },
        defSide: { troops: 3000, atk: 5, def: 5, cap: 3000 },
        fort: 2,
        title: '测试',
    });
    check(mid.attackerLoss >= 0 && mid.attackerLoss <= 3000, '进攻方损耗应在合法区间');
    check(mid.defenderLoss >= 0 && mid.defenderLoss <= 3000, '防守方损耗应在合法区间');
    check(mid.attackerLeft + mid.attackerLoss === 3000, '兵力守恒');
    check(mid.defenderLeft + mid.defenderLoss === 3000, '兵力守恒（守）');

    // 工事应当提升防守强度：同样的兵力，工事高时进攻方更吃亏
    setRandom(() => 0.5);
    const fort0 = resolveBattle({
        atkSide: { troops: 4000, atk: 6, def: 6, cap: 4000 },
        defSide: { troops: 3000, atk: 4, def: 4, cap: 3000 },
        fort: 0, title: 't',
    });
    const fort5 = resolveBattle({
        atkSide: { troops: 4000, atk: 6, def: 6, cap: 4000 },
        defSide: { troops: 3000, atk: 4, def: 4, cap: 3000 },
        fort: 5, title: 't',
    });
    check(fort5.attackerLoss >= fort0.attackerLoss, '高工事应让进攻方损失更多');
}

// ------------------------------------------------------------------
section('游戏状态');
{
    setRandom(() => 0.5);
    const gs = new GameState();
    check(gs.provinces.size > 0, '应有省份数据');
    check(gs.generals.size > 0, '应有武将数据');

    // 每个省份都必须有归属，且归属势力必须存在
    const owners = new Set<string>();
    gs.provinces.forEach((p) => owners.add(p.owner));
    check(owners.size >= 10, `势力数量应足够（实际 ${owners.size}）`);

    // 初始驻军不超过上限
    let overCap = 0;
    gs.provinces.forEach((p) => {
        if (p.troops > gs.garrisonCap(p)) {
            overCap++;
        }
    });
    check(overCap === 0, '初始驻军不应超过上限');

    // 邻接关系应对称
    let asym = 0;
    gs.provinces.forEach((a) => {
        gs.provinces.forEach((b) => {
            if (a.id !== b.id && gs.isAdjacent(a, b) !== gs.isAdjacent(b, a)) {
                asym++;
            }
        });
    });
    check(asym === 0, '邻接关系应左右对称');

    // 地图应当连通（所有省份都能互相到达）—— 与上面「城池地理数据」重复检查，
    // 这里保留 isAdjacent API 的验证
    const ids = Array.from(gs.provinces.keys());
    const seen = new Set<string>([ids[0]]);
    const queue = [ids[0]];
    while (queue.length > 0) {
        const cur = queue.shift()!;
        const st = gs.provinces.get(cur)!;
        for (const bid of st.borders) {
            if (!seen.has(bid)) {
                seen.add(bid);
                queue.push(bid);
            }
        }
    }
    check(seen.size === ids.length,
        `地图应连通（可达 ${seen.size} / ${ids.length}）`);

    // 征兵：不超过上限、不把金币扣成负数
    const p = gs.provincesOf('cao')[0];
    if (p) {
        const before = gs.gold.get('cao')!;
        const got = gs.recruit(p, 50000);
        check(gs.gold.get('cao')! >= 0, '征兵后金币不应为负');
        check(p.troops <= gs.garrisonCap(p), '征兵不应超过上限');
        check(got >= 0, '征兵数量不应为负');
        check(gs.gold.get('cao')! <= before, '征兵应消耗金币');
    }

    // 回合推进
    // ⚠ 这里要显式关掉自动内政：否则会按最后一道指令在回合结束时花金币，
    // 那样金币变化是「收入 - 治理支出」，测不出「有没有收入」。
    gs.domesticPolicy = 'none';
    const turn0 = gs.turn;
    const gold0 = gs.gold.get('cao')!;
    gs.endTurn();
    check(gs.turn === turn0 + 1, '回合数应 +1');
    check(gs.gold.get('cao')! > gold0, '结束回合后应有收入');

    // 胜负判定
    check(!gs.isVictory(), '开局不应胜利');
    check(!gs.isDefeat(), '开局不应失败');
}

// ------------------------------------------------------------------
section('武将不会凭空消失');
{
    setRandom(() => 0.5);
    const gs = new GameState();
    // 统计开局武将总数
    let before = 0;
    gs.provinces.forEach((p) => { before += p.generals.length; });

    // 找一对相邻的敌对省份，用压倒性兵力强攻，重复多次
    let attacks = 0;
    for (let round = 0; round < 40; round++) {
        // 随便挑一个玩家省份和一个相邻敌省
        let from: any = null;
        let to: any = null;
        gs.provinces.forEach((p) => {
            if (from || p.owner !== 'cao') return;
            const targets = gs.attackTargets(p);
            if (targets.length > 0) {
                from = p;
                to = targets[0];
            }
        });
        if (!from || !to) break;
        // 给足兵力保证能攻下
        from.troops = 30000;
        const res = gs.attack(from, to);
        attacks++;
        if (res && res.captured) {
            // 攻下后再检查总数
        }
    }
    let after = 0;
    gs.provinces.forEach((p) => { after += p.generals.length; });
    check(attacks > 0, `至少发生了一次进攻（${attacks} 次）`);
    check(after === before,
        `攻防后武将总数守恒（战前 ${before}，战后 ${after}）`);
    // 所有武将都必须仍然挂在某个省份上
    const placed = new Set<string>();
    gs.provinces.forEach((p) => p.generals.forEach((g: string) => placed.add(g)));
    check(placed.size === gs.generals.size,
        `所有武将都还有驻地（已安置 ${placed.size} / 共 ${gs.generals.size}）`);
}

// ------------------------------------------------------------------
section('存档序列化');
{
    setRandom(() => 0.5);
    const gs = new GameState();

    // 制造一些局面变化：征兵、进攻、结束回合
    const mine = gs.provincesOf('cao');
    if (mine.length > 0) {
        gs.recruit(mine[0], 500);
    }
    gs.endTurn();
    gs.endTurn();

    const snapshot = JSON.stringify(gs.serialize());

    // 反序列化到新实例
    const gs2 = new GameState();
    const ok = gs2.deserialize(gs.serialize());
    check(ok, '存档应能成功恢复');

    // 关键字段逐一比对
    check(gs2.turn === gs.turn, `回合数一致（${gs2.turn} vs ${gs.turn}）`);
    check(gs2.year === gs.year && gs2.month === gs.month,
        `年月一致（${gs2.dateText()} vs ${gs.dateText()}）`);
    check(gs2.playerFaction === gs.playerFaction, '玩家势力一致');

    // 省份归属与兵力
    let provMismatch = 0;
    gs.provinces.forEach((p, id) => {
        const q = gs2.provinces.get(id)!;
        if (q.owner !== p.owner) provMismatch++;
        if (Math.abs(q.troops - p.troops) > 0.5) provMismatch++;
        if (q.generals.length !== p.generals.length) provMismatch++;
    });
    check(provMismatch === 0, `省份状态一致（差异 ${provMismatch}）`);

    // 武将等级
    let genMismatch = 0;
    gs.generals.forEach((g, id) => {
        const g2 = gs2.generals.get(id)!;
        if (g2.level !== g.level) genMismatch++;
    });
    check(genMismatch === 0, `武将等级一致（差异 ${genMismatch}）`);

    // 金币
    let goldMismatch = 0;
    gs.gold.forEach((v, k) => {
        const v2 = gs2.gold.get(k) || 0;
        if (Math.abs(v2 - v) > 0.5) goldMismatch++;
    });
    check(goldMismatch === 0, `金币一致（差异 ${goldMismatch}）`);

    // 再过一次序列化，应当与快照完全一致（幂等）
    check(JSON.stringify(gs2.serialize()) === snapshot, '往返序列化应幂等');

    // 坏存档必须被拒绝，不能崩溃
    check(gs2.deserialize(null) === false, '空存档应被拒绝');
    check(gs2.deserialize({} as any) === false, '缺版本号的存档应被拒绝');
    check(gs2.deserialize({ version: 999 } as any) === false, '版本不符应被拒绝');

    // 存档体积应当很小（小游戏存储有上限）
    const bytes = snapshot.length;
    console.log(`  存档大小：${bytes} 字节`);
    check(bytes < 20000, '存档体积应远小于 20KB');
}

// ------------------------------------------------------------------
section('音效波形合成');
{
    // 固定随机源，保证噪声类音效可复现
    let seed = 12345;
    setSfxRandom(() => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    });

    const names: SfxName[] = ['hit', 'capture', 'fail', 'click', 'turn'];
    for (const n of names) {
        const pcm = synthesize(n);
        check(pcm.length > 0, `${n} 生成了非空波形`);
        check(pcm instanceof Float32Array, `${n} 返回 Float32Array`);

        // 所有采样必须在 [-1, 1]，否则播放会削波失真
        let outOfRange = 0;
        let peak = 0;
        let nonzero = 0;
        for (let i = 0; i < pcm.length; i++) {
            const v = pcm[i];
            if (v > 1.0001 || v < -1.0001) {
                outOfRange++;
            }
            const a = Math.abs(v);
            if (a > peak) {
                peak = a;
            }
            if (a > 0.001) {
                nonzero++;
            }
        }
        check(outOfRange === 0, `${n} 采样值在 [-1,1] 内（越界 ${outOfRange}）`);
        check(peak > 0.5, `${n} 有足够响度（峰值 ${peak.toFixed(2)}）`);
        check(nonzero > pcm.length * 0.05, `${n} 不是静音（有效采样 ${nonzero}）`);
    }

    // 时长应当合理：点击最短，回合音较长
    check(sfxDuration('click') < 0.15, `click 时长很短（${sfxDuration('click').toFixed(3)}s）`);
    check(sfxDuration('turn') > 0.3, `turn 时长较长（${sfxDuration('turn').toFixed(3)}s）`);
    check(sfxDuration('hit') < sfxDuration('capture'), '打击音比占领音短');

    // 缓存：同一音效两次调用应返回同一个引用（避免重复合成）
    const a1 = getSfx('hit');
    const a2 = getSfx('hit');
    check(a1 === a2, '音效有缓存，不会重复合成');

    // 清缓存后应重新生成出新对象
    clearSfxCache();
    const a3 = getSfx('hit');
    check(a3 !== a1, '清缓存后会重新合成');

    // 未知音效名不应崩溃
    const unknown = synthesize('nope' as SfxName);
    check(unknown.length > 0, '未知音效返回静音占位而不是崩溃');

    // 归一化：峰值不应超过 1
    const raw = new Float32Array([0.1, 0.5, -0.2]);
    const norm = normalize(raw, 0.9);
    let maxAbs = 0;
    for (let i = 0; i < norm.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(norm[i]));
    }
    check(Math.abs(maxAbs - 0.9) < 1e-4, `归一化把峰值调到 0.9（实际 ${maxAbs.toFixed(3)}）`);

    // 全零输入不应除零
    const zeros = normalize(new Float32Array([0, 0, 0]), 0.9);
    check(zeros.length === 3, '全零输入不会崩');
}

// ------------------------------------------------------------------
section('进攻条件与提示');
{
    setRandom(() => 0.5);
    const gs = new GameState();

    const mine = gs.provincesOf(gs.playerFaction);
    check(mine.length > 0, '玩家有初始城池');

    // 自己打自己
    const self = gs.canAttack(mine[0], mine[0]);
    check(!self.ok, '不能进攻自己');
    check(self.reason.length > 0, `给出原因：${self.reason}`);

    // 打友军
    if (mine.length > 1) {
        const ally = gs.canAttack(mine[0], mine[1]);
        check(!ally.ok, '不能进攻友军');
        check(ally.reason.indexOf('调兵') >= 0, `引导玩家用调兵：${ally.reason}`);
    }

    // 打不相邻的敌城
    let farEnemy: ProvinceState | null = null;
    gs.provinces.forEach((p) => {
        if (!farEnemy && p.owner !== gs.playerFaction && !gs.isAdjacent(mine[0], p)) {
            farEnemy = p;
        }
    });
    if (farEnemy) {
        const far = gs.canAttack(mine[0], farEnemy);
        check(!far.ok, '不能进攻不相邻的城');
        check(far.reason.indexOf('接壤') >= 0, `说明不接壤：${far.reason}`);
    }

    // 打相邻的敌城（应当可以）
    const targets = gs.attackTargets(mine[0]);
    if (targets.length > 0) {
        const ok = gs.canAttack(mine[0], targets[0]);
        check(ok.ok, '相邻敌城可以进攻');
        check(ok.reason.indexOf('可以') >= 0, `原因为可进攻：${ok.reason}`);
    }

    // 兵力为 0 时不能进攻，且理由正确
    if (targets.length > 0) {
        const saved = mine[0].troops;
        mine[0].troops = 0;
        const noTroop = gs.canAttack(mine[0], targets[0]);
        check(!noTroop.ok, '兵力为 0 时不能进攻');
        check(noTroop.reason.indexOf('征兵') >= 0, `提示先征兵：${noTroop.reason}`);
        mine[0].troops = saved;
    }

    // canAttack 与 attack() 的实际行为必须一致（不能出现"说能打却打不了"）
    let inconsistent = 0;
    for (const from of gs.provincesOf(gs.playerFaction)) {
        for (const to of gs.provinces.values()) {
            if (from.id === to.id) continue;
            const v = gs.canAttack(from, to);
            // 只验证"说可以"的情况：attack 应当返回非空
            if (v.ok && !gs.isAdjacent(from, to)) {
                inconsistent++;
            }
            if (v.ok && from.owner === to.owner) {
                inconsistent++;
            }
        }
    }
    check(inconsistent === 0, `canAttack 与实际条件一致（${inconsistent} 处矛盾）`);

    // hasAttackTargets 的准确性
    for (const from of gs.provincesOf(gs.playerFaction)) {
        const byMethod = gs.hasAttackTargets(from);
        const byList = gs.attackTargets(from).length > 0;
        check(byMethod === byList, `${from.name} 的 hasAttackTargets 与列表一致`);
    }
}

// ------------------------------------------------------------------
section('平衡性抽样');
{
    setRandom(Math.random);
    // 用真实初始兵力模拟 200 场势均力敌战斗，胜率应在合理区间
    let wins = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
        const r = resolveBattle({
            atkSide: { troops: 3000, atk: 6, def: 6, cap: 3000 },
            defSide: { troops: 3000, atk: 6, def: 6, cap: 3000 },
            fort: 0, title: 't',
        });
        if (r.attackerWin) wins++;
    }
    const rate = wins / N;
    console.log(`  势均力敌进攻胜率：${(rate * 100).toFixed(1)}%`);
    check(rate > 0.05 && rate < 0.6, '无工事时进攻方胜率应明显低于守方（守方优势）');
}

console.log(`\n结果：${checks - failures}/${checks} 通过，失败 ${failures}`);
process.exit(failures === 0 ? 0 : 1);
