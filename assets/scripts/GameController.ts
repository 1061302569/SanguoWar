import {
    _decorator, Component, Node, Graphics, UITransform, Color, Vec3, Label,
    view, Director, tween, HorizontalTextAlignment, VerticalTextAlignment, sys, UIOpacity,
} from 'cc';
import { GameState, DomesticOrder, POLICY_NAME } from './core/GameState';
import { Balance } from './core/Balance';
import {
    PROFILE_KEY, PlayerProfile, RunResult, defaultProfile, sanitizeProfile,
    TUTORIAL_STEPS, OBJECTIVE_IDS, OBJECTIVE_NAMES, objectiveLevel, objectiveLines,
    tutorialLine, gradeOf, shareTextOf, recordResult, profileLine,
} from './core/Profile';
import { Geo } from './core/Geo';
import { MapCamera } from './core/MapCamera';
import { GeneralState, ProvinceState, RulerBonus } from './data/Types';
import { FACTION_MAP } from './data/Factions';
import { ROLE_NAME, BONUS_KIND } from './data/Generals';
import {
    DEFAULT_SCENARIO_ID, SCENARIOS, ScenarioDef, getScenario, playableFactions,
} from './data/Scenarios';
import { MapRenderer } from './ui/MapRenderer';
import { MapInput } from './ui/MapInput';
import { CombatAnimator } from './ui/CombatAnimator';
import { BattleShowcase } from './ui/BattleShowcase';
import { AudioPlayer } from './audio/AudioPlayer';
import { makeNode, makeBox, makeRect, makeRectStroke, makeLabel, setPos, addWidget } from './ui/UIKit';
import {
    copyText, currentShareText, getTopInsetDesign, isWeChat, keepScreenOn, loadData,
    onHide, saveData, setShareText, setupShare, vibrateShort,
} from './platform/WeChatAdapter';

const { ccclass } = _decorator;

/** 本地存档的存储键（局面存档：新开一局会清掉） */
const SAVE_KEY = 'sanguowar_save_v1';
/** 开局默认分享标语；结算后由战绩文案覆盖 */
const DEFAULT_SHARE = '三国战棋：从一城之地到天下一统';

/** 省份上的旗帜/数字标签 */
interface HexView {
    label: Label;
    node: Node;
    /** 标签相对地图的基准位置（未缩放时的地图坐标） */
    baseX: number;
    baseY: number;
    /** 该城的圆点半径（用于计算标签偏移） */
    baseR: number;
}

@ccclass('GameController')
export class GameController extends Component {
    /** 游戏状态 */
    public state = new GameState();

    private mapRoot: Node = null!;
    private mapRenderer: MapRenderer = null!;
    private mapInput: MapInput = null!;
    private hexLabels: Map<string, HexView> = new Map();

    /** 当前选中的省份 */
    private selected: ProvinceState | null = null;
    /** 高亮模式 */
    private mode: 'select' | 'move' | 'attack' = 'select';

    // ---- UI 引用 ----
    private topBar: Node = null!;
    private dateLabel: Label = null!;
    private goldLabel: Label = null!;
    /** 粮草：发展度机制的第二资源，月募兵与筑城都要花它 */
    private foodLabel: Label = null!;
    private troopLabel: Label = null!;
    private provLabel: Label = null!;
    private hintLabel: Label = null!;

    private panel: Node = null!;
    private panelTitle: Label = null!;
    private panelBody: Label = null!;
    private panelAccent: Graphics = null!;

    private logNode: Node = null!;
    private logLabel: Label = null!;

    /** 敌情预警条：AI 集结意图留到玩家回合常驻可见，没有敌情时整块隐藏 */
    private threatNode: Node = null!;
    private threatLabel: Label = null!;

    private endTurnBtn: Node = null!;

    // 内政四选一（治理 / 屯田 / 筑城 / 征兵）与军事两键，分两行摆
    private governBtn: Node = null!;
    private farmBtn: Node = null!;
    private fortifyBtn: Node = null!;
    private recruitBtn: Node = null!;
    private attackBtn: Node = null!;
    private moveBtn: Node = null!;
    private cancelBtn: Node = null!;

    /** 内政「自动」开关：打开后每回合重复最后一道内政 */
    private autoBtn: Node = null!;
    private autoLabel: Label = null!;

    /** 主循环时间 */
    private timeAcc = 0;

    /** 顶部安全区（设计像素），微信胶囊按钮下沿 */
    private topInset = 0;

    /** 音效播放器 */
    private audio = new AudioPlayer();
    /** 战斗动画器 */
    private animator: CombatAnimator = null!;
    /** 战斗演出编排 */
    private showcase: BattleShowcase = null!;
    /** 静音按钮上的文字 */
    private muteLabel: Label = null!;
    /** 路网是否常驻显示（顶栏「路网」开关） */
    private routesVisible = true;
    /** 路网开关按钮上的文字 */
    private routeToggleLabel: Label = null!;

    /** 常驻「我方势力」身份牌：势力主色色块 + 文字（开局一眼找到自己） */
    private factionSwatch: Graphics = null!;
    private factionLabel: Label = null!;

    /** 当前的浮动提示节点（同一时刻只保留一条） */
    private toastNode: Node | null = null;

    /** 待清理的定时器（组件销毁时统一取消） */
    private pendingTimers: number[] = [];

    /** 双击检测：上次点击的城池与时间 */
    private lastTapId: string | null = null;
    private lastTapTime = 0;

    // ---- 新开一局 / 剧本选择 / 胜负结算 ----
    private menuLayer: Node = null!;
    private scenarioPanel: Node = null!;
    private resultPanel: Node = null!;

    // ---- 俘虏营 ----
    /** 顶栏入口；有俘虏时亮金边，没有时保持暗色 */
    private prisonBtn: Node = null!;
    private prisonBtnLabel: Label = null!;
    private prisonPanel: Node = null!;
    private prisonInfo: Label = null!;
    private prisonCount: Label = null!;
    private prisonPrevBtn: Node = null!;
    private prisonNextBtn: Node = null!;
    /** 固定 4 行，内容按当前俘虏列表刷新（与剧本卡片同一套路） */
    private prisonRows: Array<{
        node: Node;
        info: Label;
        recruit: Node;
        release: Node;
        recruitLabel: Label;
        releaseLabel: Label;
    }> = [];
    /** 当前 4 行分别对应的武将 id，按钮回调靠它反查 */
    private prisonIds: string[] = [];
    /** 俘虏营当前页（一页 4 人，超过 4 人可以翻页，不能让人凭空消失） */
    private prisonPage = 0;
    private static readonly PRISON_PER_PAGE = 4;
    private menuInfo: Label = null!;
    private menuSub: Label = null!;
    private resultTitle: Label = null!;
    private resultBody: Label = null!;
    private cardNodes: Node[] = [];
    private cardLabels: Label[] = [];
    private cardEraLabels: Label[] = [];
    private cardDescLabels: Label[] = [];
    private prevPageBtn: Node = null!;
    private nextPageBtn: Node = null!;
    /** 剧本列表每页显示的卡片数 */
    private static readonly CARDS_PER_PAGE = 3;
    /** 剧本列表当前页（每页 3 个，以后加剧本会自动分页） */
    private menuPage = 0;
    private factionNodes: Node[] = [];
    private factionLabels: Label[] = [];
    /** 当前势力按钮各自对应的势力 id（剧本不同，顺序不同） */
    private factionIds: string[] = [];
    /** 剧本选择弹窗里待确认的选择 */
    private pickScenarioId = DEFAULT_SCENARIO_ID;
    private pickFactionId = 'cao';
    /** 本局是否已弹过结算（避免每回合重复弹） */
    private gameOverShown = false;

    // ---- 首次体验：局外档案 / 任务式引导 / 阶段目标 / 战绩分享 ----
    /** 跨对局累计成绩，存独立 key，不随局面存档被清掉 */
    private profile: PlayerProfile = defaultProfile();
    /** 常驻目标条：引导期显示下一步，引导完成后显示阶段目标 */
    private goalNode: Node = null!;
    private goalLabel: Label = null!;
    /** 已播报过的目标级别：丢城回退不重复播报 */
    private goalShownLevel = -1;
    /** 本局战绩是否已计入档案：结算面板可能被反复打开，只能记一次 */
    private resultRecorded = false;

    onLoad(): void {
        // ---- 局外档案：独立 key，开局就恢复，结算与引导都读它 ----
        this.profile = sanitizeProfile(loadData(PROFILE_KEY));
        setShareText(this.profile.lastResult || DEFAULT_SHARE);

        // ---- 小游戏平台初始化 ----
        if (sys.platform === sys.Platform.WECHAT_GAME) {
            keepScreenOn();
            // 转发回调读的是适配层里的当前文案，结算后会自动换成带回合数的战绩
            setupShare(currentShareText());
            // 切到后台时自动存档，避免玩家丢进度
            onHide(() => this.saveGame());
        }

        // ---- 尝试恢复存档 ----
        const loaded = this.tryLoadGame();

        this.buildMap();
        this.buildHud();
        this.refreshAll();

        // ---- 订阅回合结算：状态层统一通知 UI 重绘 ----
        // 必须放在 buildMap/buildHud 之后，refreshAll() 依赖这些节点。
        // 对手回合（AI 阶段）改的是 ProvinceState.owner，而版图颜色只在
        // MapRenderer.draw() 里按 owner 重绘；漏掉刷新就会出现
        // 「城池已被攻下，到了我方回合地图还是旧颜色」。
        // 绑在状态层回调上，任何调用 endTurn() 的入口都不会再漏。
        this.state.onTurnEnd = () => this.refreshAll();

        // ---- 开局引导 ----
        // 新玩家面对一整张地图往往不知道从哪下手，这里给一段简短指引，
        // 并自动选中一座可进攻的城池，让玩家第一步有明确落点。
        if (!loaded) {
            this.selectProvince(this.pickFrontlineProvince());
            this.showTutorial();
        } else {
            this.selectProvince(null);
            // 读档也要点名执掌势力：顶栏常驻身份牌之外，再给一次明确提示
            const f = FACTION_MAP[this.state.playerFaction];
            this.toast(`已恢复进度 · 你执掌 ${f ? f.name : this.state.playerFaction}`);
        }

        // 读档进来时若本局已经统一/败亡，直接给结算入口，
        // 否则玩家只能一直对着一张打完的地图，找不到重开的地方。
        if (loaded && (this.state.isVictory() || this.state.isDefeat())) {
            this.gameOverShown = true;
            this.showResult(this.state.isVictory());
        }

        // ---- 音频初始化 ----
        // 静音状态从本地存档恢复，并同步按钮显示
        this.updateMuteLabel(this.audio.muted);
        // 预先合成并缓存全部音效，避免首次播放有卡顿
        this.audio.preload(['hit', 'capture', 'fail', 'click', 'turn']);
    }

    /** 开局引导：先点名「你是谁」，再说明怎么在地图上认出自己 */
    private showTutorial(): void {
        const mine = this.state.provincesOf(this.state.playerFaction).length;
        const total = this.state.provinces.size;
        const f = FACTION_MAP[this.state.playerFaction];
        const name = f ? f.name : this.state.playerFaction;
        this.showBanner(`你执掌 ${name} · ${mine}/${total} 城`);
        // 横幅消失之后再用 toast 把「怎么找到自己的地盘」讲清楚；
        // 左上角常驻身份牌会一直显示势力主色与名字。
        const id = setTimeout(() => {
            this.toast('左上角是你执掌的势力 · 带金环的城就是你的地盘');
        }, 900);
        // 组件销毁时清理，避免回调落到已销毁的节点
        this.pendingTimers.push(id as any);
        // 再补一条内政引导：说清「选了不立刻生效、结束回合才结算」和
        // 「自动开关 + 内政键」这一个组合，免得玩家以为点完就该看到数值变化。
        const id2 = setTimeout(() => {
            this.toast('内政键只做选择，点「结束回合」才统一执行；开「自动」则全境执行');
        }, 3400);
        this.pendingTimers.push(id2 as any);
        // 最后一条讲出兵节奏：一城一回合只能出征一次、后方余兵会自动前送。
        // 这两条不说明白，玩家要么以为「点了进攻没反应」，要么以为「兵怎么自己少了」。
        const id3 = setTimeout(() => {
            this.toast('每城一回合只能出征一次；后方余兵会自动补给到前线');
        }, 6000);
        this.pendingTimers.push(id3 as any);

        // 三条定时 toast 只作补充说明：真正的主引导是左上角常驻目标条。
        // 它不会弹遮罩、不拦截点击，玩家做完一步才推进下一步。
        this.refreshGoalBar();
    }

    onDestroy(): void {
        // 组件销毁时回收音频资源与在途的演出定时器
        if (this.showcase) {
            this.showcase.cancelAll();
        }
        // 取消未执行的引导/提示定时器，避免回调操作已销毁的节点
        for (const id of this.pendingTimers) {
            clearTimeout(id as any);
        }
        this.pendingTimers = [];
        // 解绑状态层回调，避免组件销毁后回调仍指向已销毁的 UI 节点
        this.state.onTurnEnd = null;
        this.audio.dispose();
    }

    /** 尝试读取存档并恢复局面，返回是否成功恢复 */
    private tryLoadGame(): boolean {
        const data = loadData(SAVE_KEY);
        if (!data) {
            return false;
        }
        if (this.state.deserialize(data)) {
            this.state.pushLog(`已读取存档：${this.state.dateText()}，第 ${this.state.turn} 回合。`);
            return true;
        }
        return false;
    }

    /** 保存当前局面 */
    public saveGame(): boolean {
        return saveData(SAVE_KEY, this.state.serialize());
    }

    /** 重开一局（沿用当前剧本与势力，同时清掉旧存档） */
    public restartGame(): void {
        this.startNewGame();
    }

