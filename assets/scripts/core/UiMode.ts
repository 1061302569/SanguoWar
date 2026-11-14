/**
 * UI 模式与「当前局面」操作准入（纯逻辑，不依赖 cc / wx，Node 回归可直接跑）。
 *
 * 选势力阶段展示的是**剧本开局版图预览**，而 GameState 里还留着上一局。
 * 以前「结束回合」按钮没有模式判断：点一下就会 endTurn() -> onTurnEnd ->
 * refreshAll()，把上一局的版图、金环、城池面板全刷回来，selectProvince()
 * 还会把 mode 改回 select —— 玩家像是被直接踢回上一局，而且那一局还被
 * 偷偷推进了一个回合。
 *
 * 这里只回答「在当前模式下，这个动作准不准」。事件分发与接线由
 * GameController 负责，回归可以同时断言纯逻辑与源码接线，不用跑 Cocos 引擎。
 */
export type GameMode = 'select' | 'move' | 'attack' | 'pickFaction';

/** 会改动当前局面、或把视图刷回当前局的动作 */
export type GameplayAction =
    | 'endTurn'
    | 'domestic'
    | 'autoDomestic'
    | 'attackMode'
    | 'moveMode'
    | 'attack'
    | 'move'
    | 'cancelMode'
    | 'locateOwn'
    | 'selectProvince'
    | 'openPrison'
    | 'openScenario'
    | 'refreshAll';

/**
 * 选势力阶段一律拒绝的动作。
 * 新增会改局面的 HUD 入口时往这里加，回归会自动覆盖到它。
 */
export const PICK_BLOCKED: GameplayAction[] = [
    'endTurn',
    'domestic',
    'autoDomestic',
    'attackMode',
    'moveMode',
    'attack',
    'move',
    'cancelMode',
    'locateOwn',
    'selectProvince',
    'openPrison',
    'openScenario',
    'refreshAll',
];

/** 选势力阶段唯一允许的是「点城改选 / 确认 / 返回 / 缩放拖动 / 纯视图开关」 */
export function isGameplayAllowed(mode: GameMode, action: GameplayAction): boolean {
    return mode !== 'pickFaction' || PICK_BLOCKED.indexOf(action) < 0;
}

/** 被拦下时给出去路，不能只说「不行」 */
export function factionPickHint(): string {
    return '正在选势力 · 点「返回剧本」回到上一局，或确认后开新局';
}
