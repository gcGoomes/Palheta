// Transforma uma faixa do alphaTab em informação "de professor":
// nome de cada forma, contagem (1 e 2 e…), duração, sentido da palhetada e dedilhado.
import { assignFingerings, fingeringTips, shapeKey } from './fingering.js';

const MIXED = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = { C: 'Dó', D: 'Ré', E: 'Mi', F: 'Fá', G: 'Sol', A: 'Lá', B: 'Si' };

const CHORD_TYPES = [
  ['', [0, 4, 7], 'acorde maior'],
  ['m', [0, 3, 7], 'acorde menor'],
  ['5', [0, 7], 'power chord (tônica + quinta)'],
  ['7', [0, 4, 7, 10], 'maior com sétima'],
  ['7', [0, 4, 10], 'maior com sétima'],
  ['maj7', [0, 4, 7, 11], 'maior com sétima maior'],
  ['maj7', [0, 4, 11], 'maior com sétima maior'],
  ['m7', [0, 3, 7, 10], 'menor com sétima'],
  ['m7', [0, 3, 10], 'menor com sétima'],
  ['sus2', [0, 2, 7], 'suspenso com segunda'],
  ['sus4', [0, 5, 7], 'suspenso com quarta'],
  ['7sus4', [0, 5, 7, 10], 'sétima com quarta suspensa'],
  ['6', [0, 4, 7, 9], 'maior com sexta'],
  ['m6', [0, 3, 7, 9], 'menor com sexta'],
  ['add9', [0, 2, 4, 7], 'maior com nona'],
  ['m(add9)', [0, 2, 3, 7], 'menor com nona'],
  ['9', [0, 2, 4, 7, 10], 'nona'],
  ['m9', [0, 2, 3, 7, 10], 'menor com nona'],
  ['dim', [0, 3, 6], 'diminuto'],
  ['dim7', [0, 3, 6, 9], 'diminuto com sétima'],
  ['m7(b5)', [0, 3, 6, 10], 'meio-diminuto'],
  ['aug', [0, 4, 8], 'aumentado'],
];

const DURATION_NAMES = { 1: 'semibreve', 2: 'mínima', 4: 'semínima', 8: 'colcheia', 16: 'semicolcheia', 32: 'fusa', 64: 'semifusa' };

export function solfege(name, long = false) {
  const base = SOLFEGE[name[0]];
  if (name.length === 1) return base;
  if (long) return base + (name[1] === '#' ? ' sustenido' : ' bemol');
  return base + (name[1] === '#' ? '♯' : '♭');
}