    /**
     * 新开一局（换剧本 / 换势力 / 统一天下后再来一把，都走这一个入口）
     *
     * 统一了「重置状态、清存档、重建地图引用、重置视野、刷新 UI」的顺序，
     * 避免各处各写一套导致重开后点到上一局的城池数据。
     */
    private startNewGame(scenarioId?: string, factionId?: string): void {
        const sid = scenarioId || this.state.scenarioId;
        const fid = factionId || this.state.playerFaction;

        // 在途的战斗演出可能还持有旧城池对象，先取消
        this.showcase.cancelAll();
        // 旧进度必须清掉，否则下次进游戏又被读回来
        saveData(SAVE_KEY, null);

        this.state.reset(sid, fid);
        this.gameOverShown = false;
        this.resultRecorded = false;
        this.goalShownLevel = -1;
        this.lastTapId = null;
        this.lastTapTime = 0;
        this.mode = 'select';
        this.hideMenu();

        // selected 指向的是上一局的 ProvinceState，必须先清空再刷新
        this.selectProvince(null);
        this.mapInput.resetView();
        this.refreshAll();
        this.selectProvince(this.pickFrontlineProvince());
        // 新局面立刻落盘，玩家中途退出也不会回到旧局
        this.saveGame();

        const sc = getScenario(sid);
        const f = FACTION_MAP[fid];
        const name = f ? f.name : fid;
        const mine = this.state.provincesOf(fid).length;
        // 换剧本 / 换势力之后最容易「不知道自己是谁」，横幅必须点名执掌势力
        this.showBanner(`你执掌 ${name} · ${mine} 城`);
        this.toast(`${sc.name}开局 · 带金环的城是你的地盘，橙红箭头能打`);
    }

    /** 检查本局是否已结束；已弹过结算就不再重复弹 */
    private checkGameOver(): boolean {
        if (this.gameOverShown) {
            return true;
        }
        if (this.state.isVictory()) {
            this.gameOverShown = true;
            this.showResult(true);
            return true;
        }
        if (this.state.isDefeat()) {
            this.gameOverShown = true;
            this.showResult(false);
            return true;
        }
        return false;
    }

    // ==================================================================
    // 剧本选择 / 胜负结算弹窗
    // ==================================================================

    /** 剧本列表总页数 */
    private pageCount(): number {
        return Math.max(1, Math.ceil(SCENARIOS.length / GameController.CARDS_PER_PAGE));
    }

    /** 当前页要显示的剧本 */
    private visibleScenarios(): ScenarioDef[] {
        const start = this.menuPage * GameController.CARDS_PER_PAGE;
        return SCENARIOS.slice(start, start + GameController.CARDS_PER_PAGE);
    }

    /** 剧本列表翻页 */
    private onMenuPage(delta: number): void {
        this.menuPage = Math.min(this.pageCount() - 1, Math.max(0, this.menuPage + delta));
        this.refreshScenarioMenu();
    }

    /** 点击第 i 张卡片（卡片复用，取当前页对应的剧本） */
    private onPickScenarioAt(index: number): void {
        const sc = this.visibleScenarios()[index];
        if (sc) {
            this.onPickScenario(sc.id);
        }
    }

    /** 打开剧本选择（顶栏「新局」或结算面板「换个剧本」） */
    private openScenarioMenu(): void {
        this.pickScenarioId = this.state.scenarioId;
        this.pickFactionId = this.state.playerFaction;
        // 直接翻到当前剧本所在页，玩家一眼看到自己在玩哪个
        let idx = 0;
        for (let i = 0; i < SCENARIOS.length; i++) {
            if (SCENARIOS[i].id === this.pickScenarioId) {
                idx = i;
                break;
            }
        }
        this.menuPage = Math.floor(idx / GameController.CARDS_PER_PAGE);
        this.menuLayer.active = true;
        this.scenarioPanel.active = true;
        this.resultPanel.active = false;
        // 三个弹窗共用同一层遮罩，必须互斥：不然从俘虏营切过来会两层叠在一起
        this.prisonPanel.active = false;
        this.refreshScenarioMenu();
    }

    private hideMenu(): void {
        if (this.menuLayer) {
            this.menuLayer.active = false;
        }
    }

    private onPickScenario(id: string): void {
        this.pickScenarioId = id;
        this.pickFactionId = getScenario(id).playerFaction;
        this.refreshScenarioMenu();
    }

    private onPickFaction(index: number): void {
        const fid = this.factionIds[index];
        if (fid) {
            this.pickFactionId = fid;
            this.refreshScenarioMenu();
        }
    }

    /** 刷新剧本卡片与势力按钮的选中态 */
    private refreshScenarioMenu(): void {
        const sc = getScenario(this.pickScenarioId);
        const factions = playableFactions(sc);
        if (factions.indexOf(this.pickFactionId) < 0) {
            this.pickFactionId = sc.playerFaction;
        }
        this.factionIds = factions;

        const visible = this.visibleScenarios();
        this.cardNodes.forEach((n, i) => {
            const s = visible[i];
            n.active = !!s;
            if (!s) {
                return;
            }
            const lb = this.cardLabels[i];
            lb.string = `${s.id === sc.id ? '◆ ' : '　 '}${s.name}`;
            lb.color = s.id === sc.id
                ? new Color(255, 225, 150, 255)
                : new Color(220, 210, 190, 255);
            this.cardEraLabels[i].string = `${s.era}　难度 ${s.difficulty}`;
            this.cardDescLabels[i].string = s.desc;
        });

        const pages = this.pageCount();
        this.menuSub.string = `选一个剧本与执掌势力　${this.menuPage + 1}/${pages}`;
        this.prevPageBtn.active = pages > 1 && this.menuPage > 0;
        this.nextPageBtn.active = pages > 1 && this.menuPage < pages - 1;

        this.factionNodes.forEach((n, i) => {
            const fid = factions[i];
            n.active = !!fid;
            if (!fid) {
                return;
            }
            const f = FACTION_MAP[fid];
            this.factionLabels[i].string = `${fid === this.pickFactionId ? '◆ ' : '　 '}${f ? f.name : fid}`;
            this.factionLabels[i].color = fid === this.pickFactionId
                ? new Color(255, 225, 150, 255)
                : new Color(220, 210, 190, 255);
        });

        const f = FACTION_MAP[this.pickFactionId];
        this.menuInfo.string = `当前选择：${sc.era}　难度 ${sc.difficulty}　`
            + `执掌 ${f ? f.name : this.pickFactionId}\n`
            + '开始新局会清空当前进度，此操作不可撤销。';
    }

    /**
     * 统一天下 / 败亡结算
     *
     * 以前只有「剧本 / 执掌 / 用时 / 据点」四行和一句「再来一把」，
     * 玩家赢完没有可比较的成绩，也没有理由把游戏发给别人。现在给出
     * 本局事实、评价、累计档案与一句带回合数的挑战文案 —— 全部只是
     * 展示与记录，不发任何金币 / 兵 / 粮。
     */
    private showResult(win: boolean): void {
        this.menuLayer.active = true;
        this.scenarioPanel.active = false;
        this.resultPanel.active = true;
        this.prisonPanel.active = false;

        const sc = getScenario(this.state.scenarioId);
        const f = FACTION_MAP[this.state.playerFaction];
        const mine = this.state.provincesOf(this.state.playerFaction).length;
        const total = this.state.provinces.size;
        const s = this.state.stats;
        const result: RunResult = {
            win,
            faction: f ? f.name : this.state.playerFaction,
            scenario: sc.name,
            turns: this.state.turn,
            cities: mine,
            total,
            stats: s,
        };
        const share = shareTextOf(result);

        // 结算面板会被反复打开（读档进来、剧本弹窗返回、继续看看后再看），
        // 累计档案只能记一次，否则 plays / wins 会虚高。
        if (!this.resultRecorded) {
            this.profile = recordResult(this.profile, result);
            this.saveProfile();
            this.resultRecorded = true;
        }
        // 右上角「···」转发立刻带上本局成绩，而不再是开局那句静态标语
        setShareText(share);

        this.resultTitle.string = win ? '天下一统' : '大势已去';
        this.resultBody.string = [
            `剧本　${sc.name}（${sc.era}） · 执掌 ${f ? f.name : this.state.playerFaction}`,
            `用时　第 ${this.state.turn} 回合 · ${this.state.dateText()}　评价 ${gradeOf(win, this.state.turn)}`,
            `据点　${mine} / ${total}　最大版图 ${s.maxCities} 城`,
            `战绩　攻占 ${s.captures} 城 · 丢城 ${s.losses} 次`,
            `　　　收降 ${s.persuaded} 人 · 放归 ${s.released} 人`,
            '',
            profileLine(this.profile),
            '',
            `分享语　${share}`,
            win ? '四海归一 · 换个剧本，或挑战更快回合数。'
                : '基业尽失 · 这局的最远版图已经记进档案。',
        ].join('\n');
    }

    // ==================================================================
    // 俘虏营
    //
    // 因果链在 UI 上的落点：攻破敌城生擒 → 顶栏「俘虏」亮起 → 进营二选一
    // （招降 / 放归）→ 成功率与忠诚变化全部问 state，这里只显示不另写判定。
    // ==================================================================

    /** 打开俘虏营：和剧本 / 结算面板互斥，共用同一层遮罩 */
    private openPrisonMenu(): void {
        this.prisonPage = 0;
        this.menuLayer.active = true;
        this.scenarioPanel.active = false;
        this.resultPanel.active = false;
        this.prisonPanel.active = true;
        this.refreshPrisonMenu();
        this.audio.play('click');
    }

    /** 俘虏营翻页 */
    private onPrisonPage(delta: number): void {
        this.prisonPage = Math.max(0, this.prisonPage + delta);
        this.refreshPrisonMenu();
        this.audio.play('click');
    }

