import { Color, Graphics, Label, Node, tween, UITransform, Vec3, UIOpacity, HorizontalTextAlignment } from 'cc';
import { Geo } from '../core/Geo';
import { ProvinceState } from '../data/Types';
import { makeNode } from './UIKit';

/**
 * 战斗动画（真实地理版）
 *
 * 城池不再在规整网格上，坐标来自 Geo.project(lat, lon)。
 * 视觉效果与网格版一致：箭头飞行、受击震动、兵力飘字、占领闪光。
 */

const DUR = {
    arrow: 0.3,
    shake: 0.22,
    float: 0.75,
    flash: 0.5,
};

export class CombatAnimator {
    private layer: Node;

    constructor(layer: Node) {
        this.layer = layer;
    }

    public setLayer(layer: Node): void {
        this.layer = layer;
    }

    /** 城池圆点的视觉半径 */
    private radiusOf(p: ProvinceState): number {
        return p.def.city ? 21 : 17;
    }

    /**
     * 进攻箭头
     * @param from 出发省
     * @param to 目标省
     */
    public playArrow(
        from: ProvinceState,
        to: ProvinceState,
        color: Color,
        onHit?: () => void,
    ): void {
        const a = Geo.project(from.lat, from.lon);
        const b = Geo.project(to.lat, to.lon);

        const node = makeNode('Arrow', this.layer);
        const g = node.addComponent(Graphics);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(80, 80);

        // 箭头指向 +X，便于按角度旋转
        const L = 26;
        const W = 7;
        g.fillColor = color;
        g.moveTo(L, 0);
        g.lineTo(L * 0.25, W * 1.7);
        g.lineTo(L * 0.25, W);
        g.lineTo(-L * 0.7, W);
        g.lineTo(-L * 0.7, -W);
        g.lineTo(L * 0.25, -W);
        g.lineTo(L * 0.25, -W * 1.7);
        g.close();
        g.fill();

        // 白色描边，让箭头在任何底色上都清楚
        g.lineWidth = 1.5;
        g.strokeColor = new Color(255, 255, 255, 180);
        g.moveTo(L, 0);
        g.lineTo(L * 0.25, W * 1.7);
        g.lineTo(L * 0.25, W);
        g.lineTo(-L * 0.7, W);
        g.lineTo(-L * 0.7, -W);
        g.lineTo(L * 0.25, -W);
        g.lineTo(L * 0.25, -W * 1.7);
        g.close();
        g.stroke();

        node.setPosition(new Vec3(a.x, a.y, 0));
        node.angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

        const mid = new Vec3((a.x + b.x) / 2, (a.y + b.y) / 2 + 14, 0);
        const end = new Vec3(b.x, b.y, 0);

        tween(node)
            .to(DUR.arrow * 0.45, { position: mid }, { easing: 'quadOut' })
            .to(DUR.arrow * 0.55, { position: end }, { easing: 'quadIn' })
            .call(() => {
                if (onHit) {
                    onHit();
                }
                node.destroy();
            })
            .start();
    }

    /** 受击震动：城市圆点外圈震一下 */
    public shakeHex(target: ProvinceState, color?: Color): void {
        const pt = Geo.project(target.lat, target.lon);
        const r = this.radiusOf(target) + 6;
        const node = makeNode('Shake', this.layer);
        const g = node.addComponent(Graphics);
        g.strokeColor = color || new Color(255, 120, 90, 255);
        g.lineWidth = 5;
        g.circle(pt.x, pt.y, r);
        g.stroke();

        const step = 7;
        tween(node)
            .to(0.04, { position: new Vec3(step, 0, 0) })
            .to(0.04, { position: new Vec3(-step, 0, 0) })
            .to(0.04, { position: new Vec3(step * 0.6, 0, 0) })
            .to(0.04, { position: new Vec3(-step * 0.6, 0, 0) })
            .to(0.06, { position: new Vec3(0, 0, 0) })
            .call(() => node.destroy())
            .start();
    }

    /**
     * 兵力飘字
     * @param isGain true 绿色向上，false 红色向下
     */
    public popText(target: ProvinceState, text: string, isGain: boolean): void {
        const pt = Geo.project(target.lat, target.lon);
        const startY = pt.y + this.radiusOf(target) + 14;
        const node = makeNode('Pop', this.layer);
        node.setPosition(new Vec3(pt.x, startY, 0));

        const lb = node.addComponent(Label);
        lb.string = text;
        lb.fontSize = 26;
        lb.lineHeight = 30;
        lb.isBold = true;
        lb.useSystemFont = true;
        lb.color = isGain ? new Color(120, 235, 140, 255) : new Color(255, 110, 90, 255);
        lb.horizontalAlign = HorizontalTextAlignment.CENTER;
        lb.verticalAlign = Label.VerticalAlign.CENTER;
        lb.enableOutline = true;
        lb.outlineColor = new Color(0, 0, 0, 220);
        lb.outlineWidth = 3;

        const op = node.addComponent(UIOpacity);
        op.opacity = 255;

        const dy = isGain ? 52 : -38;
        tween(node)
            .to(DUR.float, { position: new Vec3(pt.x, startY + dy, 0) }, { easing: 'quadOut' })
            .call(() => node.destroy())
            .start();
        tween(op)
            .delay(DUR.float * 0.35)
            .to(DUR.float * 0.65, { opacity: 0 })
            .start();
    }

    /** 占领闪光 */
    public flashHex(target: ProvinceState, color: Color): void {
        const pt = Geo.project(target.lat, target.lon);
        const r = this.radiusOf(target) + 4;
        const node = makeNode('Flash', this.layer);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(color.r, color.g, color.b, 200);
        g.circle(pt.x, pt.y, r);
        g.fill();

        const op = node.addComponent(UIOpacity);
        op.opacity = 200;
        tween(op)
            .to(DUR.flash, { opacity: 0 }, { easing: 'quadOut' })
            .call(() => node.destroy())
            .start();
    }

    /** 供外部查询动画时长 */
    public getTimings(): { arrow: number; shake: number; float: number; flash: number } {
        return { ...DUR };
    }
}
