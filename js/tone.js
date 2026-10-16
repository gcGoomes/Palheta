// Timbre da guitarra: presets de instrumento e uma pedaleira (distorção, tom, reverb).
//
// O alphaTab mistura todas as faixas num único som estéreo. Para os efeitos pegarem só
// na sua faixa, a MIDI é ajustada antes de tocar (routeMidi): a sua faixa vai toda para
// o canal esquerdo e o resto (banda e metrônomo) para o direito. A saída do alphaTab é
// desviada para cá (hookAlphaTabOutput): o esquerdo passa pela pedaleira, o direito segue
// limpo, e os dois voltam somados no centro. Por isso a banda toca em mono.

// Programas General MIDI (contando do zero).
export const PRESETS = {
  original: { label: 'Original', program: null, drive: 0, tone: 50, reverb: 12 },
  violao: { label: 'Violão', program: 25, drive: 0, tone: 55, reverb: 18 },
  limpo: { label: 'Limpo', program: 27, drive: 0, tone: 50, reverb: 18 },
  crunch: { label: 'Crunch', program: 27, drive: 35, tone: 50, reverb: 14 },
  distorcao: { label: 'Distorção', program: 29, drive: 55, tone: 45, reverb: 12 },
  pesado: { label: 'Pesado', program: 30, drive: 80, tone: 40, reverb: 10 },
};

const SIDE_GAIN = Math.SQRT1_2; // mono → dois lados sem ficar mais alto que o original

function shaperCurve(drive) {
  const k = drive * 60;
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// A distorção deixa o som bem mais alto; isto devolve o volume para perto do limpo
// (calibrado medindo o RMS com sinais de corda em dois volumes de entrada).
export const makeupGain = (drive) => 1 / (1 + 10.8 * drive ** 0.63);

function impulseResponse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const preDelay = Math.floor(rate * 0.015);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / (length - preDelay);
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.5);
    }
  }
  return buffer;
}

// Monta a cadeia de efeitos num AudioContext. Exportada também para testes offline.
export function buildChain(ctx) {
  const biquad = (type, frequency, q = 0.707) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const input = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const output = ctx.createGain();
  input.connect(split);

  // sua faixa (canal esquerdo)
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const highpass = biquad('highpass', 80);
  const low = biquad('lowshelf', 250);
  const high = biquad('highshelf', 2800);
  const cabinet = biquad('lowpass', 18000, 0.8);
  const makeup = ctx.createGain();
  const guitar = ctx.createGain();
  guitar.gain.value = SIDE_GAIN;
  // Cada banco de sons tem um volume próprio; o trim iguala a guitarra entre eles
  // (antes da distorção, para ela reagir igual em qualquer banco).
  const trim = ctx.createGain();
  split.connect(trim, 0);
  trim.connect(shaper);
  shaper.connect(highpass).connect(low).connect(high).connect(cabinet).connect(makeup).connect(guitar);
  guitar.connect(merge, 0, 0);
  guitar.connect(merge, 0, 1);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulseResponse(ctx, 2.2);
  const wet = ctx.createGain();
  wet.gain.value = 0;
  makeup.connect(reverb).connect(wet).connect(output);

  // banda e metrônomo (canal direito)
  const band = ctx.createGain();
  band.gain.value = SIDE_GAIN;
  split.connect(band, 1);
  band.connect(merge, 0, 0);
  band.connect(merge, 0, 1);

  merge.connect(output);

  // medidores para conferir a separação (palheta.tone.levels() no console)
  const meterGuitar = ctx.createAnalyser();
  const meterBand = ctx.createAnalyser();
  const meterTrimmed = ctx.createAnalyser();
  split.connect(meterGuitar, 0);
  split.connect(meterBand, 1);
  trim.connect(meterTrimmed);

  return { input, output, trim, shaper, cabinet, low, high, makeup, wet, meterGuitar, meterBand, meterTrimmed, context: ctx };
}

