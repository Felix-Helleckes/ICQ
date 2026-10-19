"""Soundtrack for one Retrogram promo scene.

The product's own notification sound (public/sounds/icq-message.mp3) is placed on every
"uhoh" event the app logged while rendering; every other noise (window pop, click, key,
send, skin switch) and the whole lo-fi bed are synthesised here with numpy. No third-party
music, no samples from the net.

usage: python audio.py <scene>        (reads $OUT_DIR/<scene>/events.json, writes mix.wav)
"""
import json, math, os, subprocess, sys, wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))   # docs/promo/shorts/src -> repo root
NAME = sys.argv[1]
OUT = os.path.join(os.environ.get("OUT_DIR") or os.path.join(HERE, "out"), NAME)
SR = 44100

meta = json.load(open(os.path.join(OUT, "events.json")))
events = meta["events"]
A = meta.get("audio") or {}
DUR = float(meta["dur"])
N = int(SR * DUR)
rng = np.random.default_rng(int(A.get("seed", 11)))


# --------------------------------------------------------------------------- helpers
def load_audio(path):
    """Decode any file ffmpeg understands into a mono float array at SR."""
    wav = os.path.join(OUT, "_" + os.path.basename(path) + ".wav")
    if not os.path.exists(wav):
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                        "-i", path, "-ac", "1", "-ar", str(SR), wav], check=True)
    with wave.open(wav, "rb") as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return data.astype(np.float64) / 32768.0


def add(buf, start_s, sig, gain=1.0):
    i = int(round(start_s * SR))
    if i >= len(buf):
        return
    if i < 0:
        sig = sig[-i:]
        i = 0
    j = min(len(buf), i + len(sig))
    buf[i:j] += gain * sig[: j - i]


def fft_filter(x, fc, kind="lp", order=4):
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    with np.errstate(divide="ignore"):
        if kind == "lp":
            H = 1 / np.sqrt(1 + (f / fc) ** (2 * order))
        else:
            H = 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-9)) ** (2 * order))
    return np.fft.irfft(X * H, n)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env(length, attack, decay):
    t = np.arange(int(length * SR)) / SR
    return t, (1 - np.exp(-t / attack)) * np.exp(-t / decay)


# --------------------------------------------------------------------------- UI sounds (all synthesised)
def s_pop():
    """A window appearing: a short upward chirp with a soft noise edge."""
    t, e = env(0.20, 0.002, 0.055)
    f = 440 + 1100 * (1 - np.exp(-t / 0.035))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * e
    edge = fft_filter(rng.standard_normal(len(t)), 2600, "hp", 2) * np.exp(-t / 0.012) * 0.35
    return (body * 0.8 + edge) * 0.9


def s_click():
    t, e = env(0.035, 0.0006, 0.009)
    n = fft_filter(rng.standard_normal(len(t)), 2200, "hp", 2)
    return (n * 0.7 + np.sin(2 * np.pi * 1850 * t) * 0.5) * e


def s_key():
    t, e = env(0.022, 0.0004, 0.006)
    n = fft_filter(rng.standard_normal(len(t)), 3400, "hp", 2)
    return n * e


def s_send():
    """Outgoing message: a short rising two-tone, the old modem-ish flick."""
    t, e = env(0.26, 0.004, 0.075)
    a = np.sin(2 * np.pi * 760 * t) * e
    b = np.sin(2 * np.pi * 1140 * t) * np.concatenate([np.zeros(int(0.055 * SR)), e[: len(t) - int(0.055 * SR)]])
    return (a * 0.55 + b * 0.75) * 0.55


def s_skin():
    """Skin switch: a quick filtered sweep."""
    t, e = env(0.42, 0.01, 0.12)
    sweep = fft_filter(rng.standard_normal(len(t)), 900, "lp", 2)
    tone = np.sin(2 * np.pi * (320 + 900 * t / t[-1]) * t)
    return (sweep * 0.5 + tone * 0.35) * e * 0.6


def s_tab():
    t, e = env(0.09, 0.001, 0.022)
    return (np.sin(2 * np.pi * 1200 * t) * 0.6 + np.sin(2 * np.pi * 1800 * t) * 0.3) * e * 0.5


