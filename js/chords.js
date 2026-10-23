// Dicionário de acordes: entende a cifra (C, F#m, Bb7, C/G…), monta de 3 a 6 formas
// da mais fácil para a mais difícil e confere cada uma pelo mesmo nameShape que dá
// nome aos acordes da tablatura (se a volta não der o mesmo acorde, a forma é descartada).
//
// De onde vêm as formas:
//   1. formas abertas do dicionário (CHORD_LIBRARY em fingering.js);
//   2. formas móveis: pestana no formato de Mi (tônica na 6ª corda), no formato de Lá
//      (tônica na 5ª) e o formato de Ré de 4 cordas; power chords para os acordes "5";
//   3. se ainda faltar (acordes menos comuns e com baixo trocado), uma busca no braço.
import { CHORD_TYPES, nameShape, prettyName, solfege } from './analysis.js';
import { CHORD_LIBRARY, STANDARD_TUNING, assignFingerings, fingeringTips, fixedFingering } from './fingering.js';
import { diagramSVG } from './diagram.js';
import { pluck } from './pluck.js';

const TUNING = STANDARD_TUNING;
const LABELS = ['Mi grave', 'Lá', 'Ré', 'Sol', 'Si', 'Mi aguda'];
export const STRINGS = TUNING.map((pitch, i) => ({ string: i + 1, pitch, name: 'EADGBE'[i], label: LABELS[i] }));

const LETTERS = 'CDEFGAB';
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DEGREE = { 0: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6 };

// Primeiro modelo de cada sufixo em CHORD_TYPES = o acorde completo.
const TYPES = new Map();
for (const [suffix, ivs, desc] of CHORD_TYPES) if (!TYPES.has(suffix)) TYPES.set(suffix, { ivs, desc });

// Jeitos comuns de escrever o mesmo sufixo (inclui os da cifra brasileira: 7M, D4, 7(9)…).
const ALIASES = {
  M: '', maj: '', min: 'm', '-': 'm', mi: 'm',
  M7: 'maj7', '7M': 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', min7: 'm7', '-7': 'm7',
  sus: 'sus4', 4: 'sus4', 2: 'sus2', '7sus': '7sus4', '7(4)': '7sus4', 74: '7sus4', '7(sus4)': '7sus4',
  add2: 'add9', '(add9)': 'add9', '(9)': 'add9', '7(9)': '9', 'm7(9)': 'm9',
  madd9: 'm(add9)', 'm(9)': 'm(add9)', madd2: 'm(add9)',
  '°': 'dim', 'º': 'dim', o: 'dim', '°7': 'dim7', 'º7': 'dim7', o7: 'dim7',
  m7b5: 'm7(b5)', 'm7-5': 'm7(b5)', 'm7(-5)': 'm7(b5)', 'ø': 'm7(b5)', 'ø7': 'm7(b5)',
  '+': 'aug', '#5': 'aug', '(#5)': 'aug', '5+': 'aug',
};

const pcOf = (name) => (LETTER_PC[LETTERS.indexOf(name[0])] + (name[1] === '#' ? 1 : name[1] === 'b' ? 11 : 0)) % 12;

function spell(root, iv) {
  const letter = LETTERS[(LETTERS.indexOf(root[0]) + DEGREE[iv]) % 7];
  let acc = (((pcOf(root) + iv) - LETTER_PC[LETTERS.indexOf(letter)]) % 12 + 12) % 12;
  if (acc > 6) acc -= 12;
  return acc === 0 ? letter : acc === 1 ? `${letter}#` : acc === -1 ? `${letter}b` : null;
}