export function applyParams(chain, { drive, tone, reverb }) {
  const d = drive / 100;
  const now = chain.context.currentTime;
  chain.shaper.curve = shaperCurve(d);
  chain.makeup.gain.setTargetAtTime(makeupGain(d), now, 0.02);
  chain.cabinet.frequency.setTargetAtTime(d > 0 ? 9000 - d * 5000 : 18000, now, 0.02);
  chain.low.gain.setTargetAtTime(((50 - tone) / 50) * 8, now, 0.02);
  chain.high.gain.setTargetAtTime(((tone - 50) / 50) * 8, now, 0.02);
  chain.wet.gain.setTargetAtTime((reverb / 100) * 0.6, now, 0.05);
}

export function createToneEngine() {
  const params = { drive: PRESETS.original.drive, tone: PRESETS.original.tone, reverb: PRESETS.original.reverb };
  const chains = new Map();
  let trim = 1;

  // O alphaTab cria o nó de áudio a cada "Tocar" e o liga direto nos alto-falantes;
  // aqui essa ligação é desviada para a entrada da pedaleira.
  const nativeConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function connect(destination, ...rest) {
    const fromAlphaTab = this instanceof AudioWorkletNode || this instanceof ScriptProcessorNode;
    if (fromAlphaTab && destination instanceof AudioDestinationNode) {
      let chain = chains.get(this.context);
      if (!chain) {
        chain = buildChain(this.context);
        nativeConnect.call(chain.output, this.context.destination);
        applyParams(chain, params);
        chain.trim.gain.value = trim;
        chains.set(this.context, chain);
      }
      return nativeConnect.call(this, chain.input, ...rest);
    }
    return nativeConnect.call(this, destination, ...rest);
  };

  return {
    params,
    set(values) {
      Object.assign(params, values);
      for (const chain of chains.values()) applyParams(chain, params);
    },
    // Ganho de entrada da guitarra para igualar bancos de sons com volumes diferentes.
    setTrim(value) {
      trim = value;
      for (const chain of chains.values()) chain.trim.gain.setTargetAtTime(value, chain.context.currentTime, 0.05);
    },
    // Volume (RMS) de cada lado agora, para conferir que a guitarra está isolada.
    levels() {
      const rms = (analyser) => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        return Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
      };
      const chain = [...chains.values()][0];
      return chain
        ? { guitarra: rms(chain.meterGuitar), banda: rms(chain.meterBand), guitarraAjustada: rms(chain.meterTrimmed) }
        : null;
    },
  };
}

// Ajusta a MIDI gerada pelo alphaTab antes de tocar: sua faixa no canal esquerdo
// (com o instrumento do preset), todo o resto no direito.
export function routeMidi(midi, guitarChannels, program) {
  const M = alphaTab.midi;
  const PAN = M.ControllerType.PanCoarse;
  const events = midi.tracks.flatMap((t) => t.events);
  let maxChannel = 0;
  const panned = new Set();
  const programmed = new Set();
  for (const e of events) {
    if (e.type === M.MidiEventType.NoteOn || e.type === M.MidiEventType.ProgramChange) maxChannel = Math.max(maxChannel, e.channel);
    if (e.type === M.MidiEventType.ControlChange && e.controller === PAN) {
      e.value = guitarChannels.has(e.channel) ? 0 : 127;
      panned.add(e.channel);
    }
    if (e.type === M.MidiEventType.ProgramChange && guitarChannels.has(e.channel)) {
      programmed.add(e.channel);
      if (program != null) e.program = program;
    }
  }
  // O metrônomo usa o canal logo depois do último usado e começa no centro.
  // Só o pan grosso (CC 10 = 127) para em 99,2% e deixa ~-21 dB vazar para o outro lado;
  // o pan fino (CC 42) completa os 100%.
  for (let ch = 0; ch <= maxChannel + 1; ch++) {
    const value = guitarChannels.has(ch) ? 0 : 127;
    if (!panned.has(ch)) midi.addEvent(new M.ControlChangeEvent(0, 0, ch, PAN, value));
    midi.addEvent(new M.ControlChangeEvent(0, 0, ch, M.ControllerType.PanFine, value));
  }
  if (program != null) {
    for (const ch of guitarChannels) {
      if (!programmed.has(ch)) midi.addEvent(new M.ProgramChangeEvent(0, 0, ch, program));
    }
  }
}
