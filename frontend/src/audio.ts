type AudioSettings = {
  master: number;
  music: number;
  effects: number;
  voice: number;
  voiceLines: boolean;
  muted: boolean;
  haptics: boolean;
};

const storageKey = "whot-audio-settings";
const defaults: AudioSettings = {
  master: 0.96,
  music: 0.58,
  effects: 0.92,
  voice: 0,
  voiceLines: false,
  muted: false,
  haptics: true,
};

let settings: AudioSettings = { ...defaults };
try {
  settings = { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}"), voiceLines: false, voice: 0 };
} catch {
  // Use defaults when local storage is unavailable.
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let effectsGain: GainNode | null = null;
let musicTimer: number | null = null;
let musicStep = 0;

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* ignore */ }
}

function effective(value: number) {
  return settings.muted ? 0 : Math.max(0, Math.min(1, value));
}

function getContext() {
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    musicGain = context.createGain();
    effectsGain = context.createGain();
    musicGain.connect(master);
    effectsGain.connect(master);
    master.connect(context.destination);
    syncGains();
  }
  return context;
}

function duckMusic(duration = 900) {
  if (!musicGain || !context) return;
  const current = musicGain.gain.value;
  const now = context.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(current, now);
  musicGain.gain.linearRampToValueAtTime(current * 0.28, now + 0.05);
  musicGain.gain.linearRampToValueAtTime(settings.music, now + duration / 1000);
}

function syncGains() {
  if (!master || !musicGain || !effectsGain) return;
  master.gain.value = effective(settings.master);
  musicGain.gain.value = effective(settings.music);
  effectsGain.gain.value = effective(settings.effects);
}

async function wake() {
  const ctx = getContext();
  syncGains();
  if (ctx.state === "suspended") await ctx.resume();
}

function envelope(gain: GainNode, start: number, peak: number, duration: number, attack = 0.008) {
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  volume: number,
  destination?: AudioNode,
  startAt?: number,
) {
  const ctx = getContext();
  const target = destination ?? effectsGain!;
  const start = startAt ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  envelope(gain, start, volume, duration);
  osc.connect(gain).connect(target);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function sweep(startFreq: number, endFreq: number, duration: number, volume: number, destination?: AudioNode) {
  const ctx = getContext();
  const target = destination ?? effectsGain!;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
  envelope(gain, ctx.currentTime, volume, duration);
  osc.connect(gain).connect(target);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.03);
}

function noise(duration: number, volume: number, destination?: AudioNode, filterFrequency = 5000) {
  const ctx = getContext();
  const target = destination ?? effectsGain!;
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = "highpass";
  filter.frequency.value = filterFrequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(target);
  source.start();
}

function kick(volume = 0.16) {
  const ctx = getContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(125, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(48, ctx.currentTime + 0.13);
  envelope(gain, ctx.currentTime, volume, 0.16, 0.004);
  osc.connect(gain).connect(musicGain!);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);
}

function bass(note: number, volume = 0.10) {
  const ctx = getContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(note, ctx.currentTime);
  envelope(gain, ctx.currentTime, volume, 0.23, 0.012);
  osc.connect(gain).connect(musicGain!);
  osc.start();
  osc.stop(ctx.currentTime + 0.26);
}

