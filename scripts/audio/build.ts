/**
 * Synthesises the game's sound effects into small mono WAV files under
 * `public/assets/audio/`.
 *
 *   npm run assets:audio
 *
 * Every sound is built from plain oscillators and seeded noise, so the output is the same on
 * every run and there is no third-party audio in the project.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const OUT_DIR = fileURLToPath(new URL('../../public/assets/audio/', import.meta.url));

type Wave = 'sine' | 'triangle' | 'square';

interface Tone {
  /** Start, in seconds from the beginning of the sound. */
  at: number;
  duration: number;
  /** Frequency at the start and the end of the tone; it glides between them. */
  from: number;
  to?: number;
  wave?: Wave;
  gain?: number;
  /** Seconds to reach full level; the rest of the tone decays exponentially. */
  attack?: number;
  decay?: number;
}

interface Noise {
  at: number;
  duration: number;
  gain: number;
  /** One-pole low-pass coefficient: closer to 1 is darker. */
  darkness: number;
  decay: number;
}

function oscillator(wave: Wave, phase: number): number {
  const t = phase - Math.floor(phase);
  if (wave === 'sine') return Math.sin(2 * Math.PI * t);
  if (wave === 'triangle') return 1 - 4 * Math.abs(t - 0.5);
  // A softened square: the first three odd harmonics only, so it never sounds harsh.
  const x = 2 * Math.PI * t;
  return (Math.sin(x) + Math.sin(3 * x) / 3 + Math.sin(5 * x) / 5) * 0.8;
}

function envelope(time: number, duration: number, attack: number, decay: number): number {
  if (time < 0 || time > duration) return 0;
  const rise = attack > 0 ? Math.min(1, time / attack) : 1;
  // A short fade at the very end avoids a click when the tone stops.
  const tail = Math.min(1, (duration - time) / 0.005);
  return rise * Math.exp(-Math.max(0, time - attack) / decay) * tail;
}

function render(length: number, tones: Tone[], noises: Noise[] = []): Float32Array {
  const samples = new Float32Array(Math.ceil(length * SAMPLE_RATE));
  for (const tone of tones) {
    const { at, duration, from, to = from, wave = 'sine', gain = 0.5 } = tone;
    const attack = tone.attack ?? 0.004;
    const decay = tone.decay ?? duration / 3;
    let phase = 0;
    const start = Math.floor(at * SAMPLE_RATE);
    const count = Math.floor(duration * SAMPLE_RATE);
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const progress = i / count;
      const frequency = from * Math.pow(to / from, progress);
      phase += frequency / SAMPLE_RATE;
      const time = i / SAMPLE_RATE;
      samples[start + i]! +=
        oscillator(wave, phase) * gain * envelope(time, duration, attack, decay);
    }
  }
  let seed = 0x2545f491;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (const { at, duration, gain, darkness, decay } of noises) {
    const start = Math.floor(at * SAMPLE_RATE);
    const count = Math.floor(duration * SAMPLE_RATE);
    let filtered = 0;
    for (let i = 0; i < count && start + i < samples.length; i++) {
      filtered = darkness * filtered + (1 - darkness) * (random() * 2 - 1);
      const time = i / SAMPLE_RATE;
      samples[start + i]! += filtered * gain * envelope(time, duration, 0.002, decay);
    }
  }
  return normalise(samples);
}

/** Scales the loudest sample to 0.9 so every file uses the same headroom. */
function normalise(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak === 0) return samples;
  return samples.map((sample) => (sample / peak) * 0.9);
}

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff), i * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, E6: 1318.5 };

const sounds: Record<string, Float32Array> = {
  // A soft tick for the main buttons.
  'ui/click.wav': render(0.06, [
    { at: 0, duration: 0.05, from: 1400, to: 900, wave: 'triangle', decay: 0.012 },
  ]),
  // A light upward hop for a safe landing.
  'game/step.wav': render(0.18, [
    { at: 0, duration: 0.16, from: 440, to: 760, wave: 'triangle', decay: 0.06 },
    { at: 0, duration: 0.1, from: 880, to: 1520, gain: 0.15, decay: 0.03 },
  ]),
  // A muffled thump with a short burst of grit; low, not shrill.
  'game/crash.wav': render(
    0.5,
    [
      { at: 0, duration: 0.4, from: 150, to: 45, gain: 0.9, decay: 0.12 },
      { at: 0.01, duration: 0.25, from: 320, to: 120, wave: 'square', gain: 0.18, decay: 0.06 },
    ],
    [{ at: 0, duration: 0.35, gain: 0.6, darkness: 0.82, decay: 0.08 }],
  ),
  // Two bright notes, like a coin.
  'game/cashout.wav': render(0.42, [
    { at: 0, duration: 0.09, from: NOTE.B5, wave: 'square', gain: 0.35, decay: 0.05 },
    { at: 0.08, duration: 0.34, from: NOTE.E6, wave: 'square', gain: 0.35, decay: 0.12 },
  ]),
  // A rising major arpeggio that lands on a held chord.
  'game/finish.wav': render(1.2, [
    { at: 0, duration: 0.14, from: NOTE.C5, wave: 'triangle', decay: 0.08 },
    { at: 0.11, duration: 0.14, from: NOTE.E5, wave: 'triangle', decay: 0.08 },
    { at: 0.22, duration: 0.14, from: NOTE.G5, wave: 'triangle', decay: 0.08 },
    { at: 0.33, duration: 0.85, from: NOTE.C6, wave: 'triangle', decay: 0.35 },
    { at: 0.33, duration: 0.85, from: NOTE.E5, gain: 0.3, decay: 0.35 },
    { at: 0.33, duration: 0.85, from: NOTE.G5, gain: 0.3, decay: 0.35 },
  ]),
};

for (const [file, samples] of Object.entries(sounds)) {
  const path = join(OUT_DIR, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, wav(samples));
  console.log(`${file}: ${(samples.length / SAMPLE_RATE).toFixed(2)} s`);
}
