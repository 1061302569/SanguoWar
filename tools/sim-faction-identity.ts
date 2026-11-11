/**
 * 回归：开局必须一眼找到自己执掌的势力
 *
 * 背景：以前只有一条 2 秒就消失的「你执掌曹操」横幅，之后顶栏只剩
 * 日期 / 金币 / 兵力 / 据点，18 个势力色块混在一张图上，玩家开局根本
 * 对不上「我是谁、我的地盘在哪」。现在的方案是三层互相印证：
 *   1) 左上角常驻身份牌：势力主色色块 + 名字 + 城数，点它定位己方前线城；
 *   2) 己方版图提亮一档、己方城池套常驻金环；
 *   3) 开局 / 新局 / 读档都用横幅和 toast 点名执掌势力。
 *
 * 本测试守住：
 *   - 每个剧本 × 每个可选势力，开局都有己方地盘、合法势力色、可定位的前线城；
 *   - 提亮策略在亮色势力上不会被 clamp 成一片死白（形同没标记）；
 *   - 身份牌、金环、引导文案、刷新链路的 UI 接线不被改丢；
 *   - 换剧本 / 换势力 / 读档时，地图与身份牌拿到的是同一个 playerFaction。
 *
 * 运行：
 *   node tools/bundle-test.mjs tools/sim-faction-identity.ts
 *   node --experimental-strip-types --no-warnings tools/.bundle.sim-faction-identity.ts
 */
import { GameState } from '../assets/scripts/core/GameState.ts';
import { SCENARIOS, playableFactions } from '../assets/scripts/data/Scenarios.ts';
import { FACTION_MAP } from '../assets/scripts/data/Factions.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failures++;
}

/** 取某个方法/函数的源码片段，用于做 UI 接线静态守卫 */
function bodyOf(src: string, start: string, end: string): string {
    const s = src.indexOf(start);
    if (s < 0) return '';
    const e = end ? src.indexOf(end, s + start.length) : src.length;
    return e > s ? src.slice(s, e) : '';
}

/** 与 MapRenderer.shade() 一致：按倍率提亮并 clamp 到 255 */
function shadeRgb(hex: string, f: number): number[] {
    const n = parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return rgb.map((v) => Math.min(255, Math.round(v * f)));
}

