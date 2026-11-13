import { sys } from 'cc';

/**
 * 平台适配层
 *
 * 把微信小游戏与浏览器/编辑器之间的差异集中在这里，其余代码不直接碰 wx。
 * 设计原则：所有调用都必须能在没有 wx 的环境（编辑器预览、浏览器、单元测试）下安全降级。
 */

/** 微信全局对象（类型不完全，用 any 访问，所有调用都做存在性判断） */
declare const wx: any;

/** 是否运行在微信小游戏环境 */
export function isWeChat(): boolean {
    return typeof wx !== 'undefined' && !!wx && typeof wx.getSystemInfoSync === 'function';
}

/** 是否运行在编辑器里 */
export function isEditor(): boolean {
    return !!(sys as any).isEditor;
}

/** 安全获取 wx 对象；非微信环境返回 null */
function getWx(): any {
    return isWeChat() ? wx : null;
}

// ----------------------------------------------------------------------
// 系统信息 / 安全区
// ----------------------------------------------------------------------

export interface SafeArea {
    /** 安全区顶部（用于避开刘海与胶囊按钮），单位：设计像素之外的原始像素 */
    top: number;
    bottom: number;
    left: number;
    right: number;
    /** 屏幕宽高（px） */
    screenWidth: number;
    screenHeight: number;
    /** 是否拿到了真实数据 */
    valid: boolean;
}

let _safeArea: SafeArea | null = null;

/** 获取安全区（带缓存）。非微信环境返回一个无内边距的占位值。 */
export function getSafeArea(): SafeArea {
    if (_safeArea) {
        return _safeArea;
    }
    const w = getWx();
    if (!w) {
        _safeArea = {
            top: 0, bottom: 0, left: 0, right: 0,
            screenWidth: 0, screenHeight: 0, valid: false,
        };
        return _safeArea;
    }
    try {
        const info = w.getSystemInfoSync();
        const sa = info.safeArea || {
            top: 0,
            bottom: info.screenHeight,
            left: 0,
            right: info.screenWidth,
        };
        _safeArea = {
            top: sa.top || 0,
            bottom: (info.screenHeight || 0) - (sa.bottom || 0),
            left: sa.left || 0,
            right: (info.screenWidth || 0) - (sa.right || 0),
            screenWidth: info.screenWidth || 0,
            screenHeight: info.screenHeight || 0,
            valid: true,
        };
    } catch (e) {
        _safeArea = {
            top: 0, bottom: 0, left: 0, right: 0,
            screenWidth: 0, screenHeight: 0, valid: false,
        };
    }
    return _safeArea;
}

/**
 * 计算「顶部需要额外留出的设计像素」
 *
 * 微信右上角的胶囊按钮会盖住顶部 UI，所以顶部安全区要按胶囊按钮的下沿来算，
 * 这比 safeArea.top 更准确。
 */
export function getTopInsetDesign(designHeight: number): number {
    const w = getWx();
    if (!w) {
        return 0;
    }
    try {
        const info = w.getSystemInfoSync();
        const screenH = info.screenHeight || 0;
        if (screenH <= 0) {
            return 0;
        }
        // 胶囊按钮位置优先
        let topPx = getSafeArea().top;
        if (typeof w.getMenuButtonBoundingClientRect === 'function') {
            const menu = w.getMenuButtonBoundingClientRect();
            if (menu && menu.bottom > 0) {
                // 胶囊下沿 + 一点间距
                topPx = Math.max(topPx, menu.bottom + 6);
            }
        }
        // px -> 设计像素：设计高度对应整个屏幕高度
        return Math.round((topPx / screenH) * designHeight);
    } catch (e) {
        return 0;
    }
}

// ----------------------------------------------------------------------
// 存储（存档）
// ----------------------------------------------------------------------

/** 读取存档；读不到或解析失败返回 null */
export function loadData(key: string): any | null {
    const w = getWx();
    try {
        let raw: string | null = null;
        if (w && typeof w.getStorageSync === 'function') {
            raw = w.getStorageSync(key);
        } else if (typeof localStorage !== 'undefined') {
            raw = localStorage.getItem(key);
        }
        if (!raw) {
            return null;
        }
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

/** 写入存档，返回是否成功 */
export function saveData(key: string, data: any): boolean {
    const w = getWx();
    try {
        const raw = JSON.stringify(data);
        if (w && typeof w.setStorageSync === 'function') {
            w.setStorageSync(key, raw);
            return true;
        }
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, raw);
            return true;
        }
    } catch (e) {
        // 小游戏的存储有上限（10MB），失败时静默降级
        return false;
    }
    return false;
}

