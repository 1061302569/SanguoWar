import { Color, Node } from 'cc';
import { ProvinceState } from '../data/Types';
import { FACTION_MAP } from '../data/Factions';
import { AudioPlayer } from '../audio/AudioPlayer';
import { CombatAnimator } from './CombatAnimator';

/**
 * 战斗演出编排
 *
 * 把一次「点击进攻」变成一段有时间轴的演出：
 *   0.00s  箭头飞出 + 打击音
 *   0.28s  箭头命中：目标格震动、受损飘字、音效判定结果
 *   若占领：0.55s 整格闪光 + 占领音 + 驻军飘字
 *
 * 关键设计：演出的每一步都只是「表现」，游戏数值在调用前已经结算完毕。
 * 因此玩家就算跳过动画（或动画被销毁），也不会影响战斗结果，
 * 这对小游戏很重要——切后台、断帧都不能让战斗状态错乱。
 */

/** 一步演出的回调 */
export interface ShowcaseHooks {
    /** 演出结束时调用（用于恢复 UI 交互） */
    onDone?: () => void;
}

export class BattleShowcase {
    private animator: CombatAnimator;
    private audio: AudioPlayer;
    /** 演出是否进行中（进行中时禁止再发起进攻，避免状态错乱） */
    private _busy = false;
    /** 正在进行的临时 tween 清理函数 */
    private timers: number[] = [];

    constructor(animator: CombatAnimator, audio: AudioPlayer) {
        this.animator = animator;
        this.audio = audio;
    }

    /** 是否有演出正在进行 */
    public get busy(): boolean {
        return this._busy;
    }

    /** 取进攻方势力色 */
    private factionColor(factionId: string): Color {
        const f = FACTION_MAP[factionId];
        const c = new Color();
        if (f) {
            Color.fromHEX(c, f.color);
        } else {
            c.set(220, 220, 220, 255);
        }
        return c;
    }

    /**
     * 播放一次进攻演出
     *
     * @param from 出发省（进攻方，归属已更新为获胜方）
     * @param to 目标省（归属已更新）
     * @param captured 是否攻下
     * @param atkLoss 进攻方损失
     * @param defLoss 守方损失
     * @param garrison 占领后留驻兵力（未占领传 0）
     * @param hooks 结束回调
     */
    public playAttack(
        from: ProvinceState,
        to: ProvinceState,
        captured: boolean,
        atkLoss: number,
        defLoss: number,
        garrison: number,
        hooks?: ShowcaseHooks,
    ): void {
        this._busy = true;
        const attackerColor = this.factionColor(from.owner);
        const defenderColor = captured
            ? this.factionColor(to.owner)
            : new Color(220, 90, 70, 255);

        // 1) 箭头飞出
        this.animator.playArrow(from, to, attackerColor, () => {
            // 2) 命中：震动 + 音效 + 双方损失飘字
            this.animator.shakeHex(to, captured ? attackerColor : defenderColor);
            this.audio.play(captured ? 'capture' : 'fail');

            // 守方损失（红，向下）
            if (defLoss > 0) {
                this.animator.popText(to, `-${defLoss}`, false);
            }
            // 进攻方损失在出发地显示（红，向下）
            if (atkLoss > 0) {
                this.animator.popText(from, `-${atkLoss}`, false);
            }

            if (captured) {
                // 3) 占领表现：闪光 + 驻军数字（绿，向上）
                this.animator.flashHex(to, attackerColor);
                if (garrison > 0) {
                    this.animator.popText(to, `+${garrison}`, true);
                }
            }

            // 演出收尾
            //
            // 时间要短：这期间所有地图点击都会被拦截（只弹「演出进行中」），
            // 620ms 会让玩家觉得"点了没反应"。缩短到 420/300，
            // 动画本身仍能播完（箭头 0.3s + 震动 0.22s）。
            this.schedule(() => {
                this._busy = false;
                if (hooks && hooks.onDone) {
                    hooks.onDone();
                }
            }, captured ? 420 : 300);
        });
    }

    /** 回合切换的简单演出（结束回合时） */
    public playTurnChange(): void {
        this.audio.play('turn');
    }

    /** 播放界面点击音 */
    public playClick(): void {
        this.audio.play('click');
    }

    /** 定时器封装：用小游戏的 setTimeout，兼容性好 */
    private schedule(fn: () => void, ms: number): void {
        const id = setTimeout(() => {
            const idx = this.timers.indexOf(id as any);
            if (idx >= 0) {
                this.timers.splice(idx, 1);
            }
            fn();
        }, ms) as any;
        this.timers.push(id as any);
    }

    /** 取消所有排队的收尾动作（切换场景/重开时调用） */
    public cancelAll(): void {
        for (const id of this.timers) {
            clearTimeout(id as any);
        }
        this.timers = [];
        this._busy = false;
    }
}