export function prettyName(name) {
  return name.replace(/([A-G])b/g, '$1♭').replace(/#/g, '♯');
}

function pickSpelling(score, staff) {
  const ks = score.masterBars[0]?.keySignature ?? 0;
  if (ks < 0) return FLATS;
  if (ks > 0) return SHARPS;
  let flat = 0, sharp = 0;
  for (const bar of staff.bars)
    for (const v of bar.voices)
      for (const b of v.beats)
        for (const n of b.notes) {
          const pc = n.realValue % 12;
          if (pc === 10 || pc === 3) flat++;
          if (pc === 6) sharp++;
        }
  return flat > sharp ? FLATS : sharp > flat ? SHARPS : MIXED;
}

// Escreve o nome do acorde acima da tablatura sempre que o acorde muda.
// Acordes que o próprio arquivo já nomeia são mantidos.
export function annotateChordNames(score, createChord) {
  for (const track of score.tracks) {
    const staff = track.staves[0];
    if (!staff?.isStringed || !staff.tuning.length) continue;
    const names = pickSpelling(score, staff);
    const count = staff.tuning.length;
    let last = null;
    for (const bar of staff.bars) {
      for (const beat of bar.voices[0]?.beats ?? []) {
        if (beat.isEmpty || beat.isRest || beat.graceType) continue;
        const attacked = beat.notes.filter((n) => !n.isTieDestination && !n.isDead);
        if (beat.notes.length && attacked.length === 0) continue; // nota ligada: o acorde continua
        if (beat.chordId && beat.chord) {
          last = beat.chord.name;
          continue;
        }
        // O alphaTab desenha o nome da seção ("Intro", "Verso"…) na mesma linha e por cima
        // do nome do acorde; no primeiro tempo de uma seção, fica só o nome da seção.
        if (attacked.length < 2 || (bar.masterBar.isSectionStart && beat.index === 0)) {
          last = null;
          continue;
        }
        const name = prettyName(nameShape(attacked.map((n) => n.realValue), names).name);
        if (name === last) continue;
        last = name;
        const chord = createChord();
        chord.name = name;
        chord.showName = true;
        chord.showDiagram = false;
        chord.showFingering = false;
        chord.firstFret = 1;
        chord.strings = staff.tuning.map((_, i) => beat.getNoteOnString(count - i)?.fret ?? -1);
        const id = `gg:${name}:${chord.strings.join('.')}`;
        if (!staff.hasChord(id)) staff.addChord(id, chord);
        beat.chordId = id;
      }
    }
  }
}

export function nameShape(pitches, names) {
  if (!pitches.length) return { name: 'x', desc: 'cordas abafadas (som percussivo)', notesText: '' };
  const sorted = [...pitches].sort((a, b) => a - b);
  const bass = sorted[0] % 12;
  const pcs = [...new Set(sorted.map((p) => p % 12))];
  const notesText = pcs.map((pc) => solfege(names[pc])).join(' + ');
  if (sorted.length === 1) return { name: names[pcs[0]], desc: `nota ${solfege(names[pcs[0]], true)}`, notesText };
  if (pcs.length === 1) return { name: names[pcs[0]], desc: `${solfege(names[pcs[0]], true)} em oitava`, notesText };

  let best = null;
  for (const root of pcs) {
    const ivs = pcs.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b);
    for (const [suffix, tpl, desc] of CHORD_TYPES) {
      if (tpl.length !== ivs.length || !tpl.every((v, i) => v === ivs[i])) continue;
      const score = (root === bass ? 0 : 1) + (tpl.includes(7) ? 0 : 0.5);
      if (!best || score < best.score) best = { root, suffix, desc, score };
    }
  }
  if (!best) return { name: pcs.map((pc) => names[pc]).join('+'), desc: 'grupo de notas', notesText };

  let name = names[best.root] + best.suffix;
  let desc = best.desc;
  if (best.root !== bass) {
    if (best.suffix === '5') desc = 'power chord invertido (intervalo de quarta)';
    else {
      name += '/' + names[bass];
      desc += ` com ${solfege(names[bass])} no baixo`;
    }
  }
  return { name, desc, notesText };
}

export function beatsText(x) {
  const q = Math.round(x * 4) / 4;
  const whole = Math.floor(q);
  const frac = q - whole;
  const fracTxt = { 0: '', 0.25: '¼', 0.5: 'meio', 0.75: '¾' }[frac];
  if (whole === 0) return frac === 0.5 ? 'meio tempo' : `${fracTxt} de tempo`;
  const w = whole === 1 ? '1 tempo' : `${whole} tempos`;
  return frac ? `${w} e ${fracTxt}` : w;
}

function durationName(beat) {
  let s = DURATION_NAMES[beat.duration] ?? 'nota';
  if (beat.dots === 1) s += ' pontuada';
  if (beat.dots === 2) s += ' dupla pontuada';
  if (beat.hasTuplet) s += ` (quiáltera de ${beat.tupletNumerator})`;
  return s;
}

export function countAt(start, beatLen) {
  const beatNo = Math.floor(start / beatLen + 1e-6) + 1;
  const off = start - (beatNo - 1) * beatLen;
  const near = (a, b) => Math.abs(a - b) < 1;
  if (near(off, 0)) return { short: String(beatNo), long: `no tempo ${beatNo}`, onBeat: true };
  if (near(off * 2, beatLen)) return { short: 'e', long: `no "e" do ${beatNo} (contratempo)`, onBeat: false };
  if (near(off * 4, beatLen)) return { short: '·', long: `logo depois do ${beatNo} (semicolcheia)`, onBeat: false };
  if (near(off * 4, 3 * beatLen)) return { short: '·', long: `logo antes do ${beatNo + 1} (semicolcheia)`, onBeat: false };
  if (near(off * 3, beatLen) || near(off * 3, 2 * beatLen)) return { short: '3', long: `na tercina do ${beatNo}`, onBeat: false };
  return { short: '·', long: `entre o ${beatNo} e o ${beatNo + 1}`, onBeat: false };
}

