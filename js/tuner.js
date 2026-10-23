// Afinador pelo microfone.
//
// O detector (detectPitch) é uma função pura, sem Web Audio, para dar para testar com
// sinais sintéticos. Usa o algoritmo YIN (de Cheveigné e Kawahara, 2002): procura o
// atraso em que o sinal mais se parece com ele mesmo; esse atraso é o período da nota.
// Pegar o PRIMEIRO vale abaixo do limiar (e não o mais fundo) evita cair uma oitava
// abaixo, e a normalização cumulativa evita pular para um harmônico acima.
import { pluck } from './pluck.js';

export const STANDARD = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4, da mais grave para a mais aguda
const STANDARD_LABELS = ['Mi grave', 'Lá', 'Ré', 'Sol', 'Si', 'Mi aguda'];
const NOTE_PT = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const NOTE_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Diferença de cada corda para a afinação padrão (grave → aguda), em semitons.
const KNOWN_TUNINGS = [
  ['0,0,0,0,0,0', 'afinação padrão'],
  ['-1,-1,-1,-1,-1,-1', 'meio tom abaixo'],
  ['-2,-2,-2,-2,-2,-2', 'um tom abaixo'],
  ['-2,0,0,0,0,0', 'Drop D'],
  ['-3,-1,-1,-1,-1,-1', 'Drop C♯ (meio tom abaixo, 6ª corda em Dó♯)'],
  ['-4,-2,-2,-2,-2,-2', 'Drop C (um tom abaixo, 6ª corda em Dó)'],
  ['-2,0,0,0,-2,-2', 'DADGAD'],
  ['-2,-2,0,0,0,-2', 'Sol aberto (Open G)'],
  ['-2,0,0,-1,-2,-2', 'Ré aberto (Open D)'],
  ['0,2,2,1,0,0', 'Mi aberto (Open E)'],
];

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const noteName = (midi) => NOTE_PT[((midi % 12) + 12) % 12];
export const noteCode = (midi) => NOTE_EN[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

export function tuningName(pitches) {
  if (pitches.length !== 6) return null;
  const diff = pitches.map((p, i) => p - STANDARD[i]).join(',');
  return KNOWN_TUNINGS.find(([d]) => d === diff)?.[1] ?? null;
}

// buf: amostras (Float32Array), sampleRate em Hz.
// Devolve { freq, clarity (0–1), rms } ou null quando não há nota clara.
export function detectPitch(buf, sampleRate, { minFreq = 70, maxFreq = 1050, threshold = 0.12, minRms = 0.008 } = {}) {
  const n = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  let power = 0;
  for (let i = 0; i < n; i++) power += (buf[i] - mean) ** 2;
  const rms = Math.sqrt(power / n);
  if (rms < minRms) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(n / 2) - 20);
  const span = Math.max(1, Math.round(tauMax / 25)); // meia largura do ajuste no fim
  const last = tauMax + span + 1;
  const w = n - last;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf[i] - mean;

  // função diferença e sua versão normalizada cumulativa (dp)
  const diff = new Float32Array(last + 1);
  const dp = new Float32Array(last + 1);
  dp[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= last; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const d = x[i] - x[i + tau];
      s += d * d;
    }
    diff[tau] = s;
    running += s;
    dp[tau] = running > 0 ? (s * tau) / running : 1;
  }

  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (dp[t] < threshold) {
      while (t + 1 <= tauMax && dp[t + 1] < dp[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // nenhum vale bem fundo: aceita o melhor só se ele for razoável (nota fraca ou com ruído)
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (dp[t] < dp[best]) best = t;
    if (dp[best] > 0.3) return null;
    tau = best;
  }
  // A curva normalizada escolhe o vale, mas com ruído o fundo dela fica torto e puxa a
  // nota alguns cents; o ponto exato vem da função diferença crua, em volta do mesmo vale.
  const clarity = 1 - dp[tau];
  let best = tau;
  for (let t = Math.max(tauMin, tau - 3); t <= Math.min(tauMax, tau + 3); t++) if (diff[t] < diff[best]) best = t;
  tau = best;
  if (tau <= tauMin || tau >= tauMax) return null;

  // Parábola por mínimos quadrados em volta do vale. Nas notas graves o vale é largo e o
  // ruído mexe em cada ponto; usar vários pontos (proporcional ao período) dá a fração
  // de amostra sem o ponteiro tremer.
  const k = Math.max(1, Math.round(tau / 25));
  let s0 = 0, s2 = 0, s4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (let i = -k; i <= k; i++) {
    const y = diff[tau + i];
    s0++; s2 += i * i; s4 += i ** 4; sy += y; sxy += i * y; sx2y += i * i * y;
  }
  const curv = (s0 * sx2y - s2 * sy) / (s0 * s4 - s2 * s2);
  const slope = sxy / s2;
  const shift = curv > 0 ? Math.max(-k, Math.min(k, -slope / (2 * curv))) : 0;
  const freq = sampleRate / (tau + shift);
  if (freq < minFreq || freq > maxFreq) return null;
  return { freq, clarity, rms };
}

// Sinal parecido com corda de guitarra, para testes: harmônicos que caem com a
// ordem, sem o 5º (palhetada a 1/5 da corda), fundamental mais fraca nas notas
// graves, leve inarmonicidade e ruído.
export function synthString(freq, sampleRate, length, { t0 = 0, noise = 0.02, harmonics = 12, rich = true, seed = 1 } = {}) {
  const out = new Float32Array(length);
  let r = seed >>> 0;
  const rand = () => { // mulberry32
    r = (r + 0x6d2b79f5) >>> 0;
    let z = Math.imul(r ^ (r >>> 15), 1 | r);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    return (((z ^ (z >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const partials = [];
  if (!rich) partials.push([freq, 1, 0]);
  else {
    for (let k = 1; k <= harmonics && k * freq < sampleRate / 2.2; k++) {
      let amp = Math.abs(Math.sin(Math.PI * k * 0.2)) / k;
      if (k === 1 && freq < 120) amp *= 0.4;
      partials.push([k * freq * Math.sqrt(1 + 0.00001 * k * k), amp, k * 1.7]);
    }
  }
  for (let i = 0; i < length; i++) {
    const t = t0 + i / sampleRate;
    let s = 0;
    for (const [f, amp, ph] of partials) s += amp * Math.sin(2 * Math.PI * f * t + ph);
    out[i] = 0.3 * s + noise * rand();
  }
  return out;
}

// Suaviza as leituras: mediana das últimas e média móvel exponencial por cima.
// Uma leitura muito diferente só vale quando se repete (nota nova), senão é descartada.
export function createSmoother({ size = 7, alpha = 0.35 } = {}) {
  let hist = [];
  let jumps = [];
  let value = null;
  let silent = 0;
  const median = (arr) => {
    const s = [...arr].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  return {
    // midi: altura em semitons (com fração) ou null quando não há nota
    push(midi) {
      if (midi == null) {
        if (++silent > 25) { hist = []; jumps = []; value = null; }
        return value;
      }
      silent = 0;
      if (hist.length && Math.abs(midi - median(hist)) > 0.6) {
        jumps = [...jumps, midi].slice(-3);
        const spread = Math.max(...jumps) - Math.min(...jumps);
        if (jumps.length === 3 && spread < 0.6) {
          hist = jumps;
          jumps = [];
          value = median(hist);
        }
        return value;
      }
      jumps = [];
      hist.push(midi);
      if (hist.length > size) hist.shift();
      const m = median(hist);
      value = value == null || Math.abs(m - value) > 0.5 ? m : value + alpha * (m - value);
      return value;
    },
    reset() { hist = []; jumps = []; value = null; silent = 0; },
  };
}

// Corda-alvo: a mais próxima (modo automático) ou a escolhida. Em modo manual um
// harmônico (oitava acima) é dobrado de volta para a corda.
export function targetFor(midi, strings, chosen = null) {
  let index = chosen;
  if (index == null) {
    index = 0;
    strings.forEach((s, i) => { if (Math.abs(midi - s.pitch) < Math.abs(midi - strings[index].pitch)) index = i; });
  }
  let cents = (midi - strings[index].pitch) * 100;
  if (chosen != null) while (Math.abs(cents) > 600) cents -= Math.sign(cents) * 1200;
  return { index, cents };
}

export function adviceFor(cents) {
  if (Math.abs(cents) <= 5) return { tone: 'ok', text: 'Afinada! Pode passar para a próxima corda.' };
  const much = Math.abs(cents) > 30;
  if (cents < 0) return { tone: 'low', text: much ? 'Está baixa: suba a afinação (aperte a corda), girando a tarraxa devagar.' : 'Quase: suba só um pouquinho (aperte a corda).' };
  return { tone: 'high', text: much ? 'Está alta: desça a afinação (afrouxe a corda), girando a tarraxa devagar.' : 'Quase: desça só um pouquinho (afrouxe a corda).' };
}

const $ = (id) => document.getElementById(id);
const FRAME = 4096;
const TICK_MS = 50; // setInterval: o requestAnimationFrame para quando a janela está escondida
const STABLE_TICKS = 8;

export function createTuner({ getSongStrings, onOpen }) {
  const dialog = $('tuner');
  const smoother = createSmoother();
  const st = { tuning: 'padrao', chosen: null, lastTarget: 0, stable: 0, provider: null, stream: null, ctx: null, timer: null, simT: 0 };

  const standardStrings = () => STANDARD.map((pitch, i) => ({ pitch, label: STANDARD_LABELS[i] }));
  const songStrings = () => {
    const ss = getSongStrings();
    if (!ss?.length) return null;
    const pitches = ss.map((s) => s.pitch);
    if (pitches.join() === STANDARD.join()) return null;
    return ss.map((s) => ({ pitch: s.pitch, label: s.label }));
  };
  const strings = () => (st.tuning === 'musica' && songStrings()) || standardStrings();

  function renderTunings() {
    const song = songStrings();
    if (!song) st.tuning = 'padrao';
    const name = song && tuningName(song.map((s) => s.pitch));
    $('tuTunings').hidden = !song;
    $('tuTunings').innerHTML = song ? `
      <button data-tuning="padrao" class="${st.tuning === 'padrao' ? 'active' : ''}">Padrão (E A D G B E)</button>
      <button data-tuning="musica" class="${st.tuning === 'musica' ? 'active' : ''}">Afinação desta música${name ? `: ${name}` : ''}</button>` : '';
  }

  function renderStrings() {
    const ss = strings();
    $('tuStrings').innerHTML = [
      `<button data-string="auto" class="${st.chosen == null ? 'active' : ''}">Automático</button>`,
      ...ss.map((s, i) => `<button data-string="${i}" class="${st.chosen === i ? 'active' : ''}"><b>${s.label}</b><small>${noteCode(s.pitch)}</small></button>`),
    ].join('');
    const ref = ss[st.chosen ?? st.lastTarget] ?? ss[0];
    $('tuRef').textContent = `Ouvir ${ref.label}`;
  }

  function show(midi) {
    const display = $('tuDisplay');
    if (midi == null) {
      display.className = 'tu-display idle';
      $('tuNote').textContent = '–';
      $('tuDetail').textContent = st.chosen == null ? 'Toque uma corda solta' : `Toque a corda ${strings()[st.chosen].label} solta`;
      $('tuNeedle').style.setProperty('--cents', 0);
      $('tuCents').textContent = '';
      $('tuInstr').textContent = '';
      st.stable = 0;
      return;
    }
    const ss = strings();
    const t = targetFor(midi, ss, st.chosen);
    if (t.index !== st.lastTarget && st.chosen == null) {
      st.lastTarget = t.index;
      renderStrings();
    }
    const near = Math.round(midi);
    const advice = adviceFor(t.cents);
    st.stable = advice.tone === 'ok' ? st.stable + 1 : 0;
    const ok = st.stable >= STABLE_TICKS;
    display.className = `tu-display ${ok ? 'ok' : advice.tone === 'ok' ? 'near' : advice.tone}`;
    $('tuNote').textContent = noteName(near);
    $('tuDetail').textContent = `${noteCode(near)} · ${midiToFreq(midi).toFixed(1).replace('.', ',')} Hz · corda ${ss[t.index].label} (${noteCode(ss[t.index].pitch)})`;
    $('tuNeedle').style.setProperty('--cents', Math.max(-50, Math.min(50, t.cents)).toFixed(1));
    const c = Math.round(t.cents);
    $('tuCents').textContent = Math.abs(t.cents) > 50 ? (c < 0 ? 'muito baixa' : 'muito alta') : `${c > 0 ? '+' : ''}${c} cents`;
    $('tuInstr').textContent = ok ? 'Afinada' : advice.tone === 'ok' ? 'Segure a nota…' : advice.text;
  }

  function tick() {
    if (!st.provider) return;
    const { buf, sampleRate } = st.provider();
    const lowest = Math.min(...strings().map((s) => s.pitch));
    const r = detectPitch(buf, sampleRate, { minFreq: Math.min(70, midiToFreq(lowest) * 0.8) });
    show(smoother.push(r ? freqToMidi(r.freq) : null));
  }

  function setProvider(provider) {
    st.provider = provider;
    smoother.reset();
    clearInterval(st.timer);
    st.timer = provider ? setInterval(tick, TICK_MS) : null;
    show(null);
  }

  function status(text, isError = false) {
    $('tuStatus').textContent = text;
    $('tuStatus').classList.toggle('error', isError);
  }

  async function startMic() {
    stopMic();
    if (!navigator.mediaDevices?.getUserMedia) {
      status('Este navegador não deixa usar o microfone aqui. O microfone só funciona em páginas https (como o site no GitHub Pages) ou em localhost; abra o Palheta por um desses endereços.', true);
      $('tuMic').hidden = false;
      return;
    }
    status('Pedindo o microfone…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!dialog.open) { stream.getTracks().forEach((t) => t.stop()); return; }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FRAME;
      ctx.createMediaStreamSource(stream).connect(analyser); // não liga nos alto-falantes
      st.stream = stream;
      st.ctx = ctx;
      const buf = new Float32Array(FRAME);
      setProvider(() => { analyser.getFloatTimeDomainData(buf); return { buf, sampleRate: ctx.sampleRate }; });
      $('tuMic').hidden = true;
      status('Microfone ligado. Toque uma corda solta de cada vez e deixe soar. Ao fechar o afinador, o microfone é desligado.');
    } catch (err) {
      $('tuMic').hidden = false;
      $('tuMic').textContent = 'Tentar de novo';
      const name = err?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        status('O microfone não foi liberado. Toque no cadeado (ou no ícone de microfone) ao lado do endereço do site, escolha "Permitir" para o microfone e toque em "Tentar de novo". Enquanto isso, dá para afinar de ouvido com o botão "Ouvir".', true);
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        status('Não encontrei nenhum microfone. Ligue um (ou use o celular, que já tem) e toque em "Tentar de novo". Dá para afinar de ouvido com o botão "Ouvir".', true);
      } else if (name === 'NotReadableError') {
        status('O microfone está ocupado por outro programa (uma chamada de vídeo, por exemplo). Feche o outro programa e toque em "Tentar de novo".', true);
      } else {
        status(`Não consegui ligar o microfone (${name || 'erro desconhecido'}). Dá para afinar de ouvido com o botão "Ouvir".`, true);
      }
    }
  }

  function stopMic() {
    setProvider(null);
    st.stream?.getTracks().forEach((t) => t.stop());
    st.ctx?.close();
    st.stream = null;
    st.ctx = null;
  }

  $('tuStrings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-string]');
    if (!b) return;
    st.chosen = b.dataset.string === 'auto' ? null : +b.dataset.string;
    if (st.chosen != null) st.lastTarget = st.chosen;
    smoother.reset();
    renderStrings();
    show(null);
  });
  $('tuTunings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tuning]');
    if (!b) return;
    st.tuning = b.dataset.tuning;
    renderTunings();
    renderStrings();
  });
  $('tuRef').addEventListener('click', () => {
    const s = strings()[st.chosen ?? st.lastTarget];
    if (s) pluck([s.pitch], { duration: 3.5 });
  });
  $('tuMic').addEventListener('click', startMic);
  // desliga já no Fechar e no Esc: o evento close pode atrasar com a aba em segundo plano
  $('tuClose').addEventListener('click', () => { stopMic(); dialog.close(); });
  dialog.addEventListener('cancel', stopMic);
  dialog.addEventListener('close', stopMic);

  return {
    open() {
      onOpen?.();
      st.chosen = null;
      st.lastTarget = 0;
      renderTunings();
      renderStrings();
      $('tuMic').hidden = true;
      dialog.showModal();
      show(null);
      startMic();
    },
    // Para testes sem microfone: alimenta o afinador com uma corda sintética (null = silêncio).
    simulate(freq, opts = {}) {
      stopMic();
      const sampleRate = 48000;
      st.simT = 0;
      setProvider(() => {
        const buf = freq ? synthString(freq, sampleRate, FRAME, { t0: st.simT, seed: Math.floor(st.simT * 1000) + 7, ...opts }) : new Float32Array(FRAME);
        st.simT += TICK_MS / 1000;
        return { buf, sampleRate };
      });
    },
    get state() { return st; },
  };
}
