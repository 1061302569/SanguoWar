/**
 * 音效波形合成
 *
 * 为什么用「运行时合成」而不是音频文件：
 *   1. 占位音效不需要真实录音资源，合成能把包体体积压到 0；
 *   2. 波形参数全部写在代码里，日后调音色不用重新导资源；
 *   3. 纯函数、不碰任何平台 API，因此可以脱离引擎直接跑单元测试。
 *
 * 输出是单声道 Float32 PCM（-1..1），交给 AudioPlayer 用 WebAudio 播放。
 * 采样率固定 22050Hz：战棋音效都是短促打击音，这个采样率足够且省内存。
 */

/** 输出采样率 */
export const SAMPLE_RATE = 22050;

/** 音效种类 */
export type SfxName = 'hit' | 'capture' | 'fail' | 'click' | 'turn';

/** 用可插拔的随机源，保证测试可复现 */
let _rand = Math.random;

/** 注入随机源（测试用） */
export function setSfxRandom(fn: () => number): void {
    _rand = fn;
}

/** 攻击-衰减包络 */
function envelope(t: number, dur: number, attack: number, decay: number): number {
    if (t < attack) {
        return t / attack;
    }
    const x = (t - attack) / Math.max(1e-6, dur - attack);
    return Math.exp(-decay * x) * Math.max(0, 1 - x);
}

/** 单音：可带频率滑动（slide 单位为 Hz/秒） */
export function tone(
    freq: number, dur: number, amp = 0.6, decay = 2.5, slide = 0, attack = 0.02,
): Float32Array {
    const n = Math.max(1, Math.floor(SAMPLE_RATE * dur));
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        phase += (2 * Math.PI * (freq + slide * t)) / SAMPLE_RATE;
        out[i] = amp * envelope(t, dur, attack, decay) * Math.sin(phase);
    }
    return out;
}

/** 噪声爆发：模拟金属撞击、闷响，带一阶低通 */
export function noiseBurst(
    dur: number, amp = 0.5, decay = 6, lowpass = 0.35,
): Float32Array {
    const n = Math.max(1, Math.floor(SAMPLE_RATE * dur));
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        // 白噪声源，用可注入的随机数保证测试可复现
        const rnd = _rand() * 2 - 1;
        prev += lowpass * (rnd - prev);
        out[i] = amp * envelope(t, dur, 0.001, decay) * prev;
    }
    return out;
}

/** 叠加多条音轨，长度取最长 */
export function mix(...tracks: Float32Array[]): Float32Array {
    let length = 0;
    for (const t of tracks) {
        length = Math.max(length, t.length);
    }
    const out = new Float32Array(length);
    for (const t of tracks) {
        for (let i = 0; i < t.length; i++) {
            out[i] += t[i];
        }
    }
    return out;
}

/** 给音轨加上时间延迟（用于制作回声/层次） */
export function delay(track: Float32Array, seconds: number): Float32Array {
    const pad = Math.floor(SAMPLE_RATE * seconds);
    const out = new Float32Array(track.length + pad);
    out.set(track, pad);
    return out;
}

/** 归一化到指定峰值，避免削波失真 */
export function normalize(samples: Float32Array, peak = 0.9): Float32Array {
    let max = 0;
    for (let i = 0; i < samples.length; i++) {
        const v = Math.abs(samples[i]);
        if (v > max) {
            max = v;
        }
    }
    if (max <= 0) {
        return samples;
    }
    const k = peak / max;
    for (let i = 0; i < samples.length; i++) {
        samples[i] *= k;
    }
    return samples;
}

/**
 * 生成指定音效的 PCM 数据
 *
 * 各音效的音色设计：
 *   hit     —— 刀兵相接：高频噪声 + 两个金属泛音
 *   capture —— 攻城得手：低鼓 + 上扬号角 + 高音点缀（胜利感）
 *   fail    —— 进攻受挫：低频闷响 + 弱噪声（挫败感）
 *   click   —— 界面点击：极短的双高频（清脆）
 *   turn    —— 回合更替：钟磬三音叠加（余韵）
 */
export function synthesize(name: SfxName): Float32Array {
    switch (name) {
        case 'hit':
            return normalize(mix(
                noiseBurst(0.16, 0.9, 9.0, 0.55),
                tone(1800, 0.10, 0.35, 8.0),
                delay(tone(2600, 0.07, 0.22, 10.0), 0.012),
            ), 0.85);

        case 'capture':
            return normalize(mix(
                tone(110, 0.28, 0.85, 4.0),
                delay(tone(520, 0.30, 0.45, 3.0, 900), 0.03),
                delay(noiseBurst(0.12, 0.35, 7.0, 0.25), 0.02),
                delay(tone(720, 0.26, 0.35, 3.5), 0.16),
            ), 0.9);

        case 'fail':
            return normalize(mix(
                tone(90, 0.24, 0.8, 5.0),
                noiseBurst(0.14, 0.45, 6.0, 0.12),
            ), 0.8);

        case 'click':
            return normalize(mix(
                tone(1500, 0.05, 0.5, 12.0),
                tone(2100, 0.04, 0.25, 14.0),
            ), 0.6);

        case 'turn':
            return normalize(mix(
                tone(660, 0.42, 0.5, 3.2),
                delay(tone(990, 0.36, 0.28, 3.6), 0.05),
                delay(tone(1320, 0.30, 0.15, 4.2), 0.10),
            ), 0.75);

        default:
            // 未知音效返回一个极短静音，调用方不会因空指针崩
            return new Float32Array(Math.floor(SAMPLE_RATE * 0.01));
    }
}

/** 带缓存的合成：同一种音效只算一次 */
const _cache = new Map<SfxName, Float32Array>();

/** 取音效 PCM（首次调用时合成并缓存） */
export function getSfx(name: SfxName): Float32Array {
    let pcm = _cache.get(name);
    if (!pcm) {
        pcm = synthesize(name);
        _cache.set(name, pcm);
    }
    return pcm;
}

/** 清空缓存（测试用） */
export function clearSfxCache(): void {
    _cache.clear();
}

/** 音效时长（秒），用于测试与调试 */
export function sfxDuration(name: SfxName): number {
    return getSfx(name).length / SAMPLE_RATE;
}