UHOH = load_audio(os.path.join(REPO, "public", "sounds", "icq-message.mp3"))
UHOH = UHOH / (np.max(np.abs(UHOH)) + 1e-9)
# trim the silent head so the sound lands exactly on the event
nz = np.nonzero(np.abs(UHOH) > 0.012)[0]
if len(nz):
    UHOH = UHOH[max(0, nz[0] - 64):]

POP, CLICK, KEY, SEND, SKIN, TAB = s_pop(), s_click(), s_key(), s_send(), s_skin(), s_tab()
GAINS = {"uhoh": 0.92, "pop": 0.40, "click": 0.26, "key": 0.13, "send": 0.46, "skin": 0.38,
         "enter": 0.0, "tab": 0.34, "startup": 0.0, "sound": 0.0}
SIGS = {"uhoh": UHOH, "pop": POP, "click": CLICK, "key": KEY, "send": SEND, "skin": SKIN, "tab": TAB}

fx = np.zeros(N + SR)
counts = {}
for e in events:
    kind = e["kind"]
    counts[kind] = counts.get(kind, 0) + 1
    sig = SIGS.get(kind)
    g = GAINS.get(kind, 0.0)
    if sig is None or g <= 0:
        continue
    add(fx, e["t"] + float(A.get("offset", 0.0)), sig, g * rng.uniform(0.94, 1.0))
fx = fx[:N]

# --------------------------------------------------------------------------- lo-fi bed
PROGS = {
    "A": [([57, 60, 64, 67], 45), ([53, 57, 60, 64], 41), ([55, 60, 64, 71], 36), ([52, 55, 59, 62], 40)],
    "B": [([50, 53, 57, 60], 38), ([46, 50, 53, 57], 34), ([53, 57, 60, 64], 41), ([48, 52, 55, 60], 36)],
    "C": [([52, 55, 59, 62], 40), ([48, 52, 55, 59], 36), ([55, 59, 62, 67], 43), ([50, 54, 57, 62], 38)],
}
music = np.zeros(N + SR)
START = float(A.get("start", 0.0))
i0 = int(START * SR)