async function main(): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const ctrl = readFileSync('assets/scripts/GameController.ts', 'utf8');
    const renderer = readFileSync('assets/scripts/ui/MapRenderer.ts', 'utf8');

    const gs = new GameState();
    const playableSeen: Record<string, boolean> = {};
    const combos: Array<{ scName: string; fid: string }> = [];

    console.log('== 1. 每个剧本 × 每个可选势力，开局都有「自己」可找 ==');
    for (const sc of SCENARIOS) {
        for (const fid of playableFactions(sc)) {
            playableSeen[fid] = true;
            combos.push({ scName: sc.name, fid });
            gs.reset(sc.id, fid);

            const f = FACTION_MAP[fid];
            const mine = gs.provincesOf(fid);
            const declared = Object.keys(sc.owners).filter((pid) => sc.owners[pid] === fid).length;

            check(gs.playerFaction === fid, `${sc.name} · ${fid}：玩家势力就是所选势力`);
            check(!!f && f.name.length > 0, `${sc.name} · ${fid}：势力表里有中文名（身份牌要显示）`);
            check(!!f && /^#[0-9a-fA-F]{6}$/.test(f.color),
                `${sc.name} · ${fid}：势力主色是合法 #RRGGBB（色块要 Color.fromHEX）`);
            check(mine.length > 0 && mine.length === declared,
                `${sc.name} · ${fid}：开局有己方城池且与剧本归属一致（${mine.length} 城）`);
            check(mine.every((p) => p.owner === fid),
                `${sc.name} · ${fid}：己方城池 owner 全部正确（金环不会画到别人家）`);

            // 复刻 GameController.pickFrontlineProvince()：身份牌点击必须有落点
            const canAttack = mine.filter((p) => p.troops > 0 && gs.hasAttackTargets(p));
            let frontline: any = canAttack.length > 0 ? canAttack[0] : null;
            if (!frontline) {
                frontline = mine.find((p) => {
                    let hasEnemy = false;
                    gs.provinces.forEach((q) => {
                        if (!hasEnemy && q.owner !== fid && gs.isAdjacent(p, q)) hasEnemy = true;
                    });
                    return hasEnemy;
                }) || null;
            }
            if (!frontline) frontline = mine[0] || null;
            check(!!frontline && frontline.owner === fid,
                `${sc.name} · ${fid}：有可定位的己方前线城（点身份牌不会扑空）`);
        }
    }
    check(combos.length >= SCENARIOS.length * 2,
        `覆盖全部开局组合（${combos.length} 组）`);

    console.log('== 2. 己方提亮在亮色势力上仍然看得出来 ==');
    // 只提亮不改色相：如果势力色本来就很亮，1.45 和 1.25 会双双 clamp 成纯白，
    // 「己方提亮一档」就等于没画。新增可选势力时这条会先报出来。
    for (const fid of Object.keys(playableSeen)) {
        const f = FACTION_MAP[fid];
        const own = shadeRgb(f.color, 1.45);
        const other = shadeRgb(f.color, 1.25);
        const diff = Math.max(
            Math.abs(own[0] - other[0]),
            Math.abs(own[1] - other[1]),
            Math.abs(own[2] - other[2]),
        );
        const sumOwn = own[0] + own[1] + own[2];
        const sumOther = other[0] + other[1] + other[2];
        check(diff >= 12 && sumOwn > sumOther,
            `${f.name} ${f.color}：己方版图比别家明显更亮（最大通道差 ${diff}）`);
    }

    console.log('== 3. 常驻身份牌 UI 接线 ==');
    check(ctrl.indexOf("private factionSwatch: Graphics = null!;") >= 0
        && ctrl.indexOf("private factionLabel: Label = null!;") >= 0,
    'GameController 持有身份牌色块与文字字段');
    check(ctrl.indexOf("makeRectStroke('FactionBadge'") >= 0
        && ctrl.indexOf('addWidget(badge, { left: 16, top: 104 + this.topInset });') >= 0,
    '身份牌常驻挂在顶栏下方（不是两秒就消失的横幅）');
    check(ctrl.indexOf("badge.on(Node.EventType.TOUCH_END, this.onLocateOwn, this);") >= 0,
    '身份牌可点击定位');
    check(ctrl.indexOf("makeBox('FactionSwatch', 26, 26, badge)") >= 0
        && ctrl.indexOf("makeLabel('FactionTxt'") >= 0,
    '身份牌含势力主色色块与文字节点');
    check(ctrl.indexOf('addWidget(this.logNode, { left: 16, top: 156 + this.topInset });') >= 0,
    '战报下移，不与身份牌重叠');

    const refreshHud = bodyOf(ctrl, 'private refreshHud(): void {', 'update(dt: number): void {');
    check(refreshHud.length > 0, '能定位到 refreshHud()');
    check(refreshHud.indexOf('FACTION_MAP[st.playerFaction]') >= 0
        && refreshHud.indexOf('this.factionLabel.string = `我方 ') >= 0,
    '身份牌按当前玩家势力显示名字与城数');
    check(refreshHud.indexOf('Color.fromHEX(own, f ? f.color') >= 0
        && refreshHud.indexOf('const sg = this.factionSwatch;') >= 0
        && refreshHud.indexOf('sg.roundRect(') >= 0,
    '身份牌色块每次刷新都按势力主色重画');

    const refreshAll = bodyOf(ctrl, 'private refreshAll(): void {', 'private refreshHud(): void {');
    check(refreshAll.indexOf('this.refreshHud();') >= 0,
        'refreshAll() 会刷新身份牌（换局 / AI 夺城后城数跟着变）');
    check(refreshAll.indexOf('this.mapRenderer.draw(list, this.state.playerFaction);') >= 0,
        'refreshAll() 把当前玩家势力传给地图（金环跟着换势力走）');
    const drawCalls = ctrl.split('this.mapRenderer.draw(').length - 1;
    const drawWithFaction = ctrl.split('this.mapRenderer.draw(list, this.state.playerFaction);').length - 1;
    check(drawCalls > 0 && drawCalls === drawWithFaction,
        `所有底图重绘都带 playerFaction（${drawCalls} 处）`);
    check(ctrl.indexOf('this.state.onTurnEnd = () => this.refreshAll();') >= 0,
        '对手回合改归属后，身份牌城数也会刷新');

    const locate = bodyOf(ctrl, 'private onLocateOwn(): void {', 'private buildMenu(root: Node): void {');
    check(locate.indexOf('this.pickFrontlineProvince()') >= 0
        && locate.indexOf('this.mapInput.focusOn(target);') >= 0
        && locate.indexOf('this.mapInput.reclampView();') >= 0,
    '点身份牌：选己方前线城 → 居中 → 修正视野边界');
    check(locate.indexOf('已无我方城池') >= 0 && locate.indexOf('带金环的城都是你的地盘') >= 0,
    '定位反馈点明「金环 = 自己的地盘」，败亡时也有兜底提示');
    check(ctrl.indexOf('private pickFrontlineProvince(): ProvinceState | null {') >= 0,
        '前线城筛选逻辑仍在');

    console.log('== 4. 开局 / 新局 / 读档都点名「你是谁」 ==');
    const tutorial = bodyOf(ctrl, 'private showTutorial(): void {', 'onDestroy(): void {');
    check(tutorial.indexOf('你执掌 ') >= 0
        && tutorial.indexOf('${mine}/${total} 城') >= 0,
    '开局横幅点名执掌势力与城数');
    check(tutorial.indexOf('左上角是你执掌的势力') >= 0
        && tutorial.indexOf('带金环的城就是你的地盘') >= 0,
    '横幅消失后 toast 教玩家认身份牌与金环');
    check(tutorial.indexOf('this.pendingTimers.push(') >= 0
        && ctrl.indexOf('clearTimeout(id as any);') >= 0,
    '引导定时器在组件销毁时清理（不操作已销毁节点）');

    const newGame = bodyOf(ctrl, 'private startNewGame(', 'private checkGameOver(): boolean {');
    check(newGame.indexOf('你执掌 ') >= 0
        && newGame.indexOf('带金环的城是你的地盘，橙红箭头能打') >= 0,
    '换剧本 / 换势力 / 重开后横幅点名势力并说明金环与进攻箭头');
    check(ctrl.indexOf('已恢复进度 · 你执掌') >= 0,
        '读档恢复时也会点名执掌势力');

    console.log('== 5. 地图层：己方版图提亮 + 己方城池金环 ==');
    const drawBody = bodyOf(renderer, 'public draw(', 'this.renderRoutes();');
    check(drawBody.length > 0, '能定位到 MapRenderer.draw() 主体');
    check(/public draw\(provinces: ProvinceState\[\], playerFaction: string/.test(renderer),
        'draw() 接收 playerFaction（不是写死曹操）');
    check(drawBody.indexOf('p.owner === playerFaction ? 1.45 : 1.25') >= 0,
        '己方版图提亮一档，其余势力保持原提亮、不被淡化');
    check(drawBody.indexOf('shade(base, 0.') < 0 && drawBody.indexOf('shade(base, 0') < 0,
        '没有靠压暗别人来突出自己（淡化会被读成「没画」）');
    check(drawBody.indexOf('this.drawProvinces(g, provinces, playerFaction);') >= 0,
        '城池标记同样拿到当前玩家势力');
    // 顺序必须完整落在 draw() 里：先更新 playerFaction，再重画路网，
    // 否则换势力后橙红箭头还按上一局的「我方」判定方向。
    const drawFull = bodyOf(renderer, 'public draw(', '/** 湖泊 */');
    const assignAt = drawFull.indexOf('this.playerFaction = playerFaction;');
    const routesAt = drawFull.indexOf('this.renderRoutes();');
    check(assignAt >= 0 && routesAt > assignAt,
        '换势力后路网箭头方向也同步更新');

    const provinceMarks = bodyOf(renderer, 'private drawProvinces(', '// ==================================================================');
    check(renderer.indexOf('const OWN_RING = new Color(') >= 0
        && renderer.indexOf('const OWN_RING_EDGE = new Color(') >= 0,
    '己方金环颜色常量存在（深色外圈 + 亮金内圈）');
    check(provinceMarks.indexOf('if (p.owner === playerFaction)') >= 0
        && provinceMarks.indexOf('g.circle(pt.x, pt.y, ring)') >= 0
        && provinceMarks.indexOf('g.strokeColor = OWN_RING;') >= 0,
    '金环只画在己方城池上');
    check(renderer.indexOf('别再改回去') >= 0 || renderer.indexOf('所有路') >= 0,
        '路网常显设计注释仍在（金环没有把路网重新变成「点一下才看到」）');
    check(renderer.indexOf('drawRivers') < 0 && renderer.indexOf('drawMountains') < 0,
        '金环没有把之前清掉的地形装饰线带回来');

    console.log('== 6. 换势力 / 读档不会串台 ==');
    gs.reset('qunxiong_194', 'cao');
    const caoCities = gs.provincesOf('cao').length;
    gs.reset('guandu_200', 'yuan_shao');
    check(gs.playerFaction === 'yuan_shao'
        && FACTION_MAP[gs.playerFaction].color === '#8b5cf6',
    '换剧本换势力后，身份牌取到新势力的主色');
    const save = gs.serialize();
    const loaded = new GameState();
    check(loaded.deserialize(save)
        && loaded.playerFaction === 'yuan_shao'
        && loaded.provincesOf('yuan_shao').length > 0,
    '读档后仍是同一势力（身份牌不会指着上一局的曹操）');
    gs.reset('qunxiong_194', 'cao');
    check(gs.playerFaction === 'cao' && gs.provincesOf('cao').length === caoCities,
        '重开回默认剧本后己方城数复原');

    console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
    if (failures > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