function chooseUnit(starts, beatLen) {
  for (const div of [2, 4, 3, 6, 8]) {
    const u = beatLen / div;
    if (starts.every((s) => Math.abs(s / u - Math.round(s / u)) < 0.01)) return u;
  }
  return beatLen / 4;
}

const pendulumAt = (start, unit) => (Math.round(start / unit) % 2 === 0 ? 'down' : 'up');

function strokeFromTab(beat) {
  if (beat.pickStroke === 2 || beat.brushType === 2) return 'down';
  if (beat.pickStroke === 1 || beat.brushType === 1) return 'up';
  return null;
}

function pendulumWhy(item, unit, dir, fastRiff) {
  const sub = Math.round(item.beatLen / unit);
  const pre = fastRiff ? 'Notas rápidas: alterne seguindo o pêndulo. ' : '';
  if (sub === 2) {
    return pre + (dir === 'down'
      ? 'Nos tempos (1, 2, 3, 4) a mão está descendo.'
      : 'Nos "e" (contratempos) a mão está subindo.')
      + ' Pense num pêndulo: desce no tempo, sobe no "e", sem parar.';
  }
  if (sub === 4) return pre + `Este compasso tem semicolcheias: a mão faz baixo-cima a cada semicolcheia (1 · e ·). Aqui ela está ${dir === 'down' ? 'descendo' : 'subindo'}.`;
  if (sub === 3 || sub === 6) return pre + `Tercinas: alterne baixo e cima a cada nota. Aqui é ${dir === 'down' ? 'para baixo' : 'para cima'}.`;
  return pre + `Siga o vai-e-vem da mão: aqui ela está ${dir === 'down' ? 'descendo' : 'subindo'}.`;
}

// Última forma que usou a mão esquerda (pula cordas soltas e abafadas, até 3 para trás).
function previousFretted(items, item) {
  for (let i = item.id - 1; i >= Math.max(0, item.id - 3); i--) {
    if (items[i].fingering?.pos != null) return items[i];
  }
  return null;
}

