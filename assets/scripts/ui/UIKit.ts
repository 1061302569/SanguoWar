import {
    Color, Label, Node, UITransform, Vec3, Graphics,
    Widget, UIOpacity, Layers, HorizontalTextAlignment,
} from 'cc';

/**
 * UI 快速构建工具
 * 全部用代码构建节点，避免依赖预制体与美术资源，保证项目开箱即可运行。
 */

/** 图层：UI_2D */
export const UI_LAYER = Layers.Enum.UI_2D;

/** 创建空节点 */
export function makeNode(name: string, parent?: Node | null): Node {
    const n = new Node(name);
    n.layer = UI_LAYER;
    if (parent) {
        parent.addChild(n);
    }
    return n;
}

/** 创建带尺寸的节点 */
export function makeBox(name: string, w: number, h: number, parent?: Node | null): Node {
    const n = makeNode(name, parent);
    const ut = n.addComponent(UITransform);
    ut.setContentSize(w, h);
    return n;
}

/** 创建纯色矩形（用 Graphics 绘制，零美术依赖） */
export function makeRect(
    name: string,
    w: number,
    h: number,
    color: Color,
    parent?: Node | null,
): Node {
    const n = makeBox(name, w, h, parent);
    const g = n.addComponent(Graphics);
    g.fillColor = color;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    return n;
}

/** 创建描边矩形 */
export function makeRectStroke(
    name: string,
    w: number,
    h: number,
    fill: Color,
    stroke: Color,
    lineWidth: number,
    parent?: Node | null,
): Node {
    const n = makeBox(name, w, h, parent);
    const g = n.addComponent(Graphics);
    g.fillColor = fill;
    g.strokeColor = stroke;
    g.lineWidth = lineWidth;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    g.stroke();
    return n;
}

export interface LabelOpts {
    size?: number;
    color?: Color;
    bold?: boolean;
    align?: HorizontalTextAlignment;
    lineHeight?: number;
    /** 宽度约束，超出换行 */
    width?: number;
    /** 固定高度 */
    height?: number;
}

/** 创建文本节点 */
export function makeLabel(
    name: string,
    text: string,
    opts: LabelOpts,
    parent?: Node | null,
): Label {
    const n = makeNode(name, parent);
    const ut = n.addComponent(UITransform);
    if (opts.width !== undefined) {
        ut.setContentSize(opts.width, opts.height === undefined ? 30 : opts.height);
    }
    const lb = n.addComponent(Label);
    lb.string = text;
    lb.fontSize = opts.size === undefined ? 22 : opts.size;
    lb.lineHeight = opts.lineHeight === undefined ? lb.fontSize + 6 : opts.lineHeight;
    lb.color = opts.color === undefined ? new Color(30, 26, 20, 255) : opts.color;
    lb.isBold = opts.bold === true;
    lb.useSystemFont = true;
    lb.fontFamily = 'Microsoft YaHei, PingFang SC, sans-serif';
    lb.horizontalAlign = opts.align === undefined ? Label.HorizontalAlign.CENTER : opts.align;
    lb.verticalAlign = Label.VerticalAlign.CENTER;
    if (opts.width !== undefined) {
        lb.overflow = Label.Overflow.RESIZE_HEIGHT;
        lb.enableWrapText = true;
    }
    return lb;
}

/** 设置节点世界坐标（相对父节点） */
export function setPos(n: Node, x: number, y: number): void {
    n.setPosition(new Vec3(x, y, 0));
}

/** 添加 Widget 以贴合父节点 */
export function addWidget(
    n: Node,
    opts: { left?: number; right?: number; top?: number; bottom?: number; hCenter?: number; vCenter?: number },
): Widget {
    const w = n.addComponent(Widget);
    if (opts.left !== undefined) {
        w.isAlignLeft = true;
        w.left = opts.left;
    }
    if (opts.right !== undefined) {
        w.isAlignRight = true;
        w.right = opts.right;
    }
    if (opts.top !== undefined) {
        w.isAlignTop = true;
        w.top = opts.top;
    }
    if (opts.bottom !== undefined) {
        w.isAlignBottom = true;
        w.bottom = opts.bottom;
    }
    if (opts.hCenter !== undefined) {
        w.isAlignHorizontalCenter = true;
        w.horizontalCenter = opts.hCenter;
    }
    if (opts.vCenter !== undefined) {
        w.isAlignVerticalCenter = true;
        w.verticalCenter = opts.vCenter;
    }
    w.alignMode = Widget.AlignMode.ALWAYS;
    return w;
}

/** 设置不透明度（不移除节点） */
export function setOpacity(n: Node, value: number): void {
    let op = n.getComponent(UIOpacity);
    if (!op) {
        op = n.addComponent(UIOpacity);
    }
    op.opacity = value;
}
