/**
 * 回归：开局流程 —— 「选剧本 → 在地图上点城选势力」
 *
 * 原来的流程是剧本面板里点 4 个文字按钮。问题不在于能不能选，而在于
 * **选之前看不到**：玩家不知道曹操在北、孙策在东南、谁挨着谁、谁只有 3 城。
 * 现在改成两步：面板里选剧本 → 收起面板回到地图点城。
 *
 * 这条流程有几个容易做错的地方，本测试专门守住：
 *   1) 预览版图必须按**剧本开局配置**着色，不能拿上一局打乱后的 ProvinceState；
 *   2) 归属判断同样读 `sc.owners`，不能读 `p.owner`；
 *   3) 预览不能给任何城画玩家金环（玩家还没执掌势力），
 *      但也不能因此放宽「所有底图重绘都带 playerFaction」那条守卫；
 *   4) 选势力阶段点城只切换候选势力，不能进入战斗 / 调兵逻辑；
 *   5) 退出要能回到剧本面板，且不清存档、不动当前局面。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-faction-pick.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-faction-pick.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { setRandom } from '../assets/scripts/core/Combat.ts';
import {
    SCENARIOS, getScenario, playableFactions, factionBriefOf, factionBriefLines,
} from '../assets/scripts/data/Scenarios.ts';
import { PROVINCES } from '../assets/scripts/data/Provinces.ts';
import { FACTION_MAP, NEUTRAL } from '../assets/scripts/data/Factions.ts';
import { RULER_OF } from '../assets/scripts/data/Generals.ts';

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

function fresh(seed = 20241113): GameState {
    let s = seed;
    setRandom(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    });
    return new GameState();
}

console.log('开局流程：地图选势力回归\n');

// ----------------------------------------------------------------------
section('1. 势力简报：地图上点一座城之后，浮层要说什么');

for (const sc of SCENARIOS) {
    const list = playableFactions(sc);
    let okCities = true;
    let okName = true;
    let okNeighbor = true;
    for (const fid of list) {
        const b = factionBriefOf(sc, fid);
        if (b.cities < 1) {
            okCities = false;
        }
        if (b.name.length === 0) {
            okName = false;
        }
        // 接壤列表不能出现自己，也不能出现中立
        if (b.neighbors.indexOf(b.name) >= 0) {
            okNeighbor = false;
        }
        if (b.neighbors.indexOf('中立') >= 0) {
            okNeighbor = false;
        }
    }
    check(list.length > 0 && okCities,
        `${sc.name}：${list.length} 个可执掌势力，每个都至少有 1 座城`);
    check(okName, `${sc.name}：每个势力都有名字（不会显示成 id）`);
    check(okNeighbor, `${sc.name}：接壤列表不含自己与中立`);
}

// 城池数与剧本配置必须一致：这是「我选的是不是 3 城小势力」的唯一依据
const sc194 = getScenario('qunxiong_194');
const caoBrief = factionBriefOf(sc194, 'cao');
const caoCities = Object.keys(sc194.owners).filter((id) => sc194.owners[id] === 'cao').length;
check(caoBrief.cities === caoCities,
    `城池数与剧本配置一致（曹操 ${caoBrief.cities} 城）`);
check(caoBrief.name === FACTION_MAP['cao'].name,
    `势力名取自 FACTION_MAP（${caoBrief.name}）`);

// 君主与君威：16 位君主各带一项史实加成，浮层要把这项写出来
check(caoBrief.ruler.length > 0 && caoBrief.bonus.length > 0,
    `曹操有君主与君威文案（${caoBrief.ruler} · ${caoBrief.bonus}）`);
check(/\+/.test(caoBrief.bonus), '君威文案带百分比（如 攻+15%），不是空壳称号');

// 没有将领的势力（陶谦 / 刘繇）不能因此崩掉
const taoBrief = factionBriefOf(sc194, 'tao');
check(taoBrief.ruler === '' && taoBrief.bonus === '',
    '无将领势力：君主与君威为空串，不抛异常');
check(taoBrief.cities >= 0,
    `无将领势力：简报正常生成（陶谦 ${taoBrief.cities} 城）`);
check(taoBrief.generals === 0, '无将领势力武将数为 0（浮层会提示「守成更难」）');
// 没有城的势力不能出现在候选里 —— 否则玩家点遍全图也选不到它
check(playableFactions(sc194).indexOf('tao') < 0 || taoBrief.cities > 0,
    '候选势力列表里不会出现「0 城」的空势力');

// 接壤：曹操在 194 剧本必定与多个势力接壤
check(caoBrief.neighbors.length >= 2,
    `曹操接壤 ${caoBrief.neighbors.length} 家（${caoBrief.neighbors.join('、')}）`);
check(caoBrief.neighbors.join('、') === caoBrief.neighbors.slice().sort(
    (a, b) => a.localeCompare(b, 'zh')).join('、'),
'接壤列表按名字排序（同一局面每次显示顺序一致）');

// 全部可玩势力的城池数之和不能超过地图总城数
const totalOwned = playableFactions(sc194)
    .map((fid) => factionBriefOf(sc194, fid).cities)
    .reduce((a, b) => a + b, 0);
check(totalOwned <= PROVINCES.length,
    `可执掌势力城池合计 ${totalOwned} ≤ 地图 ${PROVINCES.length} 城`);

section('2. 浮层文案：三行回答「多大 / 谁当家 / 挨着谁」');

const lines = factionBriefLines(caoBrief);
check(lines.length === 3, '浮层正文固定三行（不随势力变化撑破面板）');
check(lines[0].indexOf('城') >= 0 && lines[0].indexOf('将') >= 0,
    `第一行写城池与武将（${lines[0]}）`);
check(lines[1].indexOf('君主') >= 0 && lines[1].indexOf(caoBrief.ruler) >= 0,
    `第二行写君主（${lines[1]}）`);
check(lines[2].indexOf('接壤') >= 0, `第三行写接壤（${lines[2]}）`);

const taoLines = factionBriefLines(taoBrief);
check(taoLines[1].indexOf('无君主') >= 0,
    '没有君主时明确说「无君主（守成更难）」，不显示成空白');

// 孤立势力（四周没有敌对势力）要有兜底文案
const lonely = factionBriefLines({
    id: 'x', name: '测试', cities: 1, generals: 0, ruler: '', bonus: '', neighbors: [],
});
check(lonely[2].indexOf('四周无敌对势力') >= 0,
    '没有邻居时写「四周无敌对势力」，不显示「接壤 」空串');

section('3. 归属必须读剧本，不能读上一局局面');

const gs = fresh();
gs.reset('qunxiong_194', 'cao');
// 模拟「上一局打乱了版图」：把许昌改成孙策的
const xuchang = gs.provinces.get('xuchang')!;
xuchang.owner = 'sun';
check(sc194.owners['xuchang'] !== 'sun',
    '局面被改乱之后，剧本配置里的许昌归属没变（这正是要读配置的原因）');
check(factionBriefOf(sc194, 'cao').cities === caoCities,
    '局面打乱不影响势力简报的城池数（预览数字与真正开局一致）');

// 每个可玩势力的每一座城，都能在剧本配置里找到归属
let allMapped = true;
for (const sc of SCENARIOS) {
    for (const fid of playableFactions(sc)) {
        const b = factionBriefOf(sc, fid);
        const ids = Object.keys(sc.owners).filter((id) => sc.owners[id] === fid);
        if (ids.length !== b.cities) {
            allMapped = false;
        }
    }
}
check(allMapped, '所有剧本 / 势力的城池数与 owners 配置逐一对得上');

section('4. 源码守卫：两步开局流程真的接线');

async function sourceGuards(): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const renderer = readFileSync('assets/scripts/ui/MapRenderer.ts', 'utf8');
    const scenarios = readFileSync('assets/scripts/data/Scenarios.ts', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    check(ui.indexOf("'select' | 'move' | 'attack' | 'pickFaction'") >= 0,
        '新增 pickFaction 模式（与进攻 / 调兵互斥）');
    const flow: Array<[string, string]> = [
        ['private enterFactionPick()', '进入地图选势力：收起面板、全图视角'],
        ['private exitFactionPick()', '退出选势力：回到剧本面板'],
        ['private pickFactionAt(', '点城切换候选势力'],
        ['private refreshFactionPick()', '刷新浮层简报'],
        ['private confirmFactionPick()', '确认开局'],
        ["makeRectStroke('FactionPick'", '底部浮层存在'],
        ['this.mapRenderer.drawPreview(preview)', '预览版图走专门的预览绘制'],
        ['this.mapInput.resetView()', '进入时切回全图视角（否则看不到大部分候选势力）'],
    ];
    for (const [needle, label] of flow) {
        check(ui.indexOf(needle) >= 0, label);
    }

    check(ui.indexOf('const owner = sc.owners[p.id] || NEUTRAL;') >= 0,
        '点城判断归属读剧本配置（sc.owners），不读 p.owner');
    check(ui.indexOf('Object.create(Object.getPrototypeOf(p))') >= 0,
        '预览列表保留 ProvinceState 原型（直接 {...p} 会丢 class 方法）');
    check(ui.indexOf('const owner = sc.owners[p.id] || NEUTRAL;') >= 0
        && ui.indexOf('playable.indexOf(owner) < 0') >= 0,
    '点到不可执掌的城会给出具体提示，而不是静默无反应');

    // 选势力模式下点城不能落进战斗 / 调兵分支
    const pickHex = ui.slice(ui.indexOf('private onPickHex('));
    const pickHexBody = pickHex.slice(0, pickHex.indexOf('private syncRouteFocus('));
    check(pickHexBody.indexOf("if (this.mode === 'pickFaction')") >= 0
        && pickHexBody.indexOf('this.pickFactionAt(p)') >= 0,
    'onPickHex 在战斗分支之前拦截选势力模式');
    check(pickHexBody.indexOf("this.mode === 'pickFaction'")
        < pickHexBody.indexOf('this.state.canAttack('),
    '拦截位置在 canAttack 之前（不会先判一次能不能打）');

    // 提示条不能被 refreshHud 冲掉
    check(ui.indexOf("if (this.mode === 'pickFaction') {\n            // 交给 enterFactionPick") >= 0,
        'refreshHud 在选势力模式不覆盖提示文案');

    // 剧本面板入口改成两步
    check(ui.indexOf("makeLabel('StartNewGameTxt', '选势力开局'") >= 0,
        '剧本面板按钮改叫「选势力开局」（点它不会立刻开局）');
    check(ui.indexOf('startBtn.on(Node.EventType.TOUCH_END, () => this.enterFactionPick(), this)') >= 0,
        '按钮接到 enterFactionPick');
    check(ui.indexOf('() => this.startNewGame(this.pickScenarioId, this.pickFactionId), this)') < 0,
        '旧的「一点就开局」回调已移除（否则会跳过选势力）');

    // 面板里的势力按钮保留为预选，且要给出即时简报
    check(ui.indexOf('const brief = factionBriefOf(sc, this.pickFactionId);') >= 0,
        '剧本面板的势力按钮也给简报（预选不再只是改个名字）');

    // 渲染层：预览不画金环，但保留玩家势力供后续使用
    check(renderer.indexOf('public drawPreview(') >= 0,
        'MapRenderer 新增 drawPreview()：把「无主视角」的例外圈在一处');
    check(renderer.indexOf("this.draw(provinces, '')") >= 0,
        'drawPreview 内部以空玩家势力绘制（不给任何城画金环）');
    check(renderer.indexOf('this.playerFaction = keep') >= 0,
        'drawPreview 绘制后恢复玩家势力（交互与后续重绘不受影响）');

    // 不放宽既有守卫：Controller 里所有 draw 仍然带 playerFaction
    const drawCalls = ui.split('this.mapRenderer.draw(').length - 1;
    const withFaction = ui.split('this.mapRenderer.draw(list, this.state.playerFaction);').length - 1;
    check(drawCalls === withFaction,
        `所有底图重绘仍带 playerFaction（${drawCalls} 处），选势力没有放宽这条守卫`);

    // 注释里提到 GameState 是正常的（说明「为什么不用当前局面算」），
    // 真正要守的是「没有 import 它」—— 数据层不能反过来依赖状态层。
    check(scenarios.indexOf('export function factionBriefOf(') >= 0
        && !/import[^;]*GameState/.test(scenarios),
    '势力简报在数据层、不 import GameState（预览不碰当前局面）');
    check(scenarios.indexOf('export function factionBriefLines(') >= 0,
        '浮层文案与数据分离（UI 不自己拼字符串）');

    check(readme.indexOf('地图上') >= 0 && readme.indexOf('选势力') >= 0,
        'README 公开「在图上点城选势力」的开局流程');
}

sourceGuards().then(() => {
    console.log(`\n结果：${fail === 0 ? '全部通过' : '有失败'}（${pass} 通过 / ${pass + fail}）`);
    if (fail > 0) {
        process.exit(1);
    }
});