/** 删除存档 */
export function clearData(key: string): boolean {
    const w = getWx();
    try {
        if (w && typeof w.removeStorageSync === 'function') {
            w.removeStorageSync(key);
            return true;
        }
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(key);
            return true;
        }
    } catch (e) {
        return false;
    }
    return false;
}

// ----------------------------------------------------------------------
// 振动 / 分享 / 生命周期
// ----------------------------------------------------------------------

/** 轻微振动反馈（战斗、占领时调用），非微信环境忽略 */
export function vibrateShort(): void {
    const w = getWx();
    if (w && typeof w.vibrateShort === 'function') {
        try {
            w.vibrateShort({ type: 'light' });
        } catch (e) {
            // 部分机型不支持，忽略
        }
    }
}

/**
 * 当前分享文案。
 *
 * 以前 `setupShare()` 在 onLoad 里注册完就是一句静态标语，玩家打完一局
 * 点右上角「···」转发出去的还是「从一城之地到天下一统」，没有任何可比较
 * 的成绩，也就没有分享理由。现在把文案抽成模块变量：结算时只改变量，
 * 已注册的转发回调每次都读最新值。
 */
let _shareTitle = '三国战棋：从一城之地到天下一统';

/** 读取当前分享文案（非微信环境同样可用，供「复制战绩」降级展示） */
export function currentShareText(): string {
    return _shareTitle;
}

/** 更新分享文案，不重复注册转发回调；非微信环境只记下文案 */
export function setShareText(title: string): void {
    if (typeof title === 'string' && title.length > 0) {
        _shareTitle = title.slice(0, 120);
    }
}

/**
 * 复制战绩文案。微信走剪贴板 API，浏览器走 navigator.clipboard；
 * 两者都没有时返回 false，由 UI 直接把文案显示出来（绝不静默失败）。
 */
export function copyText(text: string): boolean {
    if (!text) {
        return false;
    }
    const w = getWx();
    try {
        if (w && typeof w.setClipboardData === 'function') {
            w.setClipboardData({ data: text });
            return true;
        }
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
            // 异步 API：这里只负责触发，写入失败也不该影响玩法
            const p = nav.clipboard.writeText(text);
            if (p && typeof p.catch === 'function') {
                p.catch(() => undefined);
            }
            return true;
        }
    } catch (e) {
        return false;
    }
    return false;
}

/** 分享配置（右上角「转发」会用它） */
export function setupShare(title: string, imageUrl?: string): void {
    setShareText(title);
    const w = getWx();
    if (!w) {
        return;
    }
    if (typeof w.showShareMenu === 'function') {
        try {
            w.showShareMenu({ withShareTicket: true });
        } catch (e) {
            // 忽略
        }
    }
    if (typeof w.onShareAppMessage === 'function') {
        w.onShareAppMessage(() => ({
            title: currentShareText(),
            imageUrl: imageUrl || '',
        }));
    }
}

/** 注册「小程序切到后台」回调（用于自动存档） */
export function onHide(cb: () => void): void {
    const w = getWx();
    if (w && typeof w.onHide === 'function') {
        try {
            w.onHide(cb);
        } catch (e) {
            // 忽略
        }
    }
}

/** 保持屏幕常亮（战棋游戏需要长时间观察地图） */
export function keepScreenOn(): void {
    const w = getWx();
    if (w && typeof w.setKeepScreenOn === 'function') {
        try {
            w.setKeepScreenOn({ keepScreenOn: true });
        } catch (e) {
            // 忽略
        }
    }
}

// ----------------------------------------------------------------------
// 音频上下文
// ----------------------------------------------------------------------

/**
 * 获取一个可用的 WebAudio 上下文
 *
 * 微信小游戏用 wx.createWebAudioContext，浏览器/编辑器用 AudioContext。
 * 由适配层统一提供，避免业务代码直接碰平台 API。
 * 环境不支持时返回 null，调用方应当静默降级（无声不影响玩法）。
 */
export function createAudioContext(): any | null {
    // 微信小游戏
    const w = getWx();
    if (w && typeof w.createWebAudioContext === 'function') {
        try {
            return w.createWebAudioContext();
        } catch (e) {
            // 继续尝试浏览器方案
        }
    }
    // 浏览器 / 编辑器预览
    try {
        if (typeof globalThis !== 'undefined' && globalThis) {
            const g: any = globalThis;
            const Ctor = g.AudioContext || g.webkitAudioContext;
            if (Ctor) {
                return new Ctor();
            }
        }
    } catch (e) {
        // 忽略
    }
    return null;
}
