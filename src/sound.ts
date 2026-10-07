// Host sound effects, synthesised with the Web Audio API (no audio files to license or load).
// Browsers only allow audio after a user gesture, so the context is created/resumed on the first click on the host page.
const storageKey = "bkb-sound";
let context: AudioContext | null = null;
let master: GainNode | null = null;

function savedEnabled() { try { return localStorage.getItem(storageKey) !== "off"; } catch { return true; } }
let enabled = savedEnabled();

export function soundEnabled() { return enabled; }
export function setSoundEnabled(next: boolean) { enabled = next; try { localStorage.setItem(storageKey, next ? "on" : "off"); } catch { /* storage blocked: the choice lasts until reload */ } if (next) unlockAudio(); }

export function unlockAudio() {
  if (!context) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    context = new Context();
    master = context.createGain();
    master.gain.value = 0.6;
    master.connect(context.destination);
  }
  if (context.state === "suspended") void context.resume();
}

function ready() { return enabled && context && master && context.state === "running" ? { context, master } : null; }

// One enveloped oscillator note; `glide` slides the pitch to another frequency over the note.
function note(frequency: number, start: number, duration: number, { type = "sine", volume = 0.3, glide }: { type?: OscillatorType; volume?: number; glide?: number } = {}) {
  const audio = ready();
  if (!audio) return;
  const at = audio.context.currentTime + start;
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  if (glide) oscillator.frequency.exponentialRampToValueAtTime(glide, at + duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(audio.master);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.05);
}

// Short filtered noise burst, for snare-like hits in the drum roll.
function noise(start: number, duration: number, volume = 0.2) {
  const audio = ready();
  if (!audio) return;
  const at = audio.context.currentTime + start;
  const buffer = audio.context.createBuffer(1, Math.ceil(audio.context.sampleRate * duration), audio.context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const gain = audio.context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter).connect(gain).connect(audio.master);
  source.start(at);
}

export const sounds = {
  // Rising major arpeggio: the round is on.
  roundStart() { [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => note(frequency, index * 0.09, 0.35, { type: "triangle", volume: 0.28 })); },
  // Clock ticks that get sharper as time runs out: 1 = last 30 s (every other second), 2 = last 10 s, 3 = last 5 s.
  tick(level: 1 | 2 | 3) {
    if (level === 1) note(900, 0, 0.05, { type: "square", volume: 0.06 });
    if (level === 2) note(1200, 0, 0.06, { type: "square", volume: 0.12 });
    if (level === 3) { note(80, 0, 0.18, { volume: 0.5, glide: 50 }); note(80, 0.22, 0.16, { volume: 0.35, glide: 50 }); note(1500, 0, 0.07, { type: "square", volume: 0.14 }); }
  },
  // Round over: a soft bell chord (C–E–G, lightly strummed, long decay) with a faint sparkle on top. Calm and "done", not a losing buzzer.
  roundEnd() {
    [523.25, 659.25, 783.99].forEach((frequency, index) => note(frequency, index * 0.07, 1.6, { volume: 0.16 }));
    note(1046.5, 0.21, 1.2, { volume: 0.06 });
  },
  // Final results: a soft rising blip per revealed place, a drum roll before the winner, then a fanfare.
  reveal(place: number) { note(place <= 3 ? 660 : 440, 0, 0.25, { type: "triangle", volume: 0.22, glide: place <= 3 ? 880 : 550 }); },
  drumRoll(seconds: number) { for (let t = 0; t < seconds; t += 0.06) noise(t, 0.05, 0.05 + (t / seconds) * 0.18); },
  fanfare() { [[523.25, 0], [659.25, 0.15], [783.99, 0.3], [1046.5, 0.45], [783.99, 0.75], [1046.5, 0.9]].forEach(([frequency, start]) => note(frequency, start, 0.5, { type: "triangle", volume: 0.3 })); noise(0.45, 0.6, 0.18); },
};
