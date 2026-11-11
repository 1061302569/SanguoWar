"""
程序化合成战棋音效（原创，无版权问题）

由于运行环境的沙箱限制了 shell 对 assets/ 的直接写入，
这个脚本改为：合成音频 -> 输出 base64 -> 由 write 工具写入文件。
脚本本身仍然完整，用于说明音效是怎么来的、也方便你日后调整参数。

用法：
  python tools/gen_sfx.py            # 生成 base64 到 tools/_sfx_b64/ 目录
"""
import os
import base64
import struct
import math
import io
import wave

SR = 22050
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'tools', '_sfx_b64')


def envelope(t, dur, attack=0.02, decay=2.5):
    if t < attack:
        return t / attack
    x = (t - attack) / max(1e-6, dur - attack)
    return math.exp(-decay * x) * max(0.0, 1.0 - x)


def tone(freq, dur, amp=0.6, decay=2.5, slide=0.0, attack=0.02):
    n = int(SR * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        f = freq + slide * t
        phase += 2 * math.pi * f / SR
        env = envelope(t, dur, attack, decay)
        out.append(amp * env * math.sin(phase))
    return out


def noise_burst(dur, amp=0.5, decay=6.0, lowpass=0.35, seed=1):
    n = int(SR * dur)
    out = []
    prev = 0.0
    state = seed
    for i in range(n):
        t = i / SR
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        rnd = (state / 0x7FFFFFFF) * 2.0 - 1.0
        prev = prev + lowpass * (rnd - prev)
        env = envelope(t, dur, 0.001, decay)
        out.append(amp * env * prev)
    return out


def mix(*tracks):
    length = max(len(t) for t in tracks)
    out = [0.0] * length
    for tr in tracks:
        for i, v in enumerate(tr):
            out[i] += v
    return out


def delay_track(track, seconds):
    pad = int(SR * seconds)
    return [0.0] * pad + list(track)


def normalize(samples, peak=0.92):
    m = max(abs(v) for v in samples) or 1.0
    return [v * peak / m for v in samples]


def to_wav_bytes(samples):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b''.join(
            struct.pack('<h', int(max(-1.0, min(1.0, v)) * 32767)) for v in samples
        )
        w.writeframes(frames)
    return buf.getvalue()


def build_clips():
    clips = {}

    # 刀兵相接
    clips['sfx_hit'] = normalize(mix(
        noise_burst(0.16, amp=0.9, decay=9.0, lowpass=0.55, seed=7),
        tone(1800, 0.10, amp=0.35, decay=8.0),
        delay_track(tone(2600, 0.07, amp=0.22, decay=10.0), 0.012),
    ), 0.85)

    # 攻城得手
    clips['sfx_capture'] = normalize(mix(
        tone(110, 0.28, amp=0.85, decay=4.0),
        delay_track(tone(520, 0.30, amp=0.45, decay=3.0, slide=900), 0.03),
        delay_track(noise_burst(0.12, amp=0.35, decay=7.0, lowpass=0.25, seed=3), 0.02),
        delay_track(tone(720, 0.26, amp=0.35, decay=3.5), 0.16),
    ), 0.9)

    # 进攻受挫
    clips['sfx_fail'] = normalize(mix(
        tone(90, 0.24, amp=0.8, decay=5.0),
        noise_burst(0.14, amp=0.45, decay=6.0, lowpass=0.12, seed=11),
    ), 0.8)

    # 界面点击
    clips['sfx_click'] = normalize(mix(
        tone(1500, 0.05, amp=0.5, decay=12.0),
        tone(2100, 0.04, amp=0.25, decay=14.0),
    ), 0.6)

    # 回合更替
    clips['sfx_turn'] = normalize(mix(
        tone(660, 0.42, amp=0.5, decay=3.2),
        delay_track(tone(990, 0.36, amp=0.28, decay=3.6), 0.05),
        delay_track(tone(1320, 0.30, amp=0.15, decay=4.2), 0.10),
    ), 0.75)

    return clips


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    clips = build_clips()
    total = 0
    for name, samples in clips.items():
        data = to_wav_bytes(samples)
        total += len(data)
        b64 = base64.b64encode(data).decode('ascii')
        path = os.path.join(OUT_DIR, name + '.b64')
        with open(path, 'w', encoding='ascii') as f:
            f.write(b64)
        print(f'{name:16s} {len(samples)/SR:5.2f}s  {len(data):6d} bytes  b64 {len(b64):7d} chars')
    print(f'\n合计 {len(clips)} 个音效，{total/1024:.1f} KB')
