// Som de corda dedilhada (Karplus-Strong) para o dicionário de acordes e o afinador.
// Tem o próprio AudioContext e só usa AudioBufferSourceNode, então não passa pela
// pedaleira (tone.js desvia só os nós do alphaTab) nem mexe no tocador da partitura.

let ctx = null;
let master = null;
const cache = new Map();

function context() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Gera uma vez por nota. O laço de atraso tem tamanho inteiro; a fração que falta para a
// altura exata é corrigida no playbackRate (o afinador de ouvido precisa da nota certa).
function buffer(midi, duration) {
  const key = `${midi}:${duration}`;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const period = Math.max(2, Math.floor(sr / freq - 0.5));
  const len = Math.floor(sr * duration);
  const out = new Float32Array(len);
  const line = new Float32Array(period + 1);
  // ruído suavizado: ataque de palheta, não tão áspero
  let last = 0;
  for (let i = 0; i <= period; i++) {
    last = 0.6 * last + 0.4 * (Math.random() * 2 - 1);
    line[i] = last;
  }
  const t60 = 1.2 + 3.5 * Math.min(1, 110 / freq); // grave soa mais tempo
  const rho = 10 ** (-3 / (t60 * freq));
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const next = (idx + 1) % (period + 1);
    const y = rho * 0.5 * (line[idx] + line[next]);
    out[i] = line[idx];
    line[idx] = y;
    idx = next;
  }
  const fade = Math.min(len, Math.floor(sr * 0.08));
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  const b = ctx.createBuffer(1, len, sr);
  b.copyToChannel(out, 0);
  // o valor escrito volta a ser lido depois de period + 1 amostras, e a média com a vizinha
  // tira meia amostra: o laço soa em sr / (period + 0.5)
  const item = { buffer: b, rate: freq / (sr / (period + 0.5)) };
  cache.set(key, item);
  return item;
}

// midis: alturas MIDI da mais grave para a mais aguda.
// gap: segundos entre uma corda e a próxima (rasgueado curto ou nota por nota).
export function pluck(midis, { gap = 0.035, duration = 2.5, volume = 1 } = {}) {
  const c = context();
  const t0 = c.currentTime + 0.03;
  const gain = volume / Math.sqrt(Math.max(1, midis.length));
  midis.forEach((m, i) => {
    const { buffer: b, rate } = buffer(m, duration);
    const src = c.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start(t0 + i * gap);
  });
}
