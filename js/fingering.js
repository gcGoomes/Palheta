// Escolhe qual dedo da mão esquerda vai em cada nota.
//
// Ordem de preferência:
//   1. dedilhado que já vem escrito no arquivo (Guitar Pro permite anotar);
//   2. dicionário de acordes abertos comuns (o jeito "de professor");
//   3. busca heurística: testa todas as combinações de dedos, pontua cada uma
//      (esticar, pestana, usar o mindinho...) e escolhe a melhor sequência
//      para a música inteira, evitando pular a mão de um lado pro outro.

export const FINGER_NAMES = { 1: 'indicador', 2: 'médio', 3: 'anelar', 4: 'mindinho' };

const STANDARD_TUNING = [40, 45, 50, 55, 59, 64]; // da corda mais grave para a mais aguda

// padrão de casas (grave → aguda) : dedos (grave → aguda). x = não toca, 0 = solta.
const CHORD_LIBRARY = {
  'x32010': 'x32010', // C
  'x02220': 'x01230', // A
  '320003': '210003', // G
  '320033': '210034', // G (com o mindinho)
  '022100': '023100', // E
  'xx0232': 'xx0132', // D
  'x02210': 'x02310', // Am
  '022000': '023000', // Em
  'xx0231': 'xx0231', // Dm
  '020100': '020100', // E7
  'x02020': 'x02030', // A7
  'xx0212': 'xx0213', // D7
  '320001': '320001', // G7
  'x32310': 'x32410', // C7
  'x21202': 'x21304', // B7
  'x02010': 'x02010', // Am7
  '020000': '020000', // Em7
  'xx3211': 'xx3211', // F (pequeno)
  '133211': '134211', // F (pestana)
  'x24432': 'x13421', // Bm (pestana)
  'x13331': 'x13331', // Bb (pestana)
  'xx0233': 'xx0134', // Dsus4
  'xx0230': 'xx0130', // Dsus2
  'x02200': 'x01200', // Asus2
  'x32033': 'x21034', // Cadd9
  'xx3210': 'xx3210', // Fmaj7
};

const FINGER_COST = { 1: 0, 2: 0, 3: 0.1, 4: 0.35 };
const BARRE_BASE = { 1: 0.4, 2: 0.9, 3: 0.6, 4: 0.9 };
const BARRE_PER_STRING = { 1: 0.15, 2: 0.4, 3: 0.35, 4: 0.6 };

const isFretted = (n) => n.fret > 0 && !n.dead;

export function shapeKey(notes) {
  return notes
    .map((n) => `${n.string}:${n.dead ? 'x' : n.fret}`)
    .sort()
    .join(' ');
}

function barresFrom(notes, fingers) {
  const byFinger = new Map();
  for (const n of notes.filter(isFretted)) {
    const f = fingers[n.string];
    if (!f) continue;
    if (!byFinger.has(f)) byFinger.set(f, []);
    byFinger.get(f).push(n);
  }
  const barres = [];
  for (const [finger, ns] of byFinger) {
    if (ns.length < 2) continue;
    const strings = ns.map((n) => n.string);
    barres.push({ finger, fret: ns[0].fret, from: Math.min(...strings), to: Math.max(...strings) });
  }
  return barres;
}

function handPosition(fretted, fingerOf) {
  const natural = fretted.map((n) => n.fret - fingerOf(n) + 1).sort((a, b) => a - b);
  return Math.max(1, natural[Math.floor((natural.length - 1) / 2)]);
}

function fromFile(notes) {
  const fretted = notes.filter(isFretted);
  if (!fretted.length) return null;
  if (!fretted.every((n) => n.finger >= 1 && n.finger <= 4)) return null;
  const fingers = Object.fromEntries(fretted.map((n) => [n.string, n.finger]));
  return {
    fingers,
    barres: barresFrom(notes, fingers),
    pos: handPosition(fretted, (n) => n.finger),
    cost: 0,
    source: 'tab',
  };
}

function fromLibrary(notes, tuning) {
  if (tuning.length !== 6 || tuning.some((p, i) => p !== STANDARD_TUNING[i])) return null;
  if (notes.length < 3 || notes.some((n) => n.dead)) return null;
  let pattern = '';
  for (let s = 1; s <= 6; s++) {
    const n = notes.find((x) => x.string === s);
    pattern += n ? (n.fret > 9 ? '?' : String(n.fret)) : 'x';
  }
  const fingerPattern = CHORD_LIBRARY[pattern];
  if (!fingerPattern) return null;
  const fingers = {};
  for (let s = 1; s <= 6; s++) {
    const f = Number(fingerPattern[s - 1]);
    if (f >= 1) fingers[s] = f;
  }
  const fretted = notes.filter(isFretted);
  return {
    fingers,
    barres: barresFrom(notes, fingers),
    pos: fretted.length ? handPosition(fretted, (n) => fingers[n.string]) : null,
    cost: 0,
    source: 'library',
  };
}