export function analyzeTrack(track, opts = {}) {
  const staff = track.staves[0];
  if (!staff || !staff.isStringed || !staff.tuning?.length) {
    return { ok: false, reason: 'Essa faixa não tem tablatura de cordas (pode ser bateria, teclado ou voz). Escolha outra faixa.' };
  }

  const names = pickSpelling(track.score, staff);
  const count = staff.tuning.length;
  const strings = [...staff.tuning].reverse().map((pitch, i) => ({ string: i + 1, pitch, name: names[pitch % 12] }));
  for (const s of strings) {
    const same = strings.filter((o) => o.name === s.name);
    s.label = solfege(s.name);
    if (same.length > 1 && s === same[0]) s.label += ' grave';
    else if (same.length > 1 && s === same[same.length - 1]) s.label += ' aguda';
    s.ordinal = count - s.string + 1;
  }

  const items = [];
  const beatMap = new Map();
  let last = null;
  for (const bar of staff.bars) {
    const voice = bar.voices[0];
    if (!voice) continue;
    const beatLen = 3840 / bar.masterBar.timeSignatureDenominator;
    for (const beat of voice.beats) {
      if (beat.isEmpty) continue;
      const attacked = beat.notes.filter((n) => !n.isTieDestination);
      if (beat.isRest || !attacked.length) {
        beatMap.set(beat.id, { item: null, holdOf: beat.isRest ? null : last, rest: beat.isRest });
        continue;
      }
      const notes = beat.notes.map((n) => ({
        string: n.string, fret: n.fret, pitch: n.realValue,
        tied: n.isTieDestination, dead: n.isDead, finger: n.leftHandFinger,
      }));
      let dur = beat.playbackDuration;
      for (let b = beat.nextBeat; b && b.notes.length && b.notes.every((x) => x.isTieDestination); b = b.nextBeat) {
        dur += b.playbackDuration;
      }
      const item = {
        id: items.length,
        beat,
        barIndex: bar.index,
        start: beat.playbackStart,
        absStart: beat.absolutePlaybackStart,
        beatLen,
        notes,
        key: shapeKey(notes),
        shape: nameShape(notes.filter((x) => !x.dead).map((x) => x.pitch), names),
        count: beat.graceType
          ? { short: '·', long: 'rapidinho, logo antes da nota seguinte (nota de enfeite)', onBeat: false }
          : countAt(beat.playbackStart, beatLen),
        durText: beatsText(dur / beatLen),
        durName: durationName(beat),
        tiedOver: dur > beat.playbackDuration,
        explicitStroke: strokeFromTab(beat),
      };
      items.push(item);
      beatMap.set(beat.id, { item, holdOf: null, rest: false });
      last = item;
    }
  }

  const bars = staff.bars.map((bar) => {
    const mb = bar.masterBar;
    const beatLen = 3840 / mb.timeSignatureDenominator;
    const barItems = items.filter((i) => i.barIndex === bar.index);
    return {
      index: bar.index,
      beatLen,
      barLen: mb.calculateDuration(),
      unit: chooseUnit(barItems.map((i) => i.start), beatLen),
      items: barItems,
      beats: (bar.voices[0]?.beats ?? []).filter((b) => !b.isEmpty),
    };
  });

  const avgNotes = items.reduce((s, i) => s + i.notes.length, 0) / Math.max(1, items.length);
  const autoStrategy = avgNotes <= 2.2 ? 'riff' : 'pendulum';
  const strategy = opts.strategy && opts.strategy !== 'auto' ? opts.strategy : autoStrategy;

  let prev = null;
  for (const it of items) {
    const unit = bars[it.barIndex].unit;
    const pend = pendulumAt(it.start, unit);
    if (it.explicitStroke) {
      it.stroke = it.explicitStroke;
      it.strokeWhy = 'A própria tablatura marca o sentido dessa palhetada.';
    } else if (strategy === 'riff' && (!prev || it.absStart - prev.absStart >= it.beatLen)) {
      it.stroke = 'down';
      it.strokeWhy = (prev
        ? `Passou ${beatsText((it.absStart - prev.absStart) / it.beatLen)} desde a última palhetada: dá tempo de voltar a mão, e no riff a palhetada para baixo dá mais peso.`
        : 'Primeira nota: comece para baixo.')
        + (pend === 'up' ? ' No modo pêndulo ela seria para cima; os dois jeitos funcionam.' : '');
    } else {
      it.stroke = pend;
      it.strokeWhy = pendulumWhy(it, unit, pend, strategy === 'riff');
    }
    prev = it;
  }

  for (const bar of bars) {
    const n = Math.max(1, Math.round(bar.barLen / bar.unit));
    bar.cells = [];
    for (let k = 0; k < n; k++) {
      const start = k * bar.unit;
      const item = bar.items.find((i) => Math.abs(i.start - start) < 1) ?? null;
      const sounding = !item && bar.beats.some((b) => !b.isRest
        && b.playbackStart <= start + 1 && start < b.playbackStart + b.playbackDuration - 1
        && (b.playbackStart < start - 1 || !beatMap.get(b.id)?.item));
      bar.cells.push({
        start,
        label: countAt(start, bar.beatLen).short,
        kind: item ? 'hit' : sounding ? 'hold' : 'rest',
        item,
        ghost: pendulumAt(start, bar.unit),
      });
    }
  }

  assignFingerings(items, strings.map((s) => s.pitch));

  const shapes = [];
  const seen = new Map();
  for (const it of items) {
    if (!seen.has(it.key)) {
      const entry = { key: it.key, item: it, count: 0 };
      seen.set(it.key, entry);
      shapes.push(entry);
    }
    seen.get(it.key).count++;
  }

  return {
    ok: true,
    track,
    strings,
    items,
    bars,
    beatMap,
    shapes,
    strategy,
    autoStrategy,
    tipsFor: (item) => fingeringTips(item, previousFretted(items, item), strings),
    nextOf: (item) => items[item.id + 1] ?? items[0],
  };
}