if A.get("music", True):
    BPM = float(A.get("bpm", 84))
    BEAT = 60.0 / BPM
    BAR = 4 * BEAT
    chords = PROGS.get(A.get("prog", "A"), PROGS["A"])
    nbars = int(math.ceil((DUR - START) / BAR)) + 1
    kick_times = []

    def rhodes(freq, length, vel):
        t = np.arange(int(length * SR)) / SR
        e = np.exp(-t / 1.4) * (1 - np.exp(-t / 0.004))
        trem = 1 + 0.08 * np.sin(2 * np.pi * 4.3 * t)
        s = (np.sin(2 * np.pi * freq * t)
             + 0.32 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t / 0.5)
             + 0.08 * np.sin(2 * np.pi * 3 * freq * t) * np.exp(-t / 0.25))
        return vel * s * e * trem

    def pad(freqs, length):
        t = np.arange(int(length * SR)) / SR
        out = np.zeros_like(t)
        for f in freqs:
            for det in (-0.004, 0.004):
                ph = 2 * np.pi * f * (1 + det) * t + rng.uniform(0, 6.28)
                out += (2 / np.pi) * np.arcsin(np.sin(ph))
        a = np.minimum(1, t / 0.6)
        r = np.minimum(1, (length - t) / 0.8)
        return out * a * r / len(freqs)

    def bass(freq, length, vel):
        t = np.arange(int(length * SR)) / SR
        e = np.exp(-t / 0.5) * (1 - np.exp(-t / 0.006))
        return vel * (np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)) * e

    kick_t = np.arange(int(0.42 * SR)) / SR
    kick_f = 42 + 110 * np.exp(-kick_t / 0.045)
    kick = np.sin(2 * np.pi * np.cumsum(kick_f) / SR) * np.exp(-kick_t / 0.16) * (1 - np.exp(-kick_t / 0.001))
    snare_t = np.arange(int(0.25 * SR)) / SR
    snare = (fft_filter(rng.standard_normal(len(snare_t)), 1800, "hp", 2) * np.exp(-snare_t / 0.07) * 0.5
             + np.sin(2 * np.pi * 185 * snare_t) * np.exp(-snare_t / 0.045) * 0.6)
    hat_t = np.arange(int(0.08 * SR)) / SR
    hat_base = fft_filter(rng.standard_normal(len(hat_t)), 6500, "hp", 3)

    for b in range(nbars):
        tb = START + b * BAR
        notes, root = chords[b % 4]
        freqs = [midi(n) for n in notes]
        add(music, tb, pad(freqs, BAR + 0.3), 0.050)
        add(music, tb, sum(rhodes(f, 2.6, 0.085) for f in freqs))
        add(music, tb + 2.5 * BEAT, sum(rhodes(f, 1.8, 0.055) for f in freqs))
        add(music, tb, bass(midi(root), 1.4, 0.42))
        add(music, tb + 1.5 * BEAT, bass(midi(root), 0.9, 0.30))
        add(music, tb + 2.75 * BEAT, bass(midi(root + (7 if b % 2 else 0)), 0.9, 0.26))
        for kt in (0, 2, 2.75 if b % 2 == 0 else 3.5):
            add(music, tb + kt * BEAT, kick, 0.85)
            kick_times.append(tb + kt * BEAT)
        for st in (1, 3):
            add(music, tb + st * BEAT, snare, 0.42)
        for h in range(8):
            swing = 0.09 * BEAT if h % 2 else 0.0
            vel = 0.17 if h % 2 == 0 else 0.10
            hat = hat_base * np.exp(-hat_t / (0.028 if h % 2 == 0 else 0.022))
            add(music, tb + h * 0.5 * BEAT + swing, hat, vel * rng.uniform(0.85, 1.0))

    duck = np.ones(len(music))
    for kt in kick_times:
        i = int(kt * SR)
        j = min(len(music), i + int(0.35 * SR))
        tt = np.arange(j - i) / SR
        duck[i:j] *= 1 - 0.38 * np.exp(-tt / 0.14)
    music *= duck

    crackle = np.zeros(len(music))
    idx = rng.integers(0, len(music), size=int(len(music) / SR * 11))
    crackle[idx] = rng.uniform(-1, 1, size=len(idx)) * rng.uniform(0.2, 1.0, size=len(idx))
    crackle = fft_filter(crackle, 3500, "lp", 2)
    hiss = fft_filter(rng.standard_normal(len(music)), 2500, "lp", 2) * 0.006
    music += crackle * 0.045 + hiss
    music = fft_filter(music, 6000, "lp", 2)[:N]

    fade = np.ones(N)
    fade[:i0] = 0
    fi = min(int(0.25 * SR), max(0, N - i0))
    if fi:
        fade[i0:i0 + fi] = np.linspace(0, 1, fi)
    fo = int(1.1 * SR)
    fade[N - fo:] = np.linspace(1, 0, fo) ** 1.5
    music *= fade
    music *= 10 ** (float(A.get("music_db", -15.0)) / 20) / (np.sqrt(np.mean(music[i0:] ** 2)) + 1e-9)
else:
    # quiet cut: room tone only, the product sound carries the clip
    music = fft_filter(rng.standard_normal(N), 1500, "lp", 2) * 0.0025
    fo = int(0.8 * SR)
    music[N - fo:] *= np.linspace(1, 0, fo)

mix = fx + music


def limiter(x, ceiling=0.92, look=64, release_ms=70):
    a = np.abs(x)
    need = np.minimum(1.0, ceiling / np.maximum(a, 1e-9))
    padded = np.concatenate([need, np.ones(look)])
    need = np.lib.stride_tricks.sliding_window_view(padded, look + 1).min(axis=1)[: len(x)]
    g = np.ones(len(x))
    gp = 1.0
    rel = math.exp(-1 / (SR * release_ms / 1000))
    for n in range(len(x)):
        target = need[n]
        gp = target if target < gp else target + (gp - target) * rel
        g[n] = gp
    return x * g


mix = limiter(mix)
print(NAME, "peak", round(float(np.max(np.abs(mix))), 3), "events", counts)

stereo = np.stack([mix, mix], axis=1)
pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
with wave.open(os.path.join(OUT, "mix.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", os.path.join(OUT, "mix.wav"), round(DUR, 2), "s")