function evaluate(notes, fretted, assign) {
  // Dedo de número menor nunca fica numa casa mais alta que um dedo de número maior.
  // Mesmo dedo em duas notas só se for na mesma casa (pestana).
  for (let i = 0; i < fretted.length; i++) {
    for (let j = i + 1; j < fretted.length; j++) {
      const fa = assign[i], fb = assign[j];
      const ra = fretted[i].fret, rb = fretted[j].fret;
      if (fa === fb) {
        if (ra !== rb) return null;
      } else if ((fa < fb && ra > rb) || (fa > fb && ra < rb)) {
        return null;
      }
    }
  }
  const frets = fretted.map((n) => n.fret);
  if (Math.max(...frets) - Math.min(...frets) > 4) return null;

  const fingers = {};
  fretted.forEach((n, i) => { fingers[n.string] = assign[i]; });
  const barres = barresFrom(notes, fingers);

  let cost = 0;
  for (const f of new Set(assign)) cost += FINGER_COST[f];
  for (const b of barres) {
    // a pestana não pode passar por cima de corda solta ou de casa mais baixa que precisa soar
    const blocked = notes.some((n) => !n.dead && n.string > b.from && n.string < b.to && n.fret < b.fret);
    if (blocked) return null;
    cost += BARRE_BASE[b.finger] + (b.to - b.from - 1) * BARRE_PER_STRING[b.finger];
  }

  const pos = handPosition(fretted, (n) => fingers[n.string]);
  fretted.forEach((n, i) => {
    const d = n.fret - (pos + assign[i] - 1);
    cost += d > 0 ? d * 0.9 : -d * 0.5; // esticar custa mais que apertar
  });
  return { fingers, barres, pos, cost, source: 'auto' };
}

function heuristicCandidates(notes) {
  const fretted = notes.filter(isFretted);
  if (!fretted.length) return [{ fingers: {}, barres: [], pos: null, cost: 0, source: 'open' }];
  const out = [];
  const assign = new Array(fretted.length);
  const rec = (i) => {
    if (i === fretted.length) {
      const c = evaluate(notes, fretted, assign);
      if (c) out.push(c);
      return;
    }
    for (let f = 1; f <= 4; f++) {
      assign[i] = f;
      rec(i + 1);
    }
  };
  rec(0);
  if (!out.length) {
    // Nenhuma mão alcança (abertura grande demais, ou parte de teclado/voz escrita em tab).
    const pos = Math.max(1, Math.min(...fretted.map((n) => n.fret)));
    return [{ fingers: {}, barres: [], pos, cost: 5, source: 'unknown' }];
  }
  out.sort((a, b) => a.cost - b.cost);
  return out.slice(0, 12);
}

function relativeKey(notes, fingering) {
  if (fingering.pos == null) return null;
  return notes
    .filter(isFretted)
    .map((n) => `${n.string}:${n.fret - fingering.pos}:${fingering.fingers[n.string]}`)
    .sort()
    .join(' ');
}

// items: lista na ordem da música, cada um com .notes [{string, fret, dead, finger}]
// Grava item.fingering em cada um.
export function assignFingerings(items, tuning) {
  const cache = new Map();
  const cands = items.map((it) => {
    const fixed = fromFile(it.notes) || fromLibrary(it.notes, tuning);
    if (fixed) return [fixed];
    const key = shapeKey(it.notes);
    if (!cache.has(key)) cache.set(key, heuristicCandidates(it.notes));
    return cache.get(key);
  });

  // Viterbi só sobre as formas que usam a mão esquerda; cordas soltas deixam a mão livre.
  const steps = [];
  let openSince = false;
  items.forEach((it, i) => {
    if (cands[i][0].pos == null) {
      it.fingering = cands[i][0];
      openSince = true;
      return;
    }
    steps.push({ i, freeBefore: openSince });
    openSince = false;
  });
  if (!steps.length) return;

  const dp = [];
  const back = [];
  steps.forEach((st, t) => {
    const cs = cands[st.i];
    dp[t] = [];
    back[t] = [];
    cs.forEach((c, k) => {
      if (t === 0) {
        dp[t][k] = c.cost + c.pos * 0.02;
        back[t][k] = -1;
        return;
      }
      const prev = steps[t - 1];
      const pcs = cands[prev.i];
      const shiftWeight = st.freeBefore ? 0.2 : 0.6;
      const sameShape = shapeKey(items[prev.i].notes) === shapeKey(items[st.i].notes);
      let best = Infinity, arg = 0;
      pcs.forEach((p, j) => {
        let v = dp[t - 1][j] + Math.abs(c.pos - p.pos) * shiftWeight;
        if (sameShape && p !== c) v += 0.5;
        if (v < best) { best = v; arg = j; }
      });
      dp[t][k] = best + c.cost + c.pos * 0.02;
      back[t][k] = arg;
    });
  });

  let t = steps.length - 1;
  let k = dp[t].indexOf(Math.min(...dp[t]));
  for (; t >= 0; t--) {
    items[steps[t].i].fingering = cands[steps[t].i][k];
    k = back[t][k];
  }
}