function guitarPluck(note: number, volume = 0.035) {
  const ctx = getContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(note, ctx.currentTime);
  osc.detune.setValueAtTime(-7, ctx.currentTime);
  envelope(gain, ctx.currentTime, volume, 0.17, 0.004);
  osc.connect(gain).connect(musicGain!);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

// An original, synthesized Afrobeat-inspired instrumental groove. It is intentionally
// generated in-browser rather than shipping a copyrighted recording with the game.
function beat() {
  if (settings.muted || !musicGain || !context) return;
  const step = musicStep % 32;

  // Syncopated four-on-the-floor / talking-drum-inspired percussion.
  if ([0, 8, 16, 24].includes(step)) kick(0.19);
  if ([6, 14, 22, 30].includes(step)) kick(0.075);
  if ([4, 12, 20, 28].includes(step)) noise(0.075, 0.105, musicGain, 1600);
  if ([3, 7, 11, 15, 19, 23, 27, 31].includes(step)) noise(0.035, 0.060, musicGain, 6500);
  if ([2, 5, 10, 13, 18, 21, 26, 29].includes(step)) noise(0.028, 0.035, musicGain, 9000);

  // Repeating bassline with small syncopations.
  const bassLine: Record<number, number> = {
    0: 73.42, 3: 73.42, 6: 87.31, 8: 98.00,
    11: 87.31, 14: 73.42, 16: 73.42, 19: 73.42,
    22: 87.31, 24: 98.00, 27: 87.31, 30: 65.41,
  };
  if (bassLine[step]) bass(bassLine[step]);

  // Bright off-beat guitar/marimba-like stabs.
  const plucks: Record<number, number> = {
    2: 293.66, 5: 349.23, 7: 392.00, 10: 293.66,
    13: 349.23, 15: 440.00, 18: 293.66, 21: 349.23,
    23: 392.00, 26: 329.63, 29: 392.00, 31: 493.88,
  };
  if (plucks[step]) guitarPluck(plucks[step]);

  musicStep += 1;
}


function clap(volume = 0.12) {
  noise(0.055, volume, effectsGain!, 1800);
  tone(105, 0.07, "triangle", volume * 0.35);
}

function vibrate(pattern: number | number[]) {
  if (!settings.haptics || typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

export const gameAudio = {
  getSettings() { return { ...settings }; },
  isEnabled() { return !settings.muted; },
  async enable() { settings.muted = false; persist(); await wake(); this.startMusic(); },
  disable() { settings.muted = true; persist(); this.stopMusic(); syncGains(); },
  toggle() { if (settings.muted) void this.enable(); else this.disable(); return !settings.muted; },
  setMaster(value: number) { settings.master = Math.max(0, Math.min(1, value)); persist(); syncGains(); },
  setMusic(value: number) { settings.music = Math.max(0, Math.min(1, value)); persist(); syncGains(); },
  setEffects(value: number) { settings.effects = Math.max(0, Math.min(1, value)); persist(); syncGains(); },
  setVoice(_value: number) { settings.voice = 0; persist(); },
  setVoiceLines(_value: boolean) { settings.voiceLines = false; persist(); },
  setHaptics(value: boolean) { settings.haptics = value; persist(); },
  reset() { settings = { ...defaults }; persist(); syncGains(); if (!settings.muted) void wake(); },
  async startMusic() {
    if (settings.muted) return;
    await wake();
    if (musicTimer !== null) return;
    musicStep = 0;
    beat();
    // 104 BPM, 16th-note pulse.
    musicTimer = window.setInterval(beat, 144);
  },
  stopMusic() { if (musicTimer !== null) window.clearInterval(musicTimer); musicTimer = null; },
  click() { if (!settings.muted) { void wake(); tone(650, 0.06, "sine", 0.055); vibrate(8); } },
  shuffle() { if (!settings.muted) { void wake(); noise(0.16, 0.10); tone(180, 0.14, "triangle", 0.035); } },
  deal() { if (!settings.muted) { void wake(); tone(420, 0.07, "triangle", 0.065); vibrate(8); } },
  slide() { if (!settings.muted) { void wake(); sweep(320, 180, 0.11, 0.055); vibrate(10); } },
  tap() { if (!settings.muted) { void wake(); tone(540, 0.05, "sine", 0.05); } },
  reaction(_text: string, kind = "normal") { if (!settings.muted) { void wake(); if (kind === "strong") { clap(0.18); sweep(180, 90, 0.12, 0.08); vibrate([18, 20, 28]); } else if (kind === "hit") { tone(150, 0.10, "square", 0.07); vibrate([20, 18]); } else if (kind === "win") { [523, 659, 784].forEach((f,i) => window.setTimeout(() => tone(f, 0.13, "triangle", 0.06), i*55)); vibrate([14,18,25]); } else { tone(540, 0.055, "triangle", 0.045); } } },
  slap() { if (!settings.muted) { void wake(); clap(0.18); sweep(240, 95, 0.10, 0.07); vibrate([24, 18, 34]); } },
  combo(amount: number) { if (!settings.muted) { void wake(); const base = 230 + Math.min(4, Math.max(1, amount / 2)) * 70; tone(base, 0.10, "square", 0.075); window.setTimeout(() => tone(base * 1.25, 0.12, "triangle", 0.07), 70); window.setTimeout(() => tone(base * 1.5, 0.16, "triangle", 0.06), 140); vibrate([14, 18]); } },
  wildPause() { if (!settings.muted) { void wake(); sweep(900, 180, 0.36, 0.08); tone(120, 0.30, "sine", 0.045); vibrate(20); } },
  wildChoose() { if (!settings.muted) { void wake(); [392, 494, 587, 784].forEach((f, i) => window.setTimeout(() => tone(f, 0.16, "triangle", 0.065), i * 55)); vibrate([12, 15, 25]); } },
  draw() { if (!settings.muted) { void wake(); noise(0.11, 0.08); sweep(300, 190, 0.09, 0.035); vibrate(14); } },
  turn() { if (!settings.muted) { void wake(); tone(660, 0.11, "triangle", 0.07); window.setTimeout(() => tone(880, 0.14, "triangle", 0.055), 75); } },
  tick() { if (!settings.muted) { void wake(); tone(760, 0.045, "square", 0.032); } },
  invalid() { if (!settings.muted) { void wake(); tone(135, 0.12, "sawtooth", 0.06); vibrate([20, 20, 20]); } },
  card(value: number) {
    if (settings.muted) return;
    void wake();
    if (value === 20) {
      sweep(180, 980, 0.32, 0.11);
      window.setTimeout(() => tone(659.25, 0.22, "triangle", 0.085), 90);
      vibrate([15, 25, 30]);
      return;
    }
    if (value === 2) {
      tone(190, 0.09, "square", 0.075);
      window.setTimeout(() => tone(300, 0.15, "triangle", 0.065), 65);
      vibrate([18, 20]);
      return;
    }
    if ([1, 8, 14].includes(value)) {
      tone(value === 14 ? 175 : 250, 0.10, "square", 0.07);
      window.setTimeout(() => tone(value === 8 ? 480 : 390, 0.14, "triangle", 0.06), 70);
      vibrate([18, 20]);
      return;
    }
    tone(520, 0.065, "sine", 0.04);
    vibrate(10);
  },
  win() {
    if (!settings.muted) {
      void wake();
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => window.setTimeout(() => tone(f, 0.23, "triangle", 0.09), i * 75));
      window.setTimeout(() => sweep(500, 1300, 0.38, 0.06), 220);
      vibrate([25, 30, 50]);
    }
  },
  lose() {
    if (!settings.muted) {
      void wake();
      [392, 330, 261.63].forEach((f, i) => window.setTimeout(() => tone(f, 0.22, "sine", 0.07), i * 110));
      vibrate([35, 30]);
    }
  },
  end() {
    if (!settings.muted) {
      void wake();
      tone(280, 0.13, "triangle", 0.055);
      window.setTimeout(() => tone(220, 0.18, "sine", 0.045), 90);
    }
  },
};