// Devolve { name, root, suffix, bass, rootPc, bassPc, ivs, pcs, names, desc, notesText, refName } ou null.
export function parseChord(text) {
  const s = String(text).trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '');
  const m = s.match(/^([A-Ga-g])([#b]?)(.*?)(?:\/([A-Ga-g])([#b]?))?$/);
  if (!m) return null;
  const root = m[1].toUpperCase() + m[2];
  let suffix = m[3];
  if (!TYPES.has(suffix)) {
    const norm = suffix.replace(/^maj/i, 'maj').replace(/sus/i, 'sus').replace(/dim/i, 'dim').replace(/add/i, 'add').replace(/aug/i, 'aug');
    suffix = TYPES.has(norm) ? norm : ALIASES[suffix] ?? ALIASES[norm];
  }
  if (suffix == null || !TYPES.has(suffix)) return null;
  const { ivs, desc } = TYPES.get(suffix);
  const rootPc = pcOf(root);
  let bass = m[4] ? m[4].toUpperCase() + m[5] : null;
  if (bass && pcOf(bass) === rootPc) bass = null;
  const bassPc = bass ? pcOf(bass) : rootPc;

  // Grafia das notas do acorde pela letra (Mi maior tem Sol♯, não Lá♭).
  const names = [...(root.includes('b') || root === 'F' ? FLATS : SHARPS)];
  for (const iv of ivs) {
    const n = spell(root, iv);
    if (n) names[(rootPc + iv) % 12] = n;
  }
  if (bass) names[bassPc] = bass;
  names[rootPc] = root;

  const pcs = ivs.map((iv) => (rootPc + iv) % 12);
  const name = root + suffix + (bass ? `/${bass}` : '');
  // Nome que o app dá a essas notas com esse baixo: é com ele que cada forma é conferida.
  const reference = [bassPc + 36, ...pcs.map((pc) => pc + 48)];
  const refName = nameShape(reference, names).name;
  const notesText = pcs.map((pc) => solfege(names[pc])).join(' + ');
  return {
    name, root, suffix, bass, rootPc, bassPc, ivs, pcs, names, refName,
    desc: desc + (bass ? ` com ${solfege(bass)} no baixo` : ''),
    notesText: bass && !pcs.includes(bassPc) ? `${notesText} (baixo: ${solfege(bass)})` : notesText,
  };
}

// Formas móveis: [casas relativas à tônica, dedos], da corda grave para a aguda.
// Nas casas, x = não toca e os números podem ser negativos (casa antes da tônica);
// nos dedos, o dedilhado tradicional de cada forma (0 = sem dedo).
const MOVABLE = {
  E: {
    string: 0,
    label: 'formato de Mi (tônica na 6ª corda)',
    shapes: {
      '': ['0 2 2 1 0 0', '1 3 4 2 1 1'], m: ['0 2 2 0 0 0', '1 3 4 1 1 1'], 7: ['0 2 0 1 0 0', '1 3 1 2 1 1'],
      maj7: ['0 x 1 1 0 x', '1 0 3 4 2 0'], m7: ['0 2 0 0 0 0', '1 3 1 1 1 1'], sus4: ['0 2 2 2 0 0', '1 2 3 4 1 1'],
      '7sus4': ['0 2 0 2 0 0', '1 3 1 4 1 1'], 6: ['0 x -1 1 0 x', '2 0 1 4 3 0'], m6: ['0 x -1 0 0 x', '2 0 1 3 4 0'],
      dim: ['0 1 2 0 x x', '1 2 3 1 0 0'], dim7: ['0 x -1 0 -1 x', '2 0 1 3 1 0'], 'm7(b5)': ['0 x 0 0 -1 x', '2 0 3 4 1 0'],
      aug: ['0 x 2 1 1 x', '1 0 4 2 3 0'], 5: ['0 2 2 x x x', '1 3 4 0 0 0'],
    },
  },
  A: {
    string: 1,
    label: 'formato de Lá (tônica na 5ª corda)',
    shapes: {
      '': ['x 0 2 2 2 0', '0 1 3 3 3 1'], m: ['x 0 2 2 1 0', '0 1 3 4 2 1'], 7: ['x 0 2 0 2 0', '0 1 3 1 4 1'],
      maj7: ['x 0 2 1 2 0', '0 1 3 2 4 1'], m7: ['x 0 2 0 1 0', '0 1 3 1 2 1'], sus2: ['x 0 2 2 0 0', '0 1 3 4 1 1'],
      sus4: ['x 0 2 2 3 0', '0 1 2 3 4 1'], '7sus4': ['x 0 2 0 3 0', '0 1 3 1 4 1'], 6: ['x 0 2 2 2 2', '0 1 3 3 3 3'],
      m6: ['x 0 2 2 1 2', '0 1 3 3 2 4'], 9: ['x 0 -1 0 0 0', '0 2 1 3 3 3'], m9: ['x 0 -2 0 0 x', '0 2 1 3 3 0'],
      dim: ['x 0 1 2 1 x', '0 1 2 4 3 0'], dim7: ['x 0 1 -1 1 x', '0 2 3 1 4 0'], 'm7(b5)': ['x 0 1 0 1 x', '0 2 3 1 4 0'],
      aug: ['x 0 -1 -2 -2 x', '0 3 2 1 1 0'], 5: ['x 0 2 2 x x', '0 1 3 4 0 0'],
    },
  },
  D: {
    string: 2,
    label: 'formato de Ré (tônica na 4ª corda, 4 cordas)',
    shapes: {
      '': ['x x 0 2 3 2', '0 0 1 2 4 3'], m: ['x x 0 2 3 1', '0 0 1 3 4 2'], 7: ['x x 0 2 1 2', '0 0 1 3 2 4'],
      maj7: ['x x 0 2 2 2', '0 0 1 3 3 3'], m7: ['x x 0 2 1 1', '0 0 1 3 2 2'], sus2: ['x x 0 2 3 0', '0 0 1 3 4 1'],
      sus4: ['x x 0 2 3 3', '0 0 1 2 3 4'], 5: ['x x 0 2 3 x', '0 0 1 3 4 0'],
    },
  },
};
// Power chord de 2 cordas: o mais simples de todos.
const POWER2 = [
  ['E', ['0 2 x x x x', '1 3 0 0 0 0']],
  ['A', ['x 0 2 x x x', '0 1 3 0 0 0']],
];

const patternOf = (frets) => frets.map((f) => (f < 0 ? 'x' : f > 9 ? `(${f})` : String(f))).join('');

function makeItem(frets, ch) {
  const notes = [];
  frets.forEach((f, i) => { if (f >= 0) notes.push({ string: i + 1, fret: f, pitch: TUNING[i] + f, dead: false, tied: false }); });
  return { notes, shape: { name: ch.name, desc: ch.desc, notesText: ch.notesText } };
}

// A forma tem exatamente as notas do acorde? (a volta pelo nameShape dá o mesmo nome,
// o baixo é a nota pedida e nenhuma corda solta fora do acorde soa).
export function matches(frets, ch) {
  const pitches = frets.map((f, i) => (f >= 0 ? TUNING[i] + f : null)).filter((p) => p != null);
  if (pitches.length < 2) return false;
  if (Math.min(...pitches) % 12 !== ch.bassPc) return false;
  return nameShape(pitches, ch.names).name === ch.refName;
}

function difficulty(item, frets) {
  const f = item.fingering;
  const played = frets.map((x, i) => (x >= 0 ? i : -1)).filter((i) => i >= 0);
  const interior = played[played.length - 1] - played[0] + 1 - played.length;
  const fretted = item.notes.filter((n) => n.fret > 0).length;
  const open = item.notes.some((n) => n.fret === 0);
  const bigBarre = f.barres.some((b) => b.to - b.from >= 3);
  const miniBarre = f.barres.length && !bigBarre;
  const used = item.notes.filter((n) => n.fret > 0).map((n) => n.fret);
  const span = used.length ? Math.max(...used) - Math.min(...used) : 0;
  return (span > 2 ? (span - 2) * 0.6 : 0) + (f.source === 'library' ? 0 : f.cost) + (bigBarre ? 1.6 : 0) + (miniBarre ? 0.3 : 0) + interior * 0.7
    + fretted * 0.12 + (f.pos ?? 0) * 0.05 + Math.max(0, (f.pos ?? 0) - 7) * 0.15 - (open ? 0.3 : 0)
    + (played.length < 4 ? 0.5 : 0);
}

function describe(cand, item) {
  const open = item.notes.some((n) => n.fret === 0) && (item.fingering.pos ?? 0) <= 4;
  const bigBarre = item.fingering.barres.some((b) => b.to - b.from >= 3);
  const pos = item.fingering.pos ?? Math.min(...item.notes.filter((n) => n.fret > 0).map((n) => n.fret));
  if (cand.power) return cand.power;
  if (open) return 'Aberta';
  if (cand.family) return bigBarre ? `Pestana, ${cand.family}` : cand.family.charAt(0).toUpperCase() + cand.family.slice(1);
  return `${bigBarre ? 'Pestana' : 'Forma'} na ${pos}ª casa`;
}

function movableCandidates(ch) {
  const out = [];
  if (ch.bass) return out;
  const add = ([offsetText, fingerText], stringIdx, extra) => {
    const offsets = offsetText.split(' ').map((o) => (o === 'x' ? null : +o));
    const valid = offsets.filter((o) => o != null);
    let r = (ch.rootPc - TUNING[stringIdx] % 12 + 12) % 12;
    if (r + Math.min(...valid) < 0) r += 12;
    if (r + Math.max(...valid) > 15) return;
    // na 1ª posição a forma vira aberta: aí o dedilhado sai da busca, não do modelo
    const fingers = r > 0 ? fingerText.split(' ').map(Number) : null;
    out.push({ frets: offsets.map((o) => (o == null ? -1 : r + o)), fingers, ...extra });
  };
  for (const fam of Object.values(MOVABLE)) {
    const shape = fam.shapes[ch.suffix];
    if (!shape) continue;
    add(shape, fam.string, ch.suffix === '5'
      ? { power: `Power chord (tônica na ${6 - fam.string}ª corda)` }
      : { family: fam.label });
  }
  if (ch.suffix === '5') {
    for (const [fam, shape] of POWER2) add(shape, MOVABLE[fam].string, { power: `Power chord de 2 cordas (tônica na ${6 - MOVABLE[fam].string}ª corda)` });
  }
  return out;
}

function libraryCandidates() {
  return Object.keys(CHORD_LIBRARY).map((p) => ({ frets: [...p].map((c) => (c === 'x' ? -1 : +c)), library: true }));
}

// Busca no braço, em janelas de 4 casas: só para completar quando faltam formas.
function searchCandidates(ch) {
  const allowed = new Set([...ch.pcs, ch.bassPc]);
  const out = [];
  for (let base = 0; base <= 12; base++) {
    const window = base === 0 ? [0, 1, 2, 3] : [base, base + 1, base + 2, base + 3];
    const opts = TUNING.map((open) => [-1, ...window.filter((f) => allowed.has((open + f) % 12))]);
    const cur = [];
    const rec = (s) => {
      if (s === 6) {
        const played = cur.map((f, i) => (f >= 0 ? i : -1)).filter((i) => i >= 0);
        if (played.length < 3) return;
        if (played[played.length - 1] - played[0] + 1 !== played.length) return; // sem corda abafada no meio
        out.push({ frets: [...cur], search: true });
        return;
      }
      for (const f of opts[s]) { cur[s] = f; rec(s + 1); }
    };
    rec(0);
  }
  return out;
}

const differsIn = (a, b) => a.reduce((n, f, i) => n + (f !== b[i] ? 1 : 0), 0);
// a é a mesma forma que b, só com menos cordas?
const subsetOf = (a, b) => a.every((f, i) => f < 0 || f === b[i]);

function evaluateAll(cands, ch, seen) {
  const out = [];
  for (const c of cands) {
    const key = patternOf(c.frets);
    if (seen.has(key) || !matches(c.frets, ch)) continue;
    seen.add(key);
    const item = makeItem(c.frets, ch);
    assignFingerings([item], TUNING);
    if (item.fingering.source === 'unknown') continue;
    const cost = item.fingering.cost;
    if (c.fingers) {
      const fingers = {};
      c.frets.forEach((f, i) => { if (f > 0 && c.fingers[i]) fingers[i + 1] = c.fingers[i]; });
      item.fingering = { ...fixedFingering(item.notes, fingers, 'template'), cost };
    }
    item.key = key;
    out.push({ ...c, key, item, score: difficulty(item, c.frets) });
  }
  return out;
}

export function chordShapes(ch, { min = 4, max = 6 } = {}) {
  const seen = new Set();
  // dicionário primeiro: a forma aberta mantém o dedilhado "de professor"
  const movable = movableCandidates(ch);
  const picked = evaluateAll([...libraryCandidates(), ...movable], ch, seen);
  // forma do dicionário que também é uma forma móvel (F = pestana formato de Mi) ganha o nome dela
  for (const m of movable) {
    const hit = picked.find((x) => x.library && x.key === patternOf(m.frets));
    if (hit) Object.assign(hit, { family: m.family, power: m.power });
  }
  if (picked.length < min) {
    const found = evaluateAll(searchCandidates(ch), ch, seen).sort((a, b) => a.score - b.score);
    // primeiro as de 4 cordas ou mais (soam mais cheias); as de 3 só se ainda faltar
    const full = found.filter((s) => s.item.notes.length >= 4);
    for (const s of [...full, ...found.filter((x) => !full.includes(x))]) {
      if (picked.length >= min) break;
      if (picked.some((p) => differsIn(p.frets, s.frets) <= 1 || subsetOf(s.frets, p.frets) || subsetOf(p.frets, s.frets))) continue;
      picked.push(s);
    }
  }
  picked.sort((a, b) => a.score - b.score);
  return picked.slice(0, max).map((s) => ({ ...s, label: describe(s, s.item), level: s.score < 1 ? 'fácil' : s.score < 2.4 ? 'média' : 'difícil' }));
}

// Dicas extras que o fingeringTips não dá: cordas que não podem soar.
function muteTips(frets) {
  const tips = [];
  const played = frets.map((f, i) => (f >= 0 ? i : -1)).filter((i) => i >= 0);
  const low = [];
  for (let i = 0; i < played[0]; i++) low.push(LABELS[i]);
  if (low.length) tips.push(`Não toque ${low.length === 1 ? 'a corda' : 'as cordas'} ${low.join(' e ')} (×): comece a palhetada pela corda ${LABELS[played[0]]}.`);
  for (let i = played[0]; i <= played[played.length - 1]; i++) {
    if (frets[i] < 0) tips.push(`A corda ${LABELS[i]} fica no meio e não pode soar: encoste nela, sem apertar, a ponta do dedo da corda de baixo.`);
  }
  const top = played[played.length - 1];
  if (top < 5) tips.push(`${top === 4 ? 'A corda Mi aguda não toca' : `As cordas depois da ${LABELS[top]} não tocam`}: pare a palhetada antes ou encoste a mão nelas.`);
  return tips;
}

const QUICK = ['C', 'D', 'E', 'G', 'A', 'Am', 'Em', 'Dm', 'F', 'Bm', 'A7', 'D7', 'E7', 'G7', 'Cmaj7', 'Am7', 'Dsus4', 'F#m', 'Bb', 'E5', 'C/G'];
const $ = (id) => document.getElementById(id);

export function createChordDictionary({ onOpen }) {
  const dialog = $('chords');
  let shapes = [];

  function render() {
    const text = $('chSearch').value;
    const out = $('chResult');
    if (!text.trim()) {
      shapes = [];
      out.innerHTML = `<p class="sheet-note">Digite a cifra do acorde ou toque num destes:</p>
        <div class="presets">${QUICK.map((c) => `<button class="preset" data-chord="${c}">${prettyName(c)}</button>`).join('')}</div>`;
      return;
    }
    const ch = parseChord(text);
    if (!ch) {
      shapes = [];
      out.innerHTML = '<p class="ch-empty">Não reconheci essa cifra. Exemplos: C, F#m, Bb7, Dsus4, Cmaj7, A5, Em7, C/G.</p>';
      return;
    }
    shapes = chordShapes(ch);
    const alias = ch.refName !== ch.name ? `<p class="sheet-note">Com essas notas, o Palheta também chama este acorde de <b>${prettyName(ch.refName)}</b>.</p>` : '';
    const power = !ch.bass && (ch.suffix === '' || ch.suffix === 'm')
      ? `<p class="sheet-note">No rock, dá para trocar por um power chord (só tônica e quinta, sem a terça): <button class="link" data-chord="${ch.root}5">${prettyName(ch.root)}5</button>.</p>` : '';
    out.innerHTML = `
      <div class="ch-head">
        <b class="ch-name">${prettyName(ch.name)}</b>
        <span>${ch.desc.charAt(0).toUpperCase() + ch.desc.slice(1)} · ${ch.notesText}</span>
      </div>
      ${alias}
      ${shapes.length ? '' : '<p class="ch-empty">Não achei uma forma confortável para esse acorde na afinação padrão.</p>'}
      <div class="ch-grid">${shapes.map((s, i) => `
        <article class="ch-card">
          <header><span class="ch-label">${s.label}</span><span class="ch-level ${s.level === 'fácil' ? 'easy' : s.level === 'média' ? 'mid' : 'hard'}">${s.level}</span></header>
          ${diagramSVG(s.item, STRINGS, { width: 140 })}
          <div class="ch-actions">
            <button class="btn small" data-play="${i}">Ouvir</button>
            <button class="btn small" data-arp="${i}">Nota por nota</button>
          </div>
          <details><summary>Como montar</summary><ul class="tips">${[...fingeringTips(s.item, null, STRINGS), ...muteTips(s.frets)].map((t) => `<li>${t}</li>`).join('')}</ul></details>
        </article>`).join('')}
      </div>
      ${power}
      <p class="sheet-note">Diagramas na afinação padrão (E A D G B E): corda mais grave à esquerda, ○ = corda solta, × = não toca, números = dedos (1 indicador, 2 médio, 3 anelar, 4 mindinho).</p>`;
  }

  function show(chordName = '') {
    $('chSearch').value = chordName;
    render();
  }

  $('chSearch').addEventListener('input', render);
  $('chResult').addEventListener('click', (e) => {
    const chord = e.target.closest('[data-chord]');
    if (chord) { show(chord.dataset.chord); return; }
    const play = e.target.closest('[data-play], [data-arp]');
    if (!play) return;
    const s = shapes[+(play.dataset.play ?? play.dataset.arp)];
    const pitches = s.item.notes.map((n) => n.pitch);
    if (play.dataset.play != null) pluck(pitches, { gap: 0.04, duration: 3 });
    else pluck(pitches, { gap: 0.45, duration: 2.5 });
  });
  $('chClose').addEventListener('click', () => dialog.close());

  return {
    open(chordName = '') {
      onOpen?.();
      show(chordName);
      dialog.showModal();
      if (!chordName) $('chSearch').focus();
    },
    get shapes() { return shapes; },
  };
}