// Dicas em português para montar a forma, comparando com a anterior.
export function fingeringTips(item, prevItem, strings) {
  const tips = [];
  const f = item.fingering;
  if (!f) return tips;
  const label = (s) => strings[s - 1].label;
  const joinPt = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} e ${arr[arr.length - 1]}`);

  if (item.notes.length && item.notes.every((n) => n.dead)) {
    tips.push('Notas abafadas (x): encoste os dedos da mão esquerda nas cordas sem apertar e palhete. Sai um "tchk" percussivo, sem nota.');
  } else if (item.notes.some((n) => n.dead)) {
    tips.push('As cordas marcadas com x soam abafadas: encoste um dedo nelas sem apertar.');
  }

  const covered = new Set();
  for (const b of f.barres) {
    const ss = item.notes.filter((n) => isFretted(n) && f.fingers[n.string] === b.finger && n.fret === b.fret).map((n) => n.string);
    ss.forEach((s) => covered.add(s));
    const name = FINGER_NAMES[b.finger];
    if (b.to - b.from + 1 >= 4) {
      tips.push(`Pestana: deite o dedo ${b.finger} (${name}) da corda ${label(b.from)} até a ${label(b.to)}, na ${b.fret}ª casa.`);
    } else {
      tips.push(`Deite o dedo ${b.finger} (${name}) sobre as cordas ${joinPt(ss.sort((a, b2) => a - b2).map(label))} na ${b.fret}ª casa — uma mini-pestana.`);
    }
  }
  for (const n of item.notes.filter(isFretted).sort((a, b) => a.string - b.string)) {
    if (covered.has(n.string)) continue;
    const fin = f.fingers[n.string];
    if (fin) tips.push(`Dedo ${fin} (${FINGER_NAMES[fin]}) na ${n.fret}ª casa da corda ${label(n.string)}.`);
    else tips.push(`${n.fret}ª casa da corda ${label(n.string)}.`);
  }
  const open = item.notes.filter((n) => n.fret === 0 && !n.dead).map((n) => label(n.string));
  if (open.length === 1) tips.push(`Corda ${open[0]} solta (sem apertar nada).`);
  if (open.length > 1) tips.push(`Cordas ${joinPt(open)} soltas (sem apertar nada).`);

  if (item.notes.length <= 2 && strings.length >= 4) {
    const played = item.notes.map((n) => label(n.string));
    tips.push(played.length === 1
      ? `Palhete só a corda ${played[0]}.`
      : `Palhete só as cordas ${joinPt(played)} — as outras não podem soar.`);
  }

  const pf = prevItem?.fingering;
  if (pf && pf.pos != null && f.pos != null && shapeKey(prevItem.notes) !== shapeKey(item.notes)) {
    const delta = f.pos - pf.pos;
    const a = relativeKey(prevItem.notes, pf);
    const b = relativeKey(item.notes, f);
    if (delta !== 0 && a && a === b) {
      const casas = Math.abs(delta) === 1 ? '1 casa' : `${Math.abs(delta)} casas`;
      const direction = delta > 0 ? 'em direção ao corpo da guitarra' : 'em direção às tarraxas';
      tips.push(`Mesmo formato da anterior: só deslize a mão ${casas} ${direction}.`);
    } else if (Math.abs(delta) >= 2) {
      tips.push(`Mude a mão de lugar: indicador na altura da ${f.pos}ª casa.`);
    } else {
      // A mão não sai do lugar: explica o que muda (cordas e/ou dedo).
      const stringsOf = (it) => it.notes.filter((n) => !n.dead).map((n) => n.string).sort((x, y) => x - y);
      const fingersOf = (fg) => [...new Set(Object.values(fg.fingers))].sort();
      const before = stringsOf(prevItem);
      const now = stringsOf(item);
      const pfF = fingersOf(pf);
      const cfF = fingersOf(f);
      let fingerMsg = 'só troque os dedos';
      if (pfF.length === 1 && cfF.length === 1) {
        fingerMsg = pfF[0] === cfF[0]
          ? `use o mesmo dedo ${cfF[0]} (${FINGER_NAMES[cfF[0]]})`
          : `só passe do dedo ${pfF[0]} (${FINGER_NAMES[pfF[0]]}) para o ${cfF[0]} (${FINGER_NAMES[cfF[0]]})`;
      }
      if (before.join() !== now.join()) {
        tips.push(`Mudou de cordas: agora ${joinPt(now.map(label))} (antes ${joinPt(before.map(label))}). A mão continua na região da ${f.pos}ª casa: ${fingerMsg}.`);
      } else {
        tips.push(`A mão continua na região da ${f.pos}ª casa: ${fingerMsg}.`);
      }
    }
  }

  if (f.source === 'unknown') tips.unshift('Forma incomum: as notas ficam longe demais para uma mão só. Pode ser parte de teclado ou voz escrita em tablatura.');
  if (f.source === 'library') tips.push('Dedilhado padrão de dicionário de acordes.');
  if (f.source === 'tab') tips.push('Dedilhado indicado na própria tablatura.');
  return tips;
}
