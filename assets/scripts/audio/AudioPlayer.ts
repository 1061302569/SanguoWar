import { getSfx, SfxName, SAMPLE_RATE } from '../core/SfxSynth';
import { loadData, saveData, createAudioContext } from '../platform/WeChatAdapter';

/**
 * 音效播放器
 *
 * 用 WebAudio 直接播放运行时合成的 PCM，不依赖任何音频资源文件。
 * 微信小游戏与浏览器都提供 WebAudio 上下文，差异由平台适配层统一屏蔽；
 * 若环境不支持（例如某些纯逻辑测试），所有播放调用都静默跳过，绝不报错。
 *
 * 设计要点：
 *   - 音频上下文延迟到第一次播放时才创建（自动播放策略要求用户手势后创建）
 *   - 每种音效只合成一次，PCM 缓存在 SfxSynth 里
 *   - 静音开关持久化到本地存储，玩家设置不会被重置
 */

/** 静音设置的存储键 */
const MUTE_KEY = 'sanguowar_muted';

/** 各类音效的相对音量（0-1），让激光/鼓点听起来层次合理 */
const VOLUME: Record<SfxName, number> = {
    hit: 0.55,
    capture: 0.75,
    fail: 0.6,
    click: 0.35,
    turn: 0.5,
};

/** WebAudio 上下文的最小接口（避免依赖 DOM 类型定义） */
interface AudioCtxLike {
    sampleRate: number;
    destination: any;
    state?: string;
    resume?: () => Promise<void> | void;
    createBuffer: (channels: number, length: number, rate: number) => any;
    createBufferSource: () => any;
    createGain?: () => any;
}

export class AudioPlayer {
    private ctx: AudioCtxLike | null = null;
    /** 是否已尝试创建上下文（无论成败），避免反复重试 */
    private ctxTried = false;
    /** 已解码的音频缓冲缓存 */
    private buffers = new Map<SfxName, any>();
    private _muted = false;
    /** 主音量 */
    private _master = 1.0;

    constructor() {
        // 读取持久化的静音设置
        const saved = loadData(MUTE_KEY);
        if (saved && typeof saved.muted === 'boolean') {
            this._muted = saved.muted;
        }
    }

    /** 是否静音 */
    public get muted(): boolean {
        return this._muted;
    }

    /** 切换静音（会持久化） */
    public setMuted(value: boolean): void {
        this._muted = value;
        saveData(MUTE_KEY, { muted: value });
    }

    /** 静音开关翻转，返回新状态 */
    public toggleMute(): boolean {
        this.setMuted(!this._muted);
        return this._muted;
    }

    /** 设置主音量（0-1） */
    public setMasterVolume(v: number): void {
        this._master = Math.min(1, Math.max(0, v));
    }

    /** 惰性创建音频上下文 */
    private ensureContext(): AudioCtxLike | null {
        if (this.ctx) {
            return this.ctx;
        }
        if (this.ctxTried) {
            return null;
        }
        this.ctxTried = true;
        // 平台差异（微信 / 浏览器）统一由适配层处理
        this.ctx = createAudioContext() as AudioCtxLike | null;
        return this.ctx;
    }

    /** 把 PCM 数据转成 AudioBuffer（按音效名缓存） */
    private getBuffer(name: SfxName): any {
        const cached = this.buffers.get(name);
        if (cached) {
            return cached;
        }
        const ctx = this.ensureContext();
        if (!ctx) {
            return null;
        }
        try {
            const pcm = getSfx(name);
            const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
            // AudioBuffer 的写法在不同实现里略有差异，两种都试
            const channel = typeof buf.getChannelData === 'function'
                ? buf.getChannelData(0)
                : buf;
            if (channel && typeof channel.set === 'function') {
                channel.set(pcm);
            } else if (channel && typeof channel.length === 'number') {
                for (let i = 0; i < pcm.length; i++) {
                    channel[i] = pcm[i];
                }
            }
            this.buffers.set(name, buf);
            return buf;
        } catch (e) {
            return null;
        }
    }

    /**
     * 播放一个音效
     * @param name 音效名
     * @param volumeScale 额外的音量系数（默认 1）
     */
    public play(name: SfxName, volumeScale = 1): void {
        if (this._muted || this._master <= 0) {
            return;
        }
        const ctx = this.ensureContext();
        if (!ctx) {
            return;
        }
        // 某些浏览器/小游戏在后台或未交互时是 suspended，尝试恢复
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            try {
                const r = ctx.resume();
                if (r && typeof (r as any).catch === 'function') {
                    (r as any).catch(() => { /* 忽略 */ });
                }
            } catch (e) {
                // 忽略
            }
        }

        const buf = this.getBuffer(name);
        if (!buf) {
            return;
        }
        try {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const gainValue = Math.min(1, (VOLUME[name] ?? 0.5) * this._master * volumeScale);
            if (typeof ctx.createGain === 'function' && src.connect) {
                const gain = ctx.createGain();
                gain.gain.value = gainValue;
                src.connect(gain);
                gain.connect(ctx.destination);
            } else {
                src.connect(ctx.destination);
            }
            src.start(0);
        } catch (e) {
            // 单个音效播放失败不应影响游戏
        }
    }

    /** 预生成音频缓冲（在加载阶段调用，避免首次播放有延迟） */
    public preload(names: SfxName[]): void {
        for (const n of names) {
            this.getBuffer(n);
        }
    }

    /** 释放资源 */
    public dispose(): void {
        this.buffers.clear();
        try {
            if (this.ctx && typeof (this.ctx as any).close === 'function') {
                (this.ctx as any).close();
            }
        } catch (e) {
            // 忽略
        }
        this.ctx = null;
        this.ctxTried = false;
    }
}
