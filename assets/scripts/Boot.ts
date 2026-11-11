import { director, Director, Node, UITransform, Layers, Canvas, Camera, Color } from 'cc';
import { GameController } from './GameController';

/**
 * 启动引导
 *
 * 引擎在启动时会自动加载工程内全部脚本（构建/预览都如此），本文件顶层的
 * 事件注册因此一定会在第一个场景启动时生效。它负责：
 *   1. 确保场景里存在一个可用的 Canvas（含 2D 正交相机）；
 *   2. 把 GameController 挂到 Canvas 上，由它纯代码搭建整个界面。
 *
 * 这样场景文件只承担「提供 Canvas」的最小职责，游戏主体完全由脚本构建，
 * 不依赖在编辑器里手工拖拽节点，工程开箱即可运行。
 */

/** 已经启动过，避免重复挂载 */
let booted = false;

/** 确保场景中有 Canvas 与对应的 2D 相机，返回该节点 */
function ensureCanvas(): Node {
    const scene = director.getScene()!;
    const existing = scene.getChildByName('Canvas');
    if (existing) {
        return existing;
    }

    const canvasNode = new Node('Canvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    scene.addChild(canvasNode);
    canvasNode.addComponent(UITransform);
    const canvas = canvasNode.addComponent(Canvas);

    // 2D 正交相机（场景里没有相机时兜底创建）
    const camNode = new Node('Camera');
    camNode.layer = Layers.Enum.UI_2D;
    canvasNode.addChild(camNode);
    const cam = camNode.addComponent(Camera);
    cam.projection = Camera.ProjectionType.ORTHO;
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = new Color(18, 16, 13, 255);
    cam.visibility = Layers.Enum.UI_2D;
    cam.orthoHeight = 640;
    cam.near = 0.1;
    cam.far = 2000;
    camNode.setPosition(0, 0, 1000);

    canvas.cameraComponent = cam;
    canvas.alignCanvasWithScreen = true;

    return canvasNode;
}

/** 启动游戏：挂载主控制器 */
function boot(): void {
    if (booted) {
        return;
    }
    const scene = director.getScene();
    if (!scene) {
        return;
    }
    booted = true;

    const canvasNode = ensureCanvas();
    if (!canvasNode.getComponent(GameController)) {
        canvasNode.addComponent(GameController);
    }
}

// 第一个场景启动完成后执行（此时 Canvas 的相关组件已就绪）
director.once(Director.EVENT_AFTER_SCENE_LAUNCH, boot);

// 兼容：若脚本被加载时场景已经启动（例如热重载），立即补一次
if (director.getScene()) {
    boot();
}