    /** 重画一行的按钮明暗：在位君主的「招降」画暗（点了仍会给出明确原因） */
    private paintPrisonButton(node: Node, label: Label, enabled: boolean): void {
        const g = node.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = enabled ? new Color(110, 76, 34, 255) : new Color(52, 48, 42, 255);
            g.strokeColor = enabled
                ? new Color(230, 190, 110, 255)
                : new Color(110, 105, 95, 200);
            g.lineWidth = enabled ? 2 : 1;
            g.rect(-48, -22, 96, 44);
            g.fill();
            g.stroke();
        }
        label.color = enabled
            ? new Color(255, 240, 210, 255)
            : new Color(130, 125, 115, 255);
    }

    /** 刷新俘虏营：名单 / 成功率 / 页码 / 按钮明暗全部来自 state */
    private refreshPrisonMenu(): void {
        // 按忠诚从低到高排：最容易招降的排最前；在位君主忠诚高，自然沉底
        const list = this.state.prisonersOf(this.state.playerFaction).slice()
            .sort((a, b) => a.loyalty - b.loyalty);
        const pages = Math.max(1, Math.ceil(list.length / GameController.PRISON_PER_PAGE));
        // 处置掉一个人后名单变短，页码要收回来，别停在空白页
        this.prisonPage = Math.min(this.prisonPage, pages - 1);
        const start = this.prisonPage * GameController.PRISON_PER_PAGE;
        const visible = list.slice(start, start + GameController.PRISON_PER_PAGE);

        // 规则写在脸上：成功率、放归降忠诚、招降失败反升，都是公开数值。
        // 「在位」两个字是关键：不写清楚，玩家会以为君主永远招不了，
        // 攻灭一国时也就不会想到「把君主也抓过来」这条线。
        const persuadeBonus = this.state.persuadeBonus();
        this.prisonInfo.string = [
            '招降率 (100-忠诚)/100；在位君主不可招降，失去所有城池后可招。',
            `放归降 ${Balance.releaseLoyaltyDrop} 忠诚（旧主猜忌），下次被俘更好招。`,
            `招降失败反升 ${Balance.persuadeFailLoyaltyGain} 点，越劝越硬。`
                + (persuadeBonus > 0
                    ? ` 我方君威 降+${Math.round(persuadeBonus * 100)}%` : ''),
        ].join('\n');
        this.prisonCount.string = list.length === 0
            ? '俘虏营空无一人 · 攻破敌城按概率生擒守将'
            : `在押 ${list.length} 人　第 ${this.prisonPage + 1}/${pages} 页`;
        this.prisonPrevBtn.active = pages > 1 && this.prisonPage > 0;
        this.prisonNextBtn.active = pages > 1 && this.prisonPage < pages - 1;

        this.prisonIds = [];
        this.prisonRows.forEach((row, i) => {
            const g = visible[i];
            row.node.active = !!g;
            this.prisonIds.push(g ? g.def.id : '');
            if (!g) {
                return;
            }
            const f = FACTION_MAP[g.faction];
            // 在位 / 亡国是两套结果：在位君主恒 0%，亡国君主按忠诚算。
            // 按钮明暗、成功率文本全部由 isReigning() 一个判定驱动，不各写一套。
            const reigning = this.state.isReigning(g);
            const chance = this.state.persuadeChance(g);
            const chanceText = reigning ? '不可招降' : `招降 ${Math.round(chance * 100)}%`;
            const roleText = g.def.ruler
                ? (reigning ? '君主' : '旧主')
                : ROLE_NAME[g.def.role];
            // 君主报称号与加成（这才是招降他的理由），其他人报原属势力
            const sub = g.def.bonus
                ? `${g.def.bonus.title} ${this.bonusText(g.def.bonus)}`
                : (f ? f.name : g.faction);
            row.info.string = `${g.def.name} · ${roleText} · ${sub}\n`
                + `忠诚 ${g.loyalty}/${Balance.loyaltyMax} · ${chanceText}`;
            row.info.color = g.def.ruler
                ? new Color(235, 205, 160, 255)
                : new Color(235, 230, 215, 255);
            this.paintPrisonButton(row.recruit, row.recruitLabel, !reigning);
            this.paintPrisonButton(row.release, row.releaseLabel, true);
        });
    }

    /** 招降第 i 行：成功则改旗易帜并安置，失败忠诚上升 */
    private onPrisonRecruit(index: number): void {
        const gid = this.prisonIds[index];
        if (!gid) {
            return;
        }
        const res = this.state.persuade(gid);
        this.showcase.playClick();
        this.audio.play(res.ok ? 'capture' : 'fail');
        this.toast(res.reason);
        this.saveGame();
        this.refreshAll();
        this.refreshPrisonMenu();
    }

    /** 放归第 i 行：回原势力并降忠诚，为下次招降铺路 */
    private onPrisonRelease(index: number): void {
        const gid = this.prisonIds[index];
        if (!gid) {
            return;
        }
        const res = this.state.release(gid);
        this.showcase.playClick();
        this.audio.play(res.ok ? 'click' : 'fail');
        this.toast(res.reason);
        this.saveGame();
        this.refreshAll();
        this.refreshPrisonMenu();
    }

    /** 顶栏「俘虏」：营里有人时亮底金边，不用玩家自己记着抓了谁 */
    private refreshPrisonButton(): void {
        if (!this.prisonBtn || !this.prisonBtn.isValid) {
            return;
        }
        const count = this.state.prisonersOf(this.state.playerFaction).length;
        const g = this.prisonBtn.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = count > 0 ? new Color(146, 106, 38, 255) : new Color(50, 44, 34, 230);
            g.strokeColor = count > 0
                ? new Color(255, 226, 138, 255)
                : new Color(170, 145, 95, 200);
            g.lineWidth = count > 0 ? 3 : 2;
            g.rect(-26, -20, 52, 40);
            g.fill();
            g.stroke();
        }
        this.prisonBtnLabel.color = count > 0
            ? new Color(255, 240, 200, 255)
            : new Color(240, 225, 190, 255);
    }

    // ==================================================================
    // 地图构建
    // ==================================================================

    private buildMap(): void {
        // 地图尺寸由真实经纬度投影决定
        // mapRoot 尺寸取地图投影尺寸即可。
        //
        // 注意：Geo.project() 现在以**地图中心**为原点返回坐标，
        // 与节点本地坐标（UITransform 锚点 0.5，中心原点）一致，
        // 所以这里不能再加 200 的额外边距——那会让原点偏移 100px，
        // 绘制和命中都会整体错位。
        this.mapRoot = makeBox('MapRoot', Geo.width, Geo.height, this.node);

        const terrainNode = makeNode('Terrain', this.mapRoot);
        const terrainG = terrainNode.addComponent(Graphics);

        // 路网单独一层：压在地形之上、光晕之下。
        // 归属变化时 draw() 会重画；选中/模式变化时只重画这一层，不用重绘整张地图。
        const routesNode = makeNode('Routes', this.mapRoot);
        const routesG = routesNode.addComponent(Graphics);

        const glowNode = makeNode('Glow', this.mapRoot);
        const glowG = glowNode.addComponent(Graphics);

        const hiNode = makeNode('Highlight', this.mapRoot);
        const hiG = hiNode.addComponent(Graphics);

        this.mapRenderer = new MapRenderer(terrainG, routesG, glowG, hiG);

        const list: ProvinceState[] = [];
        this.state.provinces.forEach((p) => list.push(p));
        this.mapRenderer.draw(list, this.state.playerFaction);

        // 每个城池的标签：名称 + 兵力
        for (const p of list) {
            const pt = Geo.project(p.lat, p.lon);
            const r = p.def.city ? MapRenderer.CITY_RADIUS : MapRenderer.NODE_RADIUS;
            const n = makeNode(`Lbl_${p.id}`, this.mapRoot);
            // 标签放在圆点下方，避免遮住城池本身
            setPos(n, pt.x, pt.y - r - 16);
            const ut = n.addComponent(UITransform);
            ut.setContentSize(96, 40);
            const lb = n.addComponent(Label);
            lb.fontSize = 17;
            lb.lineHeight = 18;
            lb.isBold = true;
            lb.useSystemFont = true;
            lb.color = new Color(30, 24, 16, 255);
            // 描边，保证在彩色版图上也清晰
            lb.enableOutline = true;
            lb.outlineColor = new Color(252, 248, 236, 240);
            lb.outlineWidth = 3;
            lb.horizontalAlign = HorizontalTextAlignment.CENTER;
            lb.verticalAlign = VerticalTextAlignment.CENTER;
            // 记录标签相对城池的偏移，缩放时需要重新计算
            this.hexLabels.set(p.id, {
                label: lb,
                node: n,
                baseX: pt.x,
                baseY: pt.y,
                baseR: r,
            });
        }

        // 初始缩放与视野：走 MapCamera.resetToStartView 这一个入口，
        // 保证游戏与测试（tools/sim-play.ts）使用完全相同的初始视野算法。
        // 之前两边各写一套，导致测试全红却查不出原因。
        const initial = new MapCamera({ width: 720, height: 1280 });
        initial.resetToStartView(34.4, 113.0, MapRenderer.NODE_RADIUS * 2);
        this.mapRoot.setScale(new Vec3(initial.zoom, initial.zoom, 1));
        this.mapRoot.setPosition(new Vec3(initial.x, initial.y, 0));

        // 战斗动画与演出编排（挂在 mapRoot 上，坐标系与地图一致）
        this.animator = new CombatAnimator(this.mapRoot);
        this.showcase = new BattleShowcase(this.animator, this.audio);

        // 交互（放在最后，确保 mapRoot 的初始缩放已经设好）
        this.mapInput = new MapInput(this.mapRoot, list);
        this.mapInput.onPick = (p) => this.onPickHex(p);
        // 用版图命中：点色块任意位置都能选中，比点 35px 小圆点容易得多。
        // 回调收到的是「地图局部坐标」（MapInput 内部已做 screenToMap）；
        // 后续每次 refreshAll 都会按当前局面重新注入，避免引用上一局的数据。
        this.mapInput.setTerritoryPicker((mx, my) => this.mapRenderer.territoryAt(list, mx, my));
        // 缩放时标签反向缩放保持字号恒定；路网线宽同样取倒数，
        // 否则放大到 2.2 倍时驿道会粗得盖住城池。
        this.mapInput.onZoom = (scale) => {
            this.rescaleLabels(scale);
            this.mapRenderer.setRouteScale(scale);
        };

        // ⚠ 必须让相机做一次边界修正。
        // 上面只按「对准洛阳」摆了位置，但没检查地图是否铺满屏幕——
        // 实测会在地图下方露出约 300px 的纯海面空白。
        // 统一交给 MapCamera.clamp() 处理，避免游戏和测试两套逻辑。
        this.mapInput.reclampView();
        // 标签与路网线宽按初始缩放摆好
        this.rescaleLabels(this.mapInput.scale);
        this.mapRenderer.setRouteScale(this.mapInput.scale);
    }

    /**
     * 标签反向缩放
     *
     * 问题：标签是 mapRoot 的子节点，会跟着地图一起放大。
     * 放大到 2.2 倍时字号从 17px 变成 37px，相邻城池的标签糊成一片。
     *
     * 解法（地图类 App 的标准做法）：给每个标签节点设 `1/zoom` 的缩放，
     * 抵消父节点的放大，使**屏幕上的字号恒定**。
     * 同时按新的圆点半径重新摆放位置，避免标签压住圆点。
     */
    private rescaleLabels(zoom: number): void {
        if (!this.hexLabels || this.hexLabels.size === 0) {
            return;
        }
        const inv = 1 / Math.max(0.1, zoom);
        this.hexLabels.forEach((v) => {
            if (!v.node || !v.node.isValid) {
                return;
            }
            v.node.setScale(new Vec3(inv, inv, 1));
            // 标签始终紧贴圆点下方（距离按未缩放的地图单位算）
            setPos(v.node, v.baseX, v.baseY - v.baseR - 13);
        });
    }

    // ==================================================================
    // HUD
    // ==================================================================

    private buildHud(): void {
        const root = this.node;

        // 微信右上角有胶囊按钮，顶栏需要按它下沿下移，否则会互相遮挡。
        // 设计高度取项目设定，把 px 安全区换算成设计像素。
        const designH = 1280;
        const topInset = getTopInsetDesign(designH);
        this.topInset = topInset;

        // ---- 顶栏 ----
        const BAR_H = 96;
        const bar = makeRectStroke('TopBar', 720, BAR_H, new Color(28, 24, 18, 235),
            new Color(180, 150, 90, 200), 2, root);
        addWidget(bar, { top: topInset, hCenter: 0 });
        this.topBar = bar;

        // ---- 顶栏内容 ----
        // 布局：左列（时间 / 金币·粮草·据点）+ 右列（兵力）+ 最右两个小按钮。
        // 加了粮草后左列一行放不下三个数，改成「上排：日期 / 兵力，
        // 下排：金币 / 粮草 / 据点」，三栏等宽，右端仍留出按钮位置。
        this.dateLabel = makeLabel('Date', '', {
            size: 24, color: new Color(240, 220, 170, 255), bold: true,
            align: HorizontalTextAlignment.LEFT, width: 250, height: 30,
        }, bar);
        setPos(this.dateLabel.node, -330, 22);

        this.goldLabel = makeLabel('Gold', '', {
            size: 20, color: new Color(245, 205, 90, 255),
            align: HorizontalTextAlignment.LEFT, width: 140, height: 26,
        }, bar);
        setPos(this.goldLabel.node, -330, -20);

        this.foodLabel = makeLabel('Food', '', {
            size: 20, color: new Color(198, 232, 150, 255),
            align: HorizontalTextAlignment.LEFT, width: 140, height: 26,
        }, bar);
        setPos(this.foodLabel.node, -160, -20);

        this.troopLabel = makeLabel('Troops', '', {
            size: 20, color: new Color(200, 220, 255, 255),
            align: HorizontalTextAlignment.LEFT, width: 210, height: 26,
        }, bar);
        setPos(this.troopLabel.node, -70, 22);

        this.provLabel = makeLabel('Prov', '', {
            size: 20, color: new Color(200, 255, 200, 255),
            align: HorizontalTextAlignment.LEFT, width: 150, height: 26,
        }, bar);
        setPos(this.provLabel.node, 0, -20);

        // （结束回合按钮在下面 buildHud 末尾创建，位置在面板上方）

        // ---- 静音 / 全图按钮 ----
        // 注意：这两个按钮是顶栏的子节点，顶栏高度只有 96（y 范围 -48~48）。
        // 原来「全图」放在 y=-52，会露到顶栏外面，看起来像浮在栏下的孤立方块。
        // 现在改成左二右三的紧凑排布，全部收在栏内。
        const muteBtn = makeRectStroke('MuteBtn', 52, 40, new Color(50, 44, 34, 230),
            new Color(170, 145, 95, 200), 2, bar);
        setPos(muteBtn, 292, 22);
        this.muteLabel = makeLabel('MuteTxt', '声', {
            size: 20, color: new Color(240, 225, 190, 255), bold: true,
        }, muteBtn);
        muteBtn.on(Node.EventType.TOUCH_END, this.onToggleMute, this);

        const resetBtn = makeRectStroke('ResetView', 52, 40, new Color(50, 44, 34, 230),
            new Color(170, 145, 95, 200), 2, bar);
        setPos(resetBtn, 292, -22);
        makeLabel('ResetTxt', '全图', {
            size: 18, color: new Color(240, 225, 190, 255), bold: true,
        }, resetBtn);
        resetBtn.on(Node.EventType.TOUCH_END, this.onResetView, this);

        // ---- 俘虏营入口 ----
        // 顶栏第三列（x=168）的下排，和「路网 / 全图」一行。
        // 文字固定两个字，不往 52px 按钮里塞数字；有俘虏时改用亮底金边表达。
        const prisonBtn = makeRectStroke('PrisonBtn', 52, 40,
            new Color(50, 44, 34, 230), new Color(170, 145, 95, 200), 2, bar);
        setPos(prisonBtn, 168, -22);
        this.prisonBtn = prisonBtn;
        this.prisonBtnLabel = makeLabel('PrisonTxt', '俘虏', {
            size: 18, color: new Color(240, 225, 190, 255), bold: true,
        }, prisonBtn);
        prisonBtn.on(Node.EventType.TOUCH_END, this.openPrisonMenu, this);

        // ---- 提示条 ----
        // 面板占据底部 300px，提示条移到面板上方，避免被盖住
        this.hintLabel = makeLabel('Hint', '', {
            size: 21, color: new Color(255, 235, 180, 255), bold: true,
            width: 520, height: 30,
        }, root);
        addWidget(this.hintLabel.node, { left: 24, bottom: 316 });

        // ---- 省份信息面板 ----
        this.buildPanel(root);

        // ---- 常驻「我方势力」身份牌 ----
        // 开局必须一眼看出自己执掌谁、哪片地盘是自己的。以前只有一条
        // 2 秒就消失的横幅，之后顶栏只剩日期 / 金币 / 兵力 / 据点，玩家
        // 面对 18 个势力色块根本对不上号。这块牌子常驻：色块 = 势力主色，
        // 文字点名势力与城数，和地图上的金环城池互相印证；点它可定位。
        const badge = makeRectStroke('FactionBadge', 300, 44,
            new Color(28, 24, 18, 235), new Color(210, 178, 108, 230), 2, root);
        addWidget(badge, { left: 16, top: 104 + this.topInset });
        badge.on(Node.EventType.TOUCH_END, this.onLocateOwn, this);

        const swatchNode = makeBox('FactionSwatch', 26, 26, badge);
        setPos(swatchNode, -126, 0);
        this.factionSwatch = swatchNode.addComponent(Graphics);

        this.factionLabel = makeLabel('FactionTxt', '', {
            size: 20, color: new Color(255, 238, 190, 255), bold: true,
            align: HorizontalTextAlignment.LEFT, width: 250, height: 36,
        }, badge);
        setPos(this.factionLabel.node, 25, 0);

        // ---- 战报 ----
        // 身份牌占掉了顶栏下方 44px，战报顺势下移，避免两块 UI 叠在一起。
        // 战报窗口加高到 5 行：AI 增强后一回合能写十几条，只显示 4 条时
        // 玩家丢城 / 被夹击 / 对手集结图谋这类要闻会被 AI 互殴日志冲掉。
        // 半透明底板：战报原本直接压在地图底色 / 城池标签上，几乎读不清。
        // 只加一层暗底，不改地图绘制，也不遮挡点击（底板同样不拦截事件）。
        this.logNode = makeRectStroke('LogBox', 340, 140,
            new Color(22, 19, 15, 190), new Color(120, 105, 78, 140), 1, root);
        addWidget(this.logNode, { left: 16, top: 156 + this.topInset });
        this.logLabel = makeLabel('LogTxt', '', {
            size: 16, color: new Color(230, 225, 210, 200), align: HorizontalTextAlignment.LEFT,
            width: 340, height: 140,
        }, this.logNode);
        // 顶部对齐 + 裁剪溢出行：即使日志很长，被截掉的也只会是末尾的普通日志，
        // 钉在顶部的要闻一定完整可见；也不会再自动增高溢出到地图上压住城池标签。
        this.logLabel.verticalAlign = Label.VerticalAlign.TOP;
        this.logLabel.overflow = Label.Overflow.CLAMP;
        this.logLabel.enableWrapText = true;

        // ---- 敌情预警 ----
        // 战报只在窗口里留最后几行，AI「自后方集结、图谋某城」很快会被冲走；
        // 但玩家真正需要的正是这一回合的提前量：看见预警才能调兵回防。
        // 紧贴战报下方单独开一条，只在有敌情时出现，不占平时地图视野。
        this.threatNode = makeRectStroke('ThreatBox', 340, 66,
            new Color(74, 30, 24, 238), new Color(236, 138, 92, 235), 2, root);
        addWidget(this.threatNode, { left: 16, top: 302 + this.topInset });
        this.threatNode.active = false;
        this.threatLabel = makeLabel('ThreatTxt', '', {
            size: 16, color: new Color(255, 214, 170, 255), bold: true,
            align: HorizontalTextAlignment.LEFT,
            width: 326, height: 60, lineHeight: 20,
        }, this.threatNode);
        this.threatLabel.verticalAlign = Label.VerticalAlign.TOP;
        this.threatLabel.overflow = Label.Overflow.CLAMP;
        this.threatLabel.enableWrapText = true;

        // ---- 任务式引导 / 阶段目标条 ----
        // 竖屏 720x1280：身份牌(104) → 战报(156) → 敌情(302) → 目标(374)，
        // 到 446 结束，离底部面板(980 起)还有整片地图，不遮挡任何操作。
        // 常驻而非弹窗：新玩家任何时刻都知道「下一步做什么」，老玩家
        // 则看到「立足 / 破局 / 问鼎」的进度，18~40 回合才赢也有阶段感。
        this.goalNode = makeRectStroke('GoalBox', 340, 72,
            new Color(30, 26, 18, 235), new Color(214, 180, 110, 230), 2, root);
        addWidget(this.goalNode, { left: 16, top: 374 + this.topInset });
        this.goalLabel = makeLabel('GoalTxt', '', {
            size: 17, color: new Color(255, 236, 190, 255), bold: true,
            align: HorizontalTextAlignment.LEFT, width: 326, height: 66, lineHeight: 24,
        }, this.goalNode);
        this.goalLabel.verticalAlign = Label.VerticalAlign.TOP;
        this.goalLabel.overflow = Label.Overflow.CLAMP;
        this.goalLabel.enableWrapText = true;

        // ---- 结束回合按钮 ----
        // 放在面板上方的右侧，与提示条同一带
        const btn = makeRectStroke('EndTurn', 150, 60, new Color(150, 60, 45, 255),
            new Color(230, 190, 110, 255), 3, root);
        addWidget(btn, { right: 20, bottom: 316 });
        this.endTurnBtn = btn;
        makeLabel('EndTurnTxt', '结束回合', { size: 25, color: new Color(255, 240, 210, 255), bold: true }, btn);
        btn.on(Node.EventType.TOUCH_END, this.onEndTurn, this);

        // ---- 顶栏「新局」按钮 ----
        // 统一天下之后玩家必须从某个入口重开，这里给一个常驻入口，
        // 平时想换剧本/换势力也能随时进来。
        const newBtn = makeRectStroke('NewGameBtn', 52, 40, new Color(50, 44, 34, 230),
            new Color(170, 145, 95, 200), 2, bar);
        setPos(newBtn, 230, 22);
        makeLabel('NewGameTxt', '新局', {
            size: 18, color: new Color(240, 225, 190, 255), bold: true,
        }, newBtn);
        newBtn.on(Node.EventType.TOUCH_END, () => this.openScenarioMenu(), this);

        // ---- 顶栏「路网」开关 ----
        // 顶栏右侧是 2x2 的小按钮区：新局(230,22) / 路网(230,-22) /
        // 静音(292,22) / 全图(292,-22)。路网默认常显，觉得挡视线时可临时关掉。
        const routeBtn = makeRectStroke('RouteBtn', 52, 40, new Color(50, 44, 34, 230),
            new Color(170, 145, 95, 200), 2, bar);
        setPos(routeBtn, 230, -22);
        this.routeToggleLabel = makeLabel('RouteTxt', '路网', {
            size: 18, color: new Color(240, 225, 190, 255), bold: true,
        }, routeBtn);
        routeBtn.on(Node.EventType.TOUCH_END, this.onToggleRoutes, this);

        // ---- 路网图例 ----
        // 放在提示条正上方，直接回答「哪条能打、哪条不能打」。
        // 所有路本来就常驻画在地图上，图例不是点击之后才出现的说明。
        const legend = makeBox('RouteLegend', 510, 28, root);
        // 自下而上：面板 0~300、提示条 316~346、结束回合按钮 316~376、
        // 图例 360~388（水平上不碰右侧按钮）。toast 再往上到 410。
        addWidget(legend, { left: 24, bottom: 360 });
        // 图例直接回答玩家最关心的问题：哪条能打、哪条不能打。
        const legendItems: Array<[string, number, Color]> = [
            ['▲ 能进攻', -172, new Color(255, 166, 92, 255)],
            ['● 只能调兵', 0, new Color(156, 228, 166, 245)],
            ['● 现在打不了', 170, new Color(238, 226, 198, 235)],
        ];
        for (const [text, x, color] of legendItems) {
            const lb = makeLabel(`Legend_${x}`, text, {
                size: 17, color, bold: true, width: 160, height: 26,
                align: HorizontalTextAlignment.LEFT,
            }, legend);
            setPos(lb.node, x, 0);
        }

        // 模态层最后创建，保证盖在地图与 HUD 之上
        this.buildMenu(root);
    }

    /** 顶栏「路网」开关 */
    private onToggleRoutes(): void {
        this.routesVisible = !this.routesVisible;
        this.mapRenderer.setRoutesVisible(this.routesVisible);
        this.routeToggleLabel.string = this.routesVisible ? '路网' : '隐路';
        this.routeToggleLabel.color = this.routesVisible
            ? new Color(240, 225, 190, 255)
            : new Color(130, 125, 115, 255);
        this.audio.play('click');
        this.toast(this.routesVisible
            ? '路网常显：橙红=能打，绿/浅色=不能打'
            : '路网已隐藏，再点「隐路」可恢复');
    }

    /**
     * 点「我方势力」身份牌：把视野平移到己方前线城并选中它。
     * 只居中、不改变缩放，全图路网依旧一眼看全；想回全图点顶栏「全图」。
     */
    private onLocateOwn(): void {
        const target = this.pickFrontlineProvince();
        if (!target) {
            this.toast('已无我方城池');
            return;
        }
        this.selectProvince(target);
        this.mapInput.focusOn(target);
        // focusOn 只做 centerOn，没有 clamp；修正一次避免地图边缘露白
        this.mapInput.reclampView();
        this.audio.play('click');
        this.toast(`已定位我方 ${target.name} · 带金环的城都是你的地盘`);
    }

    /**
     * 剧本选择 / 胜负结算的模态层（纯代码构建，默认隐藏）
     *
     * 遮罩本身不监听点击，因此弹窗打开时地图收不到触摸，不会被误操作；
     * 关闭一律走面板里的按钮，避免误触把弹窗关掉。
     */
    private buildMenu(root: Node): void {
        const mask = makeRect('MenuMask', 720, 1280, new Color(10, 8, 6, 205), root);
        addWidget(mask, { hCenter: 0, vCenter: 0 });
        mask.active = false;
        this.menuLayer = mask;

        // ---------------- 剧本选择 ----------------
        const sp = makeRectStroke('ScenarioPanel', 640, 820,
            new Color(30, 25, 18, 252), new Color(190, 160, 100, 230), 2, mask);
        addWidget(sp, { hCenter: 0, vCenter: 0 });
        this.scenarioPanel = sp;

        const title = makeLabel('MenuTitle', '新开一局 · 选择剧本', {
            size: 30, color: new Color(255, 230, 170, 255), bold: true,
        }, sp);
        setPos(title.node, 0, 370);
        this.menuSub = makeLabel('MenuSub', '', {
            size: 17, color: new Color(200, 190, 170, 255),
        }, sp);
        setPos(this.menuSub.node, 0, 332);

        // 翻页按钮：剧本以后会越来越多，卡片复用 + 分页就不用改布局
        this.prevPageBtn = makeRectStroke('MenuPrevBtn', 38, 34,
            new Color(60, 50, 38, 255), new Color(150, 125, 80, 220), 2, sp);
        setPos(this.prevPageBtn, 250, 332);
        makeLabel('MenuPrevTxt', '<', {
            size: 20, color: new Color(240, 225, 190, 255), bold: true,
        }, this.prevPageBtn);
        this.prevPageBtn.on(Node.EventType.TOUCH_END, () => this.onMenuPage(-1), this);
        this.nextPageBtn = makeRectStroke('MenuNextBtn', 38, 34,
            new Color(60, 50, 38, 255), new Color(150, 125, 80, 220), 2, sp);
        setPos(this.nextPageBtn, 296, 332);
        makeLabel('MenuNextTxt', '>', {
            size: 20, color: new Color(240, 225, 190, 255), bold: true,
        }, this.nextPageBtn);
        this.nextPageBtn.on(Node.EventType.TOUCH_END, () => this.onMenuPage(1), this);

        // 固定 3 张卡片，内容由 refreshScenarioMenu 按当前页填充
        for (let i = 0; i < GameController.CARDS_PER_PAGE; i++) {
            const card = makeRectStroke(`ScenarioCard_${i}`, 600, 108,
                new Color(48, 40, 30, 255), new Color(150, 125, 80, 220), 2, sp);
            setPos(card, 0, 250 - i * 125);
            const nameLb = makeLabel(`CardName_${i}`, '', {
                size: 24, color: new Color(220, 210, 190, 255), bold: true,
                align: HorizontalTextAlignment.LEFT, width: 560, height: 32,
            }, card);
            setPos(nameLb.node, 0, 30);
            const eraLb = makeLabel(`CardEra_${i}`, '', {
                size: 16, color: new Color(190, 175, 145, 255),
                align: HorizontalTextAlignment.LEFT, width: 560, height: 26,
            }, card);
            setPos(eraLb.node, 0, 0);
            const descLb = makeLabel(`CardDesc_${i}`, '', {
                size: 16, color: new Color(215, 205, 185, 255),
                align: HorizontalTextAlignment.LEFT, width: 560, height: 26,
            }, card);
            setPos(descLb.node, 0, -28);
            this.cardNodes.push(card);
            this.cardLabels.push(nameLb);
            this.cardEraLabels.push(eraLb);
            this.cardDescLabels.push(descLb);
            card.on(Node.EventType.TOUCH_END, () => this.onPickScenarioAt(i), this);
        }

        const fHint = makeLabel('FactionHint', '执掌势力', {
            size: 18, color: new Color(230, 215, 180, 255), bold: true,
        }, sp);
        setPos(fHint.node, 0, -92);

        const fw = 138;
        const gap = 10;
        const totalW = fw * 4 + gap * 3;
        for (let i = 0; i < 4; i++) {
            const b = makeRectStroke(`FactionBtn_${i}`, fw, 48,
                new Color(60, 50, 38, 255), new Color(150, 125, 80, 220), 2, sp);
            setPos(b, -totalW / 2 + fw / 2 + i * (fw + gap), -146);
            const lb = makeLabel(`FactionTxt_${i}`, '', {
                size: 19, color: new Color(220, 210, 190, 255), bold: true,
            }, b);
            this.factionNodes.push(b);
            this.factionLabels.push(lb);
            b.on(Node.EventType.TOUCH_END, () => this.onPickFaction(i), this);
        }

        this.menuInfo = makeLabel('MenuInfo', '', {
            size: 16, color: new Color(215, 200, 170, 255),
            align: HorizontalTextAlignment.LEFT, width: 580, height: 66, lineHeight: 26,
        }, sp);
        setPos(this.menuInfo.node, 0, -220);

        const startBtn = makeRectStroke('StartNewGameBtn', 220, 60,
            new Color(150, 60, 45, 255), new Color(230, 190, 110, 255), 3, sp);
        setPos(startBtn, -120, -296);
        makeLabel('StartNewGameTxt', '开始新局', {
            size: 25, color: new Color(255, 240, 210, 255), bold: true,
        }, startBtn);
        startBtn.on(Node.EventType.TOUCH_END,
            () => this.startNewGame(this.pickScenarioId, this.pickFactionId), this);

        const backBtn = makeRectStroke('MenuBackBtn', 160, 60,
            new Color(70, 58, 42, 255), new Color(190, 160, 100, 220), 2, sp);
        setPos(backBtn, 120, -296);
        makeLabel('MenuBackTxt', '返回', {
            size: 24, color: new Color(240, 225, 190, 255), bold: true,
        }, backBtn);
        backBtn.on(Node.EventType.TOUCH_END, () => {
            // 从结算面板切过来时，「返回」应回到结算而不是直接关掉
            if (this.gameOverShown) {
                this.showResult(this.state.isVictory());
            } else {
                this.hideMenu();
            }
        }, this);

        const footer = makeLabel('MenuFooter', '剧本配置在 data/Scenarios.ts，新增一项即多一个剧本', {
            size: 14, color: new Color(160, 150, 130, 255),
        }, sp);
        setPos(footer.node, 0, -366);

        // ---------------- 胜负结算 ----------------
        // 面板加高是为了放下「本局战绩 + 评价 + 档案摘要 + 分享语」；
        // 四个按钮改 2x2，新增「分享战绩」不挤掉任何原有入口。
        const rp = makeRectStroke('ResultPanel', 660, 660,
            new Color(30, 25, 18, 252), new Color(210, 175, 105, 235), 3, mask);
        addWidget(rp, { hCenter: 0, vCenter: 0 });
        rp.active = false;
        this.resultPanel = rp;

        this.resultTitle = makeLabel('ResultTitle', '', {
            size: 38, color: new Color(255, 225, 145, 255), bold: true,
        }, rp);
        setPos(this.resultTitle.node, 0, 270);

        this.resultBody = makeLabel('ResultBody', '', {
            size: 18, color: new Color(235, 225, 205, 255),
            align: HorizontalTextAlignment.LEFT, width: 580, height: 320, lineHeight: 27,
        }, rp);
        setPos(this.resultBody.node, 0, 100);
        this.resultBody.verticalAlign = Label.VerticalAlign.TOP;
        this.resultBody.overflow = Label.Overflow.CLAMP;
        this.resultBody.enableWrapText = true;

        // 上排：再开一局 / 分享战绩
        const againBtn = makeRectStroke('ResultAgainBtn', 300, 56,
            new Color(150, 60, 45, 255), new Color(230, 190, 110, 255), 3, rp);
        setPos(againBtn, -160, -140);
        makeLabel('ResultAgainTxt', '再开一局', {
            size: 24, color: new Color(255, 240, 210, 255), bold: true,
        }, againBtn);
        againBtn.on(Node.EventType.TOUCH_END, () => this.startNewGame(), this);

        const shareBtn = makeRectStroke('ResultShareBtn', 300, 56,
            new Color(58, 92, 76, 255), new Color(150, 220, 170, 245), 2, rp);
        setPos(shareBtn, 160, -140);
        makeLabel('ResultShareTxt', '分享战绩', {
            size: 24, color: new Color(220, 250, 225, 255), bold: true,
        }, shareBtn);
        shareBtn.on(Node.EventType.TOUCH_END, () => this.onShareResult(), this);

        // 下排：换个剧本 / 继续看看
        const changeBtn = makeRectStroke('ResultChangeBtn', 300, 56,
            new Color(70, 58, 42, 255), new Color(190, 160, 100, 220), 2, rp);
        setPos(changeBtn, -160, -220);
        makeLabel('ResultChangeTxt', '换个剧本', {
            size: 24, color: new Color(240, 225, 190, 255), bold: true,
        }, changeBtn);
        changeBtn.on(Node.EventType.TOUCH_END, () => this.openScenarioMenu(), this);

        const stayBtn = makeRectStroke('ResultStayBtn', 300, 56,
            new Color(50, 44, 34, 255), new Color(150, 125, 80, 220), 2, rp);
        setPos(stayBtn, 160, -220);
        makeLabel('ResultStayTxt', '继续看看', {
            size: 24, color: new Color(210, 200, 180, 255), bold: true,
        }, stayBtn);
        stayBtn.on(Node.EventType.TOUCH_END, () => this.hideMenu(), this);

        // ---------------- 俘虏营 ----------------
        // 第三个共用遮罩的弹窗：攻破敌城生擒的守将在这里二选一处置。
        // 一页 4 行、卡片复用（和剧本卡片同一套路），不按人数动态造节点。
        const pp = makeRectStroke('PrisonPanel', 640, 780,
            new Color(30, 25, 18, 252), new Color(190, 160, 100, 230), 2, mask);
        addWidget(pp, { hCenter: 0, vCenter: 0 });
        pp.active = false;
        this.prisonPanel = pp;

        const pTitle = makeLabel('PrisonTitle', '俘虏营 · 招降 / 放归', {
            size: 32, color: new Color(255, 230, 170, 255), bold: true,
        }, pp);
        setPos(pTitle.node, 0, 342);

        // 规则写在脸上：成功率、放归降忠诚、招降失败反升，全部是公开数值
        this.prisonInfo = makeLabel('PrisonInfo', '', {
            size: 17, color: new Color(215, 200, 170, 255),
            align: HorizontalTextAlignment.LEFT, width: 580, height: 84, lineHeight: 26,
        }, pp);
        setPos(this.prisonInfo.node, 0, 280);

        for (let i = 0; i < GameController.PRISON_PER_PAGE; i++) {
            const row = makeRectStroke(`PrisonRow_${i}`, 600, 96,
                new Color(48, 40, 30, 255), new Color(150, 125, 80, 220), 2, pp);
            // 从 183 起排：给上方三行规则说明留出 12px 安全间距，别贴着卡片边框
            setPos(row, 0, 183 - i * 108);
            const info = makeLabel(`PrisonRowInfo_${i}`, '', {
                size: 19, color: new Color(235, 230, 215, 255),
                align: HorizontalTextAlignment.LEFT, width: 380, height: 68, lineHeight: 30,
            }, row);
            setPos(info.node, -100, 0);

            const recruit = makeRectStroke(`PrisonRecruit_${i}`, 96, 44,
                new Color(110, 76, 34, 255), new Color(230, 190, 110, 255), 2, row);
            setPos(recruit, 150, 0);
            const recruitLabel = makeLabel(`PrisonRecruitTxt_${i}`, '招降', {
                size: 20, color: new Color(255, 240, 210, 255), bold: true,
            }, recruit);
            recruit.on(Node.EventType.TOUCH_END, () => this.onPrisonRecruit(i), this);

            const release = makeRectStroke(`PrisonRelease_${i}`, 96, 44,
                new Color(70, 58, 42, 255), new Color(190, 160, 100, 220), 2, row);
            setPos(release, 252, 0);
            const releaseLabel = makeLabel(`PrisonReleaseTxt_${i}`, '放归', {
                size: 20, color: new Color(240, 225, 190, 255), bold: true,
            }, release);
            release.on(Node.EventType.TOUCH_END, () => this.onPrisonRelease(i), this);

            this.prisonRows.push({
                node: row, info, recruit, release, recruitLabel, releaseLabel,
            });
        }

        this.prisonCount = makeLabel('PrisonCount', '', {
            size: 19, color: new Color(255, 230, 170, 255), bold: true,
        }, pp);
        setPos(this.prisonCount.node, 0, -215);

        this.prisonPrevBtn = makeRectStroke('PrisonPrevBtn', 100, 40,
            new Color(60, 50, 38, 255), new Color(150, 125, 80, 220), 2, pp);
        setPos(this.prisonPrevBtn, -70, -265);
        makeLabel('PrisonPrevTxt', '< 上页', {
            size: 18, color: new Color(240, 225, 190, 255), bold: true,
        }, this.prisonPrevBtn);
        this.prisonPrevBtn.on(Node.EventType.TOUCH_END, () => this.onPrisonPage(-1), this);

        this.prisonNextBtn = makeRectStroke('PrisonNextBtn', 100, 40,
            new Color(60, 50, 38, 255), new Color(150, 125, 80, 220), 2, pp);
        setPos(this.prisonNextBtn, 70, -265);
        makeLabel('PrisonNextTxt', '下页 >', {
            size: 18, color: new Color(240, 225, 190, 255), bold: true,
        }, this.prisonNextBtn);
        this.prisonNextBtn.on(Node.EventType.TOUCH_END, () => this.onPrisonPage(1), this);

        const closeBtn = makeRectStroke('PrisonCloseBtn', 220, 56,
            new Color(70, 58, 42, 255), new Color(190, 160, 100, 220), 2, pp);
        setPos(closeBtn, 0, -335);
        makeLabel('PrisonCloseTxt', '返回战场', {
            size: 23, color: new Color(240, 225, 190, 255), bold: true,
        }, closeBtn);
        closeBtn.on(Node.EventType.TOUCH_END, () => {
            // 从结算面板切过来时，「返回战场」应回到结算，别把重开入口弄丢
            if (this.gameOverShown) {
                this.showResult(this.state.isVictory());
            } else {
                this.hideMenu();
            }
        }, this);
    }

    private buildPanel(root: Node): void {
        // 面板改为**底部抽屉式**，横跨屏幕下方。
        //
        // 为什么不再用右上角浮窗：
        //   原来 360x420 的面板贴在右上，正好盖住中原（洛阳/许昌/谯一带），
        //   那是玩家开局最常看的区域，遮住就没法操作了。
        //   放在底部则只占用边缘空间，地图主体完整可见。
        const PANEL_W = 720;
        // 240 → 300：内政四键 + 军事两键要分两行摆，正文也多了一行
        // 「发展度 / 月粮 / 月募兵」。加高的是面板，地图可视区域不变
        // （面板本来就是盖在最底部的抽屉）。
        const PANEL_H = 300;
        const panel = makeRectStroke('Panel', PANEL_W, PANEL_H, new Color(28, 24, 18, 248),
            new Color(190, 160, 100, 220), 2, root);
        addWidget(panel, { hCenter: 0, bottom: 0 });
        this.panel = panel;
        panel.active = false;

        this.panelAccent = panel.getComponent(Graphics)!;

        this.panelTitle = makeLabel('PanelTitle', '', {
            size: 26, color: new Color(255, 230, 170, 255), bold: true,
            align: HorizontalTextAlignment.LEFT, width: 660,
        }, panel);
        addWidget(this.panelTitle.node, { top: 10, left: 18 });

        // 正文：两栏布局，左边数值、右边可攻/可调兵/内政状态
        // 6 行 × lineHeight 22 = 132，正好落在按钮行上方（186 起），不压按钮
        this.panelBody = makeLabel('PanelBody', '', {
            size: 19, color: new Color(235, 230, 215, 255), align: HorizontalTextAlignment.LEFT,
            width: 680, height: 132, lineHeight: 22,
        }, panel);
        addWidget(this.panelBody.node, { top: 46, left: 18 });

        // ---- 操作按钮：两行 ----
        // 上排是内政（每城每回合四选一），下排是军事（不占内政行动点）。
        // 原来只有一行四键，征兵和内政挤在一起，玩家分不清「哪些是花行动点的」。
        //
        // 内政只留这一套按钮：之前还在标题行摆过第二套一模一样的
        // 「治理/屯田/筑城/征兵」当方针开关，两排同样的词并排，玩家根本
        // 分不清哪个是给当前城下令、哪个是设方针。现在改用左边一个
        // 「自动」开关 + 自动执行的那道指令亮金边来表达，词只出现一次。
        this.autoBtn = makeRectStroke('AutoDomestic', 66, 50,
            new Color(52, 46, 36, 235), new Color(120, 105, 78, 200), 2, panel);
        addWidget(this.autoBtn, { left: 142, bottom: 64 });
        this.autoLabel = makeLabel('AutoTxt', '自动', {
            size: 18, color: new Color(150, 140, 122, 255), bold: true,
        }, this.autoBtn);
        this.autoBtn.on(Node.EventType.TOUCH_END, this.onToggleAuto, this);

        this.governBtn = this.makeActionButton(panel, '治理', 0, 0, this.onGovern);
        this.farmBtn = this.makeActionButton(panel, '屯田', 1, 0, this.onFarm);
        this.fortifyBtn = this.makeActionButton(panel, '筑城', 2, 0, this.onFortify);
        this.recruitBtn = this.makeActionButton(panel, '征兵', 3, 0, this.onRecruit);

        this.attackBtn = this.makeActionButton(panel, '进攻', 0, 1, this.onAttackMode);
        this.moveBtn = this.makeActionButton(panel, '调兵', 1, 1, this.onMoveMode);

        // ---- 取消按钮 ----
        this.cancelBtn = this.makeActionButton(panel, '取消', 2, 1, this.onCancelMode);
        this.cancelBtn.active = false;

        this.refreshAutoButton();
        this.refreshDomesticButtons();
    }

    /**
     * 面板底部的操作按钮
     *
     * 用 Widget 固定到面板底部（bottom:），不再写死 y 坐标，
     * 避免以后调面板高度时按钮压到正文文字。
     *
     * @param row 0 = 内政行（上），1 = 军事行（下）
     * @param col 0..3 从左到右
     */
    private makeActionButton(
        parent: Node,
        text: string,
        col: number,
        row: number,
        cb: () => void,
    ): Node {
        const w = 112;
        const gap = 10;
        const total = w * 4 + gap * 3;
        // 按钮组靠右排列，左侧留出正文空间
        const left = 720 - 18 - total + col * (w + gap);
        const bottom = row === 0 ? 64 : 8;
        const btn = makeRectStroke(`Btn_${text}`, w, 50,
            new Color(70, 58, 42, 255), new Color(190, 160, 100, 220), 2, parent);
        addWidget(btn, { left, bottom });
        makeLabel(`BtnTxt_${text}`, text, {
            size: 22, color: new Color(250, 235, 200, 255), bold: true,
        }, btn);
        btn.on(Node.EventType.TOUCH_END, cb, this);
        return btn;
    }

    // ==================================================================
    // 交互
    // ==================================================================

    /**
     * 按显示宽度补空格，用于面板的两栏对齐
     *
     * 以前按「中文算 2 个宽度、英文算 1 个」补空格，但空格本身只有
     * 0.28 个字号宽，而中文有 1 个字号宽——换算下来中文行永远补不够，
     * 右栏每行起点都不一样（「守将」那行最长，被推得最远，看起来像没对齐）。
     * 这里直接按像素估宽再换算成空格数。
     *
     * @param targetPx 右栏相对文字左边的目标起点（像素）
     * @param fontSize 正文字号，用于估算字宽
     */
    private padTo(text: string, targetPx: number, fontSize = 19): string {
        const spaceW = fontSize * 0.28;
        let w = 0;
        for (const ch of text) {
            if (ch === '　') {
                w += fontSize;
            } else if (/[\u4e00-\u9fa5]/.test(ch)) {
                w += fontSize;
            } else {
                w += fontSize * 0.55;
            }
        }
        const pad = Math.max(1, Math.round((targetPx - w) / spaceW));
        return ' '.repeat(pad);
    }

    private onPickHex(p: ProvinceState | null): void {
        if (!p) {
            this.doDeselect();
            return;
        }

        // 演出进行中：明确告知玩家正在播放，而不是静默忽略
        if (this.showcase.busy) {
            this.toast('战斗演出进行中…');
            return;
        }

        // ---- 攻击/移动模式优先 ----
        // ⚠ 顺序很重要：这里必须先处理攻击，再考虑双击。
        // 之前双击检测放在前面，导致「进入攻击模式后快速点目标」被误判为双击，
        // 玩家看到的现象就是「有反应但打不了」。
        if (this.selected && this.mode !== 'select') {
            // 点自己：不要静默重置模式，否则玩家以为模式还在、结果点了没反应
            if (p.id === this.selected.id) {
                this.toast(this.mode === 'attack'
                    ? '请点击红色高亮的敌城'
                    : '请点击绿色高亮的己方城池');
                return;
            }
            if (this.mode === 'attack') {
                // 不能打的时候必须说清楚为什么，否则玩家以为是卡了
                const verdict = this.state.canAttack(this.selected, p);
                if (verdict.ok) {
                    this.doAttack(this.selected, p);
                } else {
                    this.toast(verdict.reason);
                }
                return;
            }
            if (this.mode === 'move') {
                if (this.state.isAdjacent(this.selected, p) && p.owner === this.selected.owner) {
                    this.doMove(this.selected, p);
                } else {
                    this.toast('调兵只能选相邻的己方城池');
                }
                return;
            }
        }

        // ---- 双击同一座城 = 放大聚焦（仅在非攻击/移动模式下生效）----
        const now = Date.now();
        if (this.lastTapId === p.id && now - this.lastTapTime < 350) {
            this.mapInput.zoomInOn(p);
            this.toast(`已聚焦 ${p.name}`);
            this.lastTapTime = 0;
            this.lastTapId = null;
            return;
        }
        this.lastTapId = p.id;
        this.lastTapTime = now;

        // 引导 ①：玩家真的点了一座城才算完成，onLoad 里自动选中的不算
        this.advanceTutorial(0);
        this.selectProvince(p);
    }

    /**
     * 把当前选中城 / 模式同步给路网层。
     *
     * 选中时只点亮与这座城相连的路，其余淡化；进入进攻/调兵模式后
     * 只保留合法目标方向，玩家不用读面板就能看出「这条路能不能打」。
     * 路网层是独立 Graphics，重画它不必重绘整张地形。
     */
    private syncRouteFocus(): void {
        const sel = this.selected;
        const targetIds: string[] = [];
        if (sel) {
            if (this.mode === 'attack') {
                for (const p of this.state.attackTargets(sel)) {
                    targetIds.push(p.id);
                }
            } else if (this.mode === 'move') {
                for (const p of this.state.moveTargets(sel)) {
                    targetIds.push(p.id);
                }
            } else {
                // 普通选中：把可攻 + 可调兵的邻城都点亮，展示这座城的全部通路
                for (const p of this.state.attackTargets(sel)) {
                    targetIds.push(p.id);
                }
                for (const p of this.state.moveTargets(sel)) {
                    targetIds.push(p.id);
                }
            }
        }
        this.mapRenderer.setRouteFocus(sel ? sel.id : null, targetIds);
    }

    private doDeselect(): void {
        this.selected = null;
        this.mode = 'select';
        this.panel.active = false;
        this.mapRenderer.clearHighlights();
        if (this.cancelBtn) {
            this.cancelBtn.active = false;
        }
        this.refreshHud();
        this.syncRouteFocus();
    }

    private selectProvince(p: ProvinceState | null): void {
        this.selected = p;
        this.mode = 'select';
        this.mapRenderer.clearHighlights();
        if (this.cancelBtn) {
            this.cancelBtn.active = false;
        }
        if (!p) {
            this.panel.active = false;
            this.refreshHud();
            this.syncRouteFocus();
            return;
        }
        this.panel.active = true;
        // 只有自己的城池才能内政 / 征兵 / 调兵 / 进攻
        const mine = p.owner === this.state.playerFaction;
        for (const b of this.ownActionButtons()) {
            if (b) {
                b.active = mine;
            }
        }
        this.showPanel(p);
        this.refreshHud();
        this.syncRouteFocus();
    }

    /**
     * 将领身份短标：君 / 旧 / 武 / 文。
     * 右栏一行只有 330px，写全「武将」「文官」会把两栏挤歪，
     * 所以这里取身份名首字；俘虏营里用完整的 ROLE_NAME。
     * 「旧」= 已归降的旧主：他不再是君主，但也不是普通降将，标出来免得
     * 玩家以为自己的君主换人了。
     */
    private generalMark(g: GeneralState): string {
        if (g.def.ruler) {
            return this.state.isReigning(g) ? '君' : '旧';
        }
        return ROLE_NAME[g.def.role].charAt(0);
    }

    /**
     * 战前胜算的单字短标：挂在可攻目标名后面，右栏宽度有限，
     * 完整档位（胜算高 / 偏优 / 偏险 / 慎攻）只在敌方城主攻方向上写全。
     */
    private previewTag(from: ProvinceState, to: ProvinceState): string {
        const pv = this.state.previewAttack(from, to);
        switch (pv.label) {
            case '胜算高': return '高';
            case '胜算偏优': return '优';
            case '胜算偏险': return '险';
            default: return '慎';
        }
    }

    /** 君主加成的显示文本：按 BONUS_KIND 的顺序拼，UI 不各写一套 if */
    private bonusText(b: RulerBonus): string {        const parts: string[] = [];
        for (const k of BONUS_KIND) {
            const v = b[k.key];
            if (v) {
                parts.push(`${k.name}+${Math.round(v * 100)}%`);
            }
        }
        return parts.join(' ');
    }

    /**
     * 君主一行：**只看这座城**。
     *
     * 加成只作用于君主驻守的那座城，所以这里报的是「本城君主 + 他的加成」，
     * 而不是势力君主 —— 玩家把君主调到哪、哪座城才吃到加成，这是一步
     * 可以操作的决策，UI 必须让它看得见。君主不在这座城时改报他此刻在哪，
     * 玩家才知道该往哪调（这也是「招来的旧主该安置到哪」的决策依据）。
     *
     * 忠诚不在这里重复：loyaltyLine() 已经列出守将忠诚，含君主本人。
     */
    private rulerLine(p: ProvinceState): string {
        const rulers = this.state.generalsAt(p).filter((g) => !!g.def.bonus);
        if (rulers.length > 0) {
            const head = rulers[0];
            const title = head.def.bonus ? head.def.bonus.title : '';
            // 加成按「本城**实际生效**的值」逐项拼，不是照抄某位君主的配置：
            // 同城多位君主时 rulerBonusAt 是按项取最高，照抄一位就会显示错。
            const parts: string[] = [];
            for (const k of BONUS_KIND) {
                const v = this.state.rulerBonusAt(p, k.key);
                if (v) {
                    parts.push(`${k.name}+${Math.round(v * 100)}%`);
                }
            }
            return `君威 ${head.def.name}·${title} ${parts.join(' ')}`;
        }
        const ruler = this.state.rulerStateOf(p.owner);
        if (!ruler) {
            return '君主 —（此势力无君主）';
        }
        if (ruler.captiveOf !== '') {
            return `君主 ${ruler.def.name}（被俘）`;
        }
        const where = this.state.cityOfGeneral(ruler.def.id);
        return where
            ? `君主 ${ruler.def.name}（在 ${where.name}）`
            : `君主 ${ruler.def.name}（无城）`;
    }

    /** 守将忠诚：最多列 2 位，其余写「等 N 人」，避免撑破右栏 */
    private loyaltyLine(p: ProvinceState): string {
        const gen = this.state.generalsAt(p);
        if (gen.length === 0) {
            return '忠诚 —（无守将）';
        }
        const shown = gen.slice(0, 2)
            .map((g) => `${this.generalMark(g)}${g.def.name}${g.loyalty}`).join('、');
        return `忠诚 ${shown}${gen.length > 2 ? ` 等${gen.length}人` : ''}`;
    }

    private showPanel(p: ProvinceState): void {
        const f = FACTION_MAP[p.owner];
        const gen = this.state.generalsAt(p);
        // 最多列 3 位：守将一栏太长会把右栏挤出去（两栏是靠补空格对齐的）
        const genText = gen.length > 0
            ? gen.slice(0, 3).map((g) => `${g.def.name}(${g.level})`).join('、')
            : '无';

        // 被图谋的城在标题行也标一下：玩家点开面板看数值时不会漏掉敌情，
        // 对策（可调兵的相邻城）就在下面右栏。
        const threatened = p.owner === this.state.playerFaction
            && this.state.threats.has(p.id);
        this.panelTitle.string = `${p.name}${p.def.city ? ' ★' : ''}　`
            + `归属：${f ? f.name : '中立'}`
            + (threatened ? '　! 敌军图谋此城' : '');

        // 两栏布局：左栏数值、右栏战术提示。面板是横向宽条，单列太浪费。
        const mine = p.owner === this.state.playerFaction;
        // 发展度放在左栏第三行：这是整套玩法的核心数字。
        // 玩家看一座敌城，第一眼要能判断「值不值得打」（发展度高的城抢来就富），
        // 看自己的城要能判断「要不要花这一回合治理」。
        const left = [
            `兵力 ${p.troops} / ${this.state.garrisonCap(p)}`,
            `人口 ${Math.round(p.pop)}　工事 ${p.fort}`,
            `发展度 ${p.dev} / ${Balance.devMax}`,
            `月收 ${this.state.provinceIncome(p)} 金 · 粮 ${this.state.foodIncome(p)}`,
            `月募兵 +${this.state.autoReinforce(p)} / 回合`,
            `守将 ${genText}`,
        ];

        let right: string[] = [];
        if (mine) {
            // 自动方针是**全局**状态，却会被「手动点一次内政键」改掉。
            // 每次开面板都把它写出来，玩家才不会莫名其妙发现自己
            // 救急征了一次兵、之后每回合全境都在征兵。
            right.push(this.state.autoDomestic
                ? `自动：${POLICY_NAME[this.state.lastOrder]} · 点内政键换`
                : '自动：关（逐城下令）');
            // 回合内只是「选」，数值还没动。必须把这座城**将要执行**的指令
            // 写出来，并点明执行时点，否则玩家点了按钮没看到变化会以为卡了。
            const effective = this.state.effectiveOrder(p);
            if (p.pendingDomestic !== 'none') {
                right.push(`待执行：${POLICY_NAME[p.pendingDomestic]}（结束回合结算）`);
            } else if (effective !== 'none') {
                right.push(`待执行：自动${POLICY_NAME[effective]}（结束回合结算）`);
            } else {
                right.push('内政：未选择（点四选一，结束回合执行）');
            }
            const targets = this.state.attackTargets(p);
            if (p.troops <= 0) {
                right.push('⚠ 无兵力，请先「征兵」');
            } else if (targets.length === 0) {
                right.push('⚠ 四周无敌军，暂时无法扩张');
            } else {
                // 每个可攻目标挂上战前胜算档位：玩家点进攻前就能看出哪座好打，
                // 不用先摸上去打一仗才知道打不动。预估只是参考，实战仍有浮动。
                const names = targets.map((t) => `${t.name}·${this.previewTag(p, t)}`).join('、');
                // 出征过的城要说清楚：不然玩家会以为「点进攻没反应」。
                // 一座城一回合只能打一次，这是节奏的来源，必须可见。
                right.push(p.attacked
                    ? `可攻 ${names}（本回合已出征）`
                    : `可攻：${names}`);
            }
            const allies = this.state.moveTargets(p);
            if (allies.length > 0) {
                right.push(`可调兵：${allies.map((t) => t.name).join('、')}`);
            }
            // 君主与守将忠诚常驻：放归降的忠诚会落到对面城上，
            // 玩家要能在这里看见「下次更好招」确实发生了。
            right.push(this.rulerLine(p));
            right.push(this.loyaltyLine(p));
        } else {
            const myNeighbors = this.state.provincesOf(this.state.playerFaction)
                .filter((q) => this.state.isAdjacent(q, p));
            if (myNeighbors.length === 0) {
                right.push('（我方与他并不接壤）');
            } else {
                // 取胜算最高的邻城作为主攻方向，档位写在后面；其余邻城只列名字
                let best = myNeighbors[0];
                let bestPv = this.state.previewAttack(best, p);
                for (const q of myNeighbors.slice(1)) {
                    const pv = this.state.previewAttack(q, p);
                    if (pv.winRate > bestPv.winRate) {
                        best = q;
                        bestPv = pv;
                    }
                }
                right.push(`可从：${myNeighbors.map((q) => q.name).join('、')} 进攻`
                    + `（${best.name} ${bestPv.label}）`);
            }
            // 打之前先看清楚守将忠不忠：忠诚低的城，打下来更容易收人
            right.push(this.rulerLine(p));
            right.push(this.loyaltyLine(p));
        }

        // 用制表符对齐两栏（Label 不支持分栏，用等宽间距近似）
        const rows = Math.max(left.length, right.length);
        const lines: string[] = [];
        for (let i = 0; i < rows; i++) {
            const l = left[i] === undefined ? '' : left[i];
            const r = right[i] === undefined ? '' : right[i];
            lines.push(`${l}${this.padTo(l, 350, 19)}${r}`);
        }
        this.panelBody.string = lines.join('\n');

        // 选择是可以改的，不再把内政键变暗（旧版「已下令」才变暗，
        // 现在那是结算时的事）。亮金边直接告诉玩家「这座城选了哪一道」。
        this.refreshDomesticButtons();
    }

    /** 重画「自动」开关：开 = 亮底金边 + 亮字，关 = 暗底灰字 */
    private refreshAutoButton(): void {
        if (!this.autoBtn || !this.autoBtn.isValid) {
            return;
        }
        const on = this.state.autoDomestic;
        const g = this.autoBtn.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = on ? new Color(146, 106, 38, 255) : new Color(52, 46, 36, 235);
            g.strokeColor = on ? new Color(255, 226, 138, 255) : new Color(120, 105, 78, 200);
            g.lineWidth = on ? 2 : 1;
            g.rect(-33, -25, 66, 50);
            g.fill();
            g.stroke();
        }
        // 文案不塞勾选符号：系统字体不一定有这个字形，会渲染成豆腐块
        // （预览图里就翻车过）。开关态靠亮底 + 金边 + 亮字表达，
        // 面板右栏同时写明「自动治理 / 自动屯田…」。
        this.autoLabel.string = '自动';
        this.autoLabel.color = on
            ? new Color(255, 240, 200, 255)
            : new Color(150, 140, 122, 255);
    }

    /**
     * 把「这座城本回合将执行的那道指令」标出来（亮底 + 金边）
     *
     * 这就是原来第二套方针按钮的唯一用途 —— 现在挂在同一套按钮上，
     * 既不重复词，也能一眼看出「自动在做什么 / 我给这城选了什么」。
     * 高亮的判定直接问 state.effectiveOrder()，与回合结算同一个答案，
     * 不在这里另写一套「手动优先 / 自动补齐」的分支。
     */
    private refreshDomesticButtons(): void {
        const sel = this.selected;
        const active: DomesticOrder | 'none' = sel && sel.owner === this.state.playerFaction
            ? this.state.effectiveOrder(sel)
            : (this.state.autoDomestic ? this.state.lastOrder : 'none');
        const items: Array<[Node, DomesticOrder]> = [
            [this.governBtn, 'govern'],
            [this.farmBtn, 'farm'],
            [this.fortifyBtn, 'fortify'],
            [this.recruitBtn, 'recruit'],
        ];
        for (const pair of items) {
            const btn = pair[0];
            const order = pair[1];
            if (!btn || !btn.isValid) {
                continue;
            }
            const g = btn.getComponent(Graphics);
            if (!g) {
                continue;
            }
            const on = active === order;
            g.clear();
            g.fillColor = on ? new Color(120, 90, 32, 255) : new Color(70, 58, 42, 255);
            g.strokeColor = on ? new Color(255, 226, 138, 255) : new Color(190, 160, 100, 220);
            g.lineWidth = on ? 3 : 2;
            g.rect(-56, -25, 112, 50);
            g.fill();
            g.stroke();
        }
    }

    /**
     * 切换自动内政：打开后每回合重复「最后点过的那道指令」
     *
     * 不再单独选方针 —— 你最后点了什么，自动就做什么。想换就点另一个内政按钮。
     */
    private onToggleAuto(): void {
        this.state.autoDomestic = !this.state.autoDomestic;
        this.refreshAutoButton();
        this.refreshDomesticButtons();
        this.audio.play('click');
        if (this.state.autoDomestic) {
            this.toast(`已开启自动：每回合自动「${POLICY_NAME[this.state.lastOrder]}」`);
        } else {
            this.toast('已关闭自动内政：每座城你自己下令');
        }
        this.saveGame();
    }

    /** 回到全局视野 */
    private onResetView(): void {
        this.mapInput.resetView();
        this.toast('已回到全局视野');
    }

    /** 切换静音 */
    private onToggleMute(): void {        const muted = this.audio.toggleMute();
        this.updateMuteLabel(muted);
        // 开启声音时给一声点击作为确认（被静音时自然不会响）
        this.audio.play('click');
    }

    /** 刷新静音按钮文字 */
    private updateMuteLabel(muted: boolean): void {
        if (this.muteLabel) {
            this.muteLabel.string = muted ? '静' : '声';
            this.muteLabel.color = muted
                ? new Color(150, 145, 135, 255)
                : new Color(240, 225, 190, 255);
        }
    }

    private doAttack(from: ProvinceState, to: ProvinceState): void {
        // 演出进行中不接受新的进攻，避免时序错乱
        if (this.showcase.busy) {
            this.toast('战斗演出进行中，请稍候…');
            return;
        }

        // 结算前先复核条件，失败时给出具体原因（不再静默返回）
        const verdict = this.state.canAttack(from, to);
        if (!verdict.ok) {
            this.toast(verdict.reason);
            return;
        }

        // 记录战斗前的数值，用于飘字（atkLoss / defLoss 要靠前后差值算）
        const fromTroopsBefore = from.troops;
        const toTroopsBefore = to.troops;
        // 俘虏不在任何城上，战报里不点名玩家很容易漏看；
        // 记住战前在押名单，打完做差集就能准确报出「这仗抓了谁」。
        const prisonersBefore = new Set(
            this.state.prisonersOf(this.state.playerFaction).map((g) => g.def.id));

        // 先结算，再演出：数值是真相，动画只是表现。
        // 即使动画被切后台打断，战斗结果也已经在 state 里定下来了。
        const res = this.state.attack(from, to);
        if (!res) {
            this.toast('无法进攻：条件不满足');
            return;
        }

        const atkLoss = Math.max(0, fromTroopsBefore - from.troops);
        const defLoss = Math.max(0, toTroopsBefore - to.troops);
        const garrison = res.captured ? to.troops : 0;
        const newPrisoners = this.state.prisonersOf(this.state.playerFaction)
            .filter((g) => !prisonersBefore.has(g.def.id))
            .map((g) => g.def.name);

        // 战斗结果即时提示（不依赖战报面板，玩家一眼能看到）
        if (res.captured) {
            // 引导 ④：玩家自己打下一座城（AI 之间易主不算）
            if (from.owner === this.state.playerFaction) {
                this.advanceTutorial(3);
            }
            const captureTip = newPrisoners.length > 0 ? ` · 俘${newPrisoners.length}人` : '';
            this.toast(`⚔ 攻占 ${to.name}！驻军 ${garrison}，缴获 ${res.loot} 金${captureTip}`);
        } else {
            this.toast(`⚔ 进攻 ${to.name} 失利，我军折损 ${atkLoss}`);
        }

        // 小游戏的振动反馈：攻下城池给强反馈
        if (res.captured) {
            vibrateShort();
        }

        // 打完立刻存档，避免玩家中途退出丢进度
        this.saveGame();

        // 先刷新地图底色（归属已变），再播动画盖在上面
        this.refreshAll();

        // 播放演出；结束前禁用面板按钮，避免连点
        this.setActionsEnabled(false);
        // 记住这次是谁打的，演出结束后优先选中出发地（玩家通常想连续出兵）
        const attackerId = from.id;
        this.showcase.playAttack(from, to, res.captured, atkLoss, defLoss, garrison, {
            onDone: () => {
                this.setActionsEnabled(true);
                this.refreshAll();
                // 攻下则选中新城；没攻下则回到出发地，方便立刻补兵再战
                const nextSel = res.captured ? to : (this.state.provinces.get(attackerId) || to);
                this.selectProvince(nextSel);
                if (!res.captured) {
                    this.toast(`${from.name} 兵力 ${from.troops}，可征兵后再攻`);
                } else if (newPrisoners.length > 0) {
                    // 演出播完再点名：告诉玩家去哪处置，别让俘虏躺在营里没人管
                    const names = newPrisoners.slice(0, 2).join('、')
                        + (newPrisoners.length > 2 ? ` 等${newPrisoners.length}人` : '');
                    this.toast(`生擒 ${names} · 点顶栏「俘虏」招降 / 放归`);
                }
                // 打下最后一城时，等演出播完再弹结算，避免遮住动画
                this.checkGameOver();
            },
        });
    }

    /** 面板上所有「只有我方城池才能按」的按钮 */
    private ownActionButtons(): Node[] {
        return [
            this.governBtn, this.farmBtn, this.fortifyBtn, this.recruitBtn,
            this.attackBtn, this.moveBtn,
        ];
    }

    /** 统一开关面板操作按钮（演出期间禁用） */
    private setActionsEnabled(enabled: boolean): void {
        const mine = this.selected && this.selected.owner === this.state.playerFaction;
        for (const b of this.ownActionButtons()) {
            if (b) {
                b.active = !!(mine && enabled);
            }
        }
    }

    private doMove(from: ProvinceState, to: ProvinceState): void {
        // 调兵的含义是「把兵送到需要的地方」，所以默认把目标城填满，
        // 出发城只留 100 的最低守备。旧版固定调一半：想把后方兵送到前线，
        // 得点三四次、过两三个中转城，每次只剩一半，纯体力活 —— 而真正的
        // 「后方→一线」已经由结束回合的自动补给接管，这里留给玩家的
        // 是精确操作：前线城之间挪兵，集中一点突破。
        const room = Math.max(0, this.state.garrisonCap(to) - to.troops);
        const amount = Math.min(room, Math.max(0, from.troops - 100));
        const moved = this.state.moveTroops(from, to, amount);
        if (moved) {
            this.showcase.playClick();
            // 调兵给一点数字反馈，让玩家看见兵力流动
            if (amount > 0) {
                this.animator.popText(to, `+${amount}`, true);
                this.toast(`${from.name} → ${to.name} 调兵 ${amount}`);
            }
        } else if (room <= 0) {
            this.toast(`${to.name} 驻军已满（上限 ${this.state.garrisonCap(to)}），先攻城或换目标`);
        } else {
            this.toast(`${from.name} 兵力不足，至少留 100 守备`);
        }
        this.refreshAll();
        this.selectProvince(to);
    }

    // ==================================================================
    // 面板按钮回调
    // ==================================================================

    /** 治理：花金币提高发展度（投资未来） */
    private onGovern(): void {
        this.doDomestic('govern');
    }

    /** 屯田：一次性补充粮草（粮草供养月募兵） */
    private onFarm(): void {
        this.doDomestic('farm');
    }

    /** 筑城：花金币 + 粮草提高工事（守城更稳） */
    private onFortify(): void {
        this.doDomestic('fortify');
    }

    /** 征兵：立刻补兵（解决当下） */
    private onRecruit(): void {
        this.doDomestic('recruit');
    }

    /**
     * 内政统一入口：**回合内只登记选择，不改任何数值**
     *
     * 真正执行只有一处 —— GameState.endTurn() 里的 settleDomestic()。
     * 以前这里直接 executeDomestic()，于是「回合内点一次筑城」立刻加工事，
     * 结束回合自动方针又给全境补一轮，一回合跑了两批内政。
     *
     * 点同一道 = 取消选择（选错能反悔）；点另一道 = 改选。
     * 选择会同步记进 lastOrder，开「自动」时它就是全境方针，
     * 所以方针变化要写进 toast，不能让玩家毫不知情。
     */
    private doDomestic(order: DomesticOrder): void {
        const p = this.selected;
        if (!p || p.owner !== this.state.playerFaction) {
            return;
        }
        if (this.showcase.busy) {
            this.toast('战斗演出进行中，请稍候…');
            return;
        }
        // 记下旧方针：登记会把它改掉，变化时必须明确告诉玩家
        const prevOrder = this.state.lastOrder;
        const verdict = this.state.queueDomestic(p, order);
        this.showcase.playClick();
        if (verdict === 'cleared') {
            this.toast(`${p.name} · 已取消${POLICY_NAME[order]}选择`);
        } else {
            const switched = this.state.autoDomestic && prevOrder !== order;
            this.toast(switched
                ? `自动方针→${POLICY_NAME[order]} · ${p.name}已选，结束回合执行`
                : `${p.name} · 已选${POLICY_NAME[order]}，结束回合执行`);
        }
        // 引导 ②：真的登记了一道内政才算完成（点同一道取消不算）
        if (verdict !== 'cleared') {
            this.advanceTutorial(1);
        }
        // 登记也是要存档的状态：中途退出，回来还看得到这回合选了什么
        this.saveGame();
        this.refreshAll();
    }

    /** 进入进攻模式：高亮敌方邻省 */
    private onAttackMode(): void {
        const p = this.selected;
        if (!p || p.owner !== this.state.playerFaction) {
            return;
        }
        if (p.troops <= 0) {
            this.toast(`${p.name} 没有兵力，请先征兵`);
            return;
        }
        const targets = this.state.attackTargets(p);
        if (targets.length === 0) {
            this.toast(`${p.name} 四周没有敌军，暂时无法进攻`);
            this.state.pushLog(`${p.name} 四周无敌军，可考虑调兵到前线。`);
            this.refreshHud();
            return;
        }
        this.mode = 'attack';
        this.mapRenderer.drawHighlights(targets, 'attack', p);
        this.syncRouteFocus();
        this.hintLabel.string = `⚔ 选择进攻目标（${targets.length} 座相邻敌城）`;
        this.cancelBtn.active = true;
        this.showcase.playClick();
        this.toast(`请点击红色高亮的敌城（${targets.map((t) => t.name).join('、')}）`);
    }

    /** 进入调兵模式：高亮己方邻省 */
    private onMoveMode(): void {
        const p = this.selected;
        if (!p || p.owner !== this.state.playerFaction) {
            return;
        }
        const targets = this.state.moveTargets(p);
        if (targets.length === 0) {
            this.state.pushLog('四周无己方城池，无法调兵。');
            this.refreshHud();
            return;
        }
        this.mode = 'move';
        this.mapRenderer.drawHighlights(targets, 'move', p);
        this.syncRouteFocus();
        this.hintLabel.string = `选择要调兵的目标（${targets.length} 个相邻己方城池）`;
        this.cancelBtn.active = true;
    }

    /** 取消当前模式 */
    private onCancelMode(): void {
        this.mode = 'select';
        this.mapRenderer.clearHighlights();
        this.cancelBtn.active = false;
        this.refreshHud();
        this.syncRouteFocus();
    }

    private onEndTurn(): void {
        // 演出进行中不允许结束回合，避免状态交错
        if (this.showcase.busy) {
            return;
        }
        // 记录结束回合前的据点归属，用来在战后提示"失守/得手"
        const beforeCount = this.state.provincesOf(this.state.playerFaction).length;

        // ⚠ endTurn() 内部会跑 AI 阶段，AI 可能直接改写 ProvinceState.owner。
        // 地图版图颜色只在 MapRenderer.draw() 里按 owner 重新填充，
        // update() 每帧只画选中光晕，不会重画底图。所以这里必须触发一次
        // 全量刷新 —— 由 onLoad 里订阅的 state.onTurnEnd -> refreshAll() 完成。
        // 以前漏了这一步：玩家自己进攻正常（doAttack 里显式 refreshAll），
        // 唯独对手回合打下的城，到了我方回合地图还是旧颜色。
        const report = this.state.endTurn();
        // 引导 ③：月收、内政结算与 AI 动向都跑完，玩家看了一整个回合
        this.advanceTutorial(2);

        // 回合更替音效
        this.showcase.playTurnChange();

        // 每回合自动存档，小游戏玩家随时可能切后台
        this.saveGame();

        const afterCount = this.state.provincesOf(this.state.playerFaction).length;
        if (afterCount < beforeCount) {
            this.showBanner(`失守 ${beforeCount - afterCount} 城`);
            vibrateShort();
        } else if (afterCount > beforeCount) {
            this.showBanner(`得手 ${afterCount - beforeCount} 城`);
        }

        // 检查胜负：统一/败亡时弹出结算，给「再开一局 / 换个剧本」入口。
        // 以前这里只弹一条横幅，统一天下后玩家没有任何重开的办法。
        const over = this.checkGameOver();

        // 回合结束后自动选中一座「前线城池」：
        // 以前这里 selectProvince(null)，面板直接空白，
        // 玩家面对一张地图不知道下一步该干什么。
        const front = this.pickFrontlineProvince();
        this.selectProvince(front);
        if (front && !over) {
            // 颜色刷新的同时把失守城名说出来：光看地图未必找得到哪块版图变了色。
            // 名字最多列 2 个，避免 560px 宽的 toast 溢出。
            const lostNames = report.lostCities.length > 0
                ? this.cityNames(report.lostCities)
                : '';
            const lostTip = lostNames ? `失守 ${lostNames} · ` : '';
            // 把本回合的钱粮与月募兵一起报出来：发展度机制的效果
            // 平时藏在数值里，结算这一下是玩家唯一能直观看到回报的时机。
            const eco = `+${report.goldIncome}金 +${report.foodIncome}粮`;
            const rein = report.reinforced > 0 ? ` 募${report.reinforced}` : '';
            // 后方补给搬了多少兵也要报：兵是自动往前线走的，玩家不点任何东西，
            // 不说明一句就会觉得「我的兵怎么自己跑了」。
            const redeploy = report.redeployed > 0 ? ` 补${report.redeployed}` : '';
            // 本回合到底执行了几城内政也要说一声：玩家回合内只是「选」，
            // 到这一刻才真正结算，没有反馈就会以为按钮白点了。
            // toast 是单行不换行的（560px 宽），所以和失守提示二选一，别堆在一起。
            const auto = report.domesticOrders > 0
                ? ` · 内政${report.domesticOrders}城`
                    + (report.autoOrders > 0 ? `（自动${report.autoOrders}）` : '')
                : '';
            this.toast(lostTip
                ? `${lostTip}新回合 ${eco}`
                : `新回合 ${eco}${rein}${redeploy}${auto}`);
        }
    }

    /** 把城池 id 列表拼成短文案（最多两个名字，其余合并成「等 N 城」） */
    private cityNames(ids: string[]): string {
        const names: string[] = [];
        for (const id of ids) {
            const p = this.state.provinces.get(id);
            if (p) {
                names.push(p.name);
            }
        }
        if (names.length <= 2) {
            return names.join('、');
        }
        return `${names.slice(0, 2).join('、')} 等${names.length}城`;
    }

    /**
     * 挑一座最值得玩家关注的己方城池
     *
     * 优先级：有可打邻敌的城 > 兵力最少的边境城 > 任意己方城。
     * 目的是让玩家结束回合后立刻有明确的下一步。
     */
    private pickFrontlineProvince(): ProvinceState | null {
        const mine = this.state.provincesOf(this.state.playerFaction);
        if (mine.length === 0) {
            return null;
        }
        // 1. 能直接进攻的城
        const canAttack = mine.filter((p) => p.troops > 0 && this.state.hasAttackTargets(p));
        if (canAttack.length > 0) {
            // 挑兵力最充足的，最容易打赢
            canAttack.sort((a, b) => b.troops - a.troops);
            return canAttack[0];
        }
        // 2. 与敌方接壤的边境城（需要补充兵力）
        const border = mine.filter((p) => {
            let hasEnemy = false;
            this.state.provinces.forEach((q) => {
                if (!hasEnemy && q.owner !== this.state.playerFaction
                    && this.state.isAdjacent(p, q)) {
                    hasEnemy = true;
                }
            });
            return hasEnemy;
        });
        if (border.length > 0) {
            border.sort((a, b) => a.troops - b.troops);
            return border[0];
        }
        return mine[0];
    }

    /** 中央横幅提示 */
    private showBanner(text: string): void {
        const n = makeRect('Banner', 520, 120, new Color(20, 16, 10, 235), this.node);
        n.addComponent(UITransform);
        addWidget(n, { hCenter: 0, vCenter: 0 });
        makeLabel('BannerTxt', text, {
            size: 40, color: new Color(255, 220, 140, 255), bold: true,
        }, n);
        tween(n)
            .delay(1.8)
            .to(0.5, { scale: new Vec3(0.8, 0.8, 1) })
            .call(() => n.destroy())
            .start();
    }

    /**
     * 浮动提示（toast）
     *
     * 用于「为什么这个操作做不了」这类即时反馈。
     * 为什么需要它：以前进攻失败是静默的，玩家只觉得「点了没反应」，
     * 以为是卡了或者游戏坏了。现在每次失败都会弹一句具体原因。
     *
     * 同一时刻只保留一条，新提示会顶掉旧的，避免刷屏。
     */
    private toast(text: string): void {
        // 移除上一条，避免叠加
        if (this.toastNode && this.toastNode.isValid) {
            this.toastNode.destroy();
        }

        // 模态层盖在 HUD 之上（createMenu 最后创建），招降 / 放归的反馈
        // 如果还挂在 this.node 上就会被遮罩挡住。弹窗开着时挂到遮罩层去。
        const host = this.menuLayer && this.menuLayer.active ? this.menuLayer : this.node;
        const n = makeBox('Toast', 560, 64, host);
        const bg = n.addComponent(Graphics);
        bg.fillColor = new Color(24, 20, 14, 235);
        bg.strokeColor = new Color(200, 170, 105, 220);
        bg.lineWidth = 2;
        bg.roundRect(-280, -32, 560, 64, 10);
        bg.fill();
        bg.stroke();

        makeLabel('ToastTxt', text, {
            size: 24, color: new Color(255, 238, 200, 255), bold: true,
        }, n);

        // 出现在屏幕下方偏中，不遮挡地图主体与面板
        addWidget(n, { hCenter: 0, bottom: 410 + this.topInset * 0 });

        const op = n.addComponent(UIOpacity);
        op.opacity = 0;
        this.toastNode = n;

        tween(op)
            .to(0.12, { opacity: 255 })
            .delay(1.5)
            .to(0.3, { opacity: 0 })
            .call(() => {
                if (n.isValid) {
                    n.destroy();
                }
                if (this.toastNode === n) {
                    this.toastNode = null;
                }
            })
            .start();
    }

    // ==================================================================
    // 刷新
    // ==================================================================

    private refreshAll(): void {
        // 重新绘制地图
        const list: ProvinceState[] = [];
        this.state.provinces.forEach((p) => list.push(p));
        // 归属变化会改变「前线 / 补给线」的分类，路网必须跟着重画
        this.mapRenderer.draw(list, this.state.playerFaction);

        // ⚠ state.reset() 会重建所有 ProvinceState 对象。重开一局后，
        // 命中回调和 MapInput 里缓存的还是上一局的数组，会把旧兵力/旧归属
        // 当成新局面返回。这里每次刷新都同步一次引用。
        this.mapInput.setProvinces(list);
        this.mapInput.setTerritoryPicker((mx, my) => this.mapRenderer.territoryAt(list, mx, my));

        // 更新城池标签：名称 + 兵力；选中的城高亮显示
        for (const p of list) {
            const v = this.hexLabels.get(p.id);
            if (v) {
                const selected = this.selected && this.selected.id === p.id;
                v.label.string = `${p.name}\n${p.troops}`;
                // 选中时字号加大、颜色变亮，让玩家一眼确认点中了哪座城
                v.label.fontSize = selected ? 21 : 17;
                v.label.lineHeight = selected ? 22 : 18;
                v.label.color = selected
                    ? new Color(190, 40, 20, 255)
                    : new Color(30, 24, 16, 255);
                v.label.outlineWidth = selected ? 4 : 3;
            }
        }
        this.refreshHud();
        // 读档 / 换势力 / 新局后，自动开关与高亮要显示存档里的状态
        this.refreshAutoButton();
        this.refreshDomesticButtons();
        // 攻下城池可能生擒守将，顶栏「俘虏」要立刻亮；营正开着时名单也要跟着变
        this.refreshPrisonButton();
        if (this.prisonPanel && this.prisonPanel.active) {
            this.refreshPrisonMenu();
        }
        if (this.selected) {
            this.showPanel(this.selected);
        }
        this.syncRouteFocus();
    }

    private refreshHud(): void {
        const st = this.state;
        const mine = st.provincesOf(st.playerFaction).length;

        // 常驻身份牌：换剧本 / 换势力 / 城池易主都要跟着变，
        // 否则玩家会拿着上一局的势力色去找自己的地盘。
        const f = FACTION_MAP[st.playerFaction];
        this.factionLabel.string = `我方 ${f ? f.name : st.playerFaction} · ${mine} 城`;
        const own = new Color();
        Color.fromHEX(own, f ? f.color : '#b8b2a4');
        const sg = this.factionSwatch;
        sg.clear();
        sg.fillColor = own;
        sg.roundRect(-13, -13, 26, 26, 5);
        sg.fill();
        sg.lineWidth = 2;
        sg.strokeColor = new Color(255, 240, 205, 230);
        sg.roundRect(-13, -13, 26, 26, 5);
        sg.stroke();

        this.dateLabel.string = `${st.dateText()}  第 ${st.turn} 回合`;
        const gold = Math.round(st.gold.get(st.playerFaction) || 0);
        this.goldLabel.string = `金币 ${gold}`;
        // 粮草是发展度机制的第二资源：月产看发展度，花在月募兵和筑城上。
        // 不常驻显示的话，玩家点了「屯田」也不知道到底攒了多少。
        this.foodLabel.string = `粮草 ${st.foodOf(st.playerFaction)}`;
        this.troopLabel.string = `兵力 ${st.totalTroops(st.playerFaction)}`;
        this.provLabel.string = `据点 ${mine} / ${st.provinces.size}`;

        // 敌情预警：只列城还属于我的意图（当回合已被打下来的城不用再回防）。
        const threats = st.liveThreats();
        if (threats.length > 0) {
            this.threatNode.active = true;
            const lines = threats.slice(0, 2).map((t) => `! 图谋 ${t.city}：${t.text}`);
            if (threats.length > 2) {
                lines.push(`另有 ${threats.length - 2} 处敌情，查看战报`);
            }
            this.threatLabel.string = lines.join('\n');
        } else {
            this.threatNode.active = false;
            this.threatLabel.string = '';
        }

        // 提示：选中被图谋的城时直接给对策；进攻 / 调兵模式的提示由
        // showAttackMenu / showMoveMenu 在本函数之后覆盖，优先级更高。
        const sel = this.selected;
        const selThreat = sel && threats.some((t) => t.id === sel.id);
        if (selThreat) {
            this.hintLabel.string = `! 敌军图谋 ${sel!.name}，可调兵回防`;
        } else if (!sel) {
            this.hintLabel.string = threats.length > 0
                ? `! 有 ${threats.length} 处敌情，点城池查看并调兵回防`
                : '橙红路可进攻 · 绿/浅色不能打 · 全图常显';
        } else if (sel.owner === st.playerFaction) {
            this.hintLabel.string = `已选 ${sel.name} · 内政四选一，结束回合执行`;
        } else {
            this.hintLabel.string = `敌方 ${sel.name}：选择我方相邻城池发起进攻`;
        }

        // 战报：要闻（! 开头）置顶，普通日志补位。
        // recentLogs() 保证玩家相关战况不会被其他势力的战报挤出窗口。
        const recent = st.recentLogs(3, 5);
        this.logLabel.string = recent
            .map((x) => `${x.important ? '! ' : '  '}${x.text}`)
            .join('\n');

        // 常驻目标条 + 阶段目标达成播报（丢城回退不重复播报）
        this.noteObjective(mine, st.provinces.size, st.stats.openingCities);
        this.refreshGoalBar();
        // 引导 ⑤：战报窗口里真的出现了 ! 要闻，就算玩家「看到了」
        if (this.profile.tutorialStep === TUTORIAL_STEPS.length - 1
            && recent.some((x) => x.important)) {
            this.advanceTutorial(TUTORIAL_STEPS.length - 1);
        }
    }

    update(dt: number): void {
        this.timeAcc += dt;
        // 已选中时，每帧绘制光晕
        if (this.selected) {
            this.mapRenderer.drawGlow([this.selected], this.timeAcc);
        }
    }

    // ==================================================================
    // 首次体验：局外档案 / 任务式引导 / 阶段目标 / 战绩分享
    //
    // 这一组只做「让玩家知道下一步做什么、赢完之后有理由再来一局」。
    // 不发金币 / 兵 / 粮，不碰 Balance.ts，不弹模态遮罩，也不拦截点击。
    // ==================================================================

    /** 局外档案独立存档：局面存档会在新开一局时被清掉，累计成绩不能跟着没 */
    private saveProfile(): void {
        saveData(PROFILE_KEY, this.profile);
    }

    /**
     * 推进任务式引导：只有玩家真的做完当前这一步才 +1。
     * 每个动作只接一根线，重复点 / 跳着做都不会把进度推乱。
     */
    private advanceTutorial(step: number): void {
        if (this.profile.tutorialStep !== step || step < 0
            || step >= TUTORIAL_STEPS.length) {
            return;
        }
        const done = TUTORIAL_STEPS[step];
        this.profile.tutorialStep = step + 1;
        this.saveProfile();
        this.toast(done.done);
        this.refreshGoalBar();
    }

    /** 阶段目标达成播报一次；丢城回退后重新达成也给一次，但不刷屏 */
    private noteObjective(mine: number, total: number, opening: number): void {
        const lv = objectiveLevel(mine, total, opening);
        if (this.goalShownLevel < 0) {
            // 第一次刷新（开局 / 读档）只建立基线，不弹「已达成」
            this.goalShownLevel = lv;
            return;
        }
        if (lv > this.goalShownLevel) {
            const name = OBJECTIVE_NAMES[Math.min(lv - 1, OBJECTIVE_NAMES.length - 1)];
            this.toast(`达成目标 · ${name}！`);
            for (let i = 0; i < lv; i++) {
                const id = OBJECTIVE_IDS[i];
                if (id && this.profile.objectives.indexOf(id) < 0) {
                    this.profile.objectives.push(id);
                }
            }
            this.saveProfile();
        }
        this.goalShownLevel = lv;
    }

    /** 常驻目标条：引导期显示「下一步做什么」，引导完成后显示阶段目标 */
    private refreshGoalBar(): void {
        if (!this.goalNode || !this.goalLabel) {
            return;
        }
        const st = this.state;
        const line = tutorialLine(this.profile.tutorialStep);
        if (line) {
            this.goalLabel.string = `${line}\n完成后解锁阶段目标`;
        } else {
            const mine = st.provincesOf(st.playerFaction).length;
            this.goalLabel.string = objectiveLines(
                mine, st.provinces.size, st.stats.openingCities, this.profile,
            ).join('\n');
        }
    }

    /**
     * 分享战绩：微信里右上角「···」转发会自动带上最新文案（见 setupShare），
     * 这里再把文案复制一份；H5 / 编辑器没有剪贴板时降级为一句可读提示。
     */
    private onShareResult(): void {
        const text = currentShareText();
        setShareText(text);
        const copied = copyText(text);
        const tip = isWeChat()
            ? '战绩文案已备好 · 点右上角「···」转发给好友'
            : (copied ? '战绩文案已复制，粘贴给好友吧' : '战绩文案见结算页 · 可长按记录');
        this.toast(tip);
        this.audio.play('click');
    }
}
