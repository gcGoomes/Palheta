// Treino de trocas: alterna entre duas formas da música no ritmo de um metrônomo.
// Cada rodada tem 8 trocas; no fim você diz como foi e a velocidade sobe (ou desce).
// O metrônomo daqui é próprio (Web Audio), independente do tocador da partitura.
import { prettyName } from './analysis.js';
import { diagramSVG } from './diagram.js';
import { changeTips, fingeringTips } from './fingering.js';

const ROUND_CHANGES = 8;
const COUNT_IN = 4;
const MIN_BPM = 30;
const MAX_BPM = 160;

// Pares de formas vizinhas na música, dos mais frequentes para os menos.
export function changePairs(analysis, limit = 6) {
  const pairs = new Map();
  let prev = null;
  for (const it of analysis.items) {
    if (it.notes.every((n) => n.dead)) continue;
    if (prev && prev.key !== it.key) {
      const key = [prev.key, it.key].sort().join(' | ');
      if (!pairs.has(key)) pairs.set(key, { key, a: prev, b: it, count: 0 });
      pairs.get(key).count++;
    }
    prev = it;
  }
  return [...pairs.values()].sort((x, y) => y.count - x.count).slice(0, limit);
}

const $ = (id) => document.getElementById(id);
const label = (pair) => `${prettyName(pair.a.shape.name)} ⇄ ${prettyName(pair.b.shape.name)}`;
const everyText = (every) => (every === 1 ? 'a cada tempo' : `a cada ${every} tempos`);

export function createTrainer({ progress, onOpen, onRound }) {
  const dialog = $('trainer');
  const st = { pairs: [], pair: null, strings: null, songKey: '', title: '', bpm: 60, every: 4, running: false };
  let ctx = null;
  let nodes = [];
  let timers = [];

  const pairKey = () => `${st.songKey}::${st.pair.key}`;

  function stop() {
    for (const t of timers) clearTimeout(t);
    for (const n of nodes) {
      try { n.stop(); } catch { /* já tinha parado */ }
    }
    timers = [];
    nodes = [];
    st.running = false;
    $('trStart').textContent = 'Começar';
    $('trA').classList.remove('now', 'next');
    $('trB').classList.remove('now', 'next');
  }

  function click(time, accent) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.28, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.07);
    nodes.push(osc);
  }

  function at(time, fn) {
    timers.push(setTimeout(fn, Math.max(0, (time - ctx.currentTime) * 1000)));
  }

  function setNow(which) {
    $('trA').classList.toggle('now', which === 'a');
    $('trA').classList.toggle('next', which === 'b');
    $('trB').classList.toggle('now', which === 'b');
    $('trB').classList.toggle('next', which === 'a');
  }

  function renderBeats(filled) {
    $('trBeats').innerHTML = Array.from({ length: st.every }, (_, i) => `<span class="${i < filled ? 'on' : ''}${i === 0 ? ' first' : ''}"></span>`).join('');
  }

  function start() {
    stop();
    ctx ??= new AudioContext();
    ctx.resume();
    $('trResult').hidden = true;
    st.running = true;
    $('trStart').textContent = 'Parar';
    const beat = 60 / st.bpm;
    const t0 = ctx.currentTime + 0.2;
    const a = prettyName(st.pair.a.shape.name);
    const b = prettyName(st.pair.b.shape.name);

    for (let i = 0; i < COUNT_IN; i++) {
      const t = t0 + i * beat;
      click(t, i === 0);
      at(t, () => {
        setNow('a');
        renderBeats(0);
        $('trStatus').innerHTML = `Prepare-se: comece com <b>${a}</b>… <span class="tr-count">${COUNT_IN - i}</span>`;
      });
    }

    const groups = ROUND_CHANGES + 1;
    for (let g = 0; g < groups; g++) {
      const shape = g % 2 === 0 ? 'a' : 'b';
      const name = shape === 'a' ? a : b;
      const other = shape === 'a' ? b : a;
      for (let j = 0; j < st.every; j++) {
        const t = t0 + (COUNT_IN + g * st.every + j) * beat;
        click(t, j === 0);
        at(t, () => {
          setNow(shape);
          renderBeats(j + 1);
          const last = g === groups - 1;
          let msg;
          if (j === 0) msg = g === 0 ? `Toque <b>${name}</b>` : `Troque! <b>${name}</b>`;
          else msg = `Segure <b>${name}</b>`;
          if (j === st.every - 1 && !last) msg += ` · prepare <b>${other}</b>`;
          const progressText = g === 0 ? 'primeira forma' : `troca ${g} de ${ROUND_CHANGES}`;
          $('trStatus').innerHTML = `${msg} <span class="tr-progress">${progressText}</span>`;
        });
      }
    }

    at(t0 + (COUNT_IN + groups * st.every) * beat, () => {
      stop();
      $('trStatus').innerHTML = `Fim da rodada a <b>${st.bpm} BPM</b>, ${everyText(st.every)}. Como foi?`;
      $('trResult').hidden = false;
    });
  }

  function finishRound(result) {
    $('trResult').hidden = true;
    const notes = [];
    if (result === 'clean') {
      const isRecord = progress.recordPair(pairKey(), label(st.pair), st.bpm, st.every);
      if (isRecord) notes.push(`<b>Novo recorde:</b> ${st.bpm} BPM, ${everyText(st.every)}!`);
      if (st.bpm + 5 > 120 && st.every > 1) {
        st.every = st.every === 4 ? 2 : 1;
        st.bpm = 60;
        notes.push(`Agora troque ${everyText(st.every)}, começando em 60 BPM.`);
      } else {
        st.bpm = Math.min(MAX_BPM, st.bpm + 5);
      }
    } else if (result === 'slower') {
      st.bpm = Math.max(MIN_BPM, st.bpm - 5);
    }
    render();
    onRound?.();
    $('trStatus').innerHTML = `${notes.join(' ')} Aperte Começar para a próxima rodada.`.trim();
  }

  function render() {
    const p = st.pair;
    $('trPairs').innerHTML = st.pairs
      .map((x, i) => `<button class="preset${x === p ? ' active' : ''}" data-i="${i}">${label(x)} <small>${x.count}×</small></button>`)
      .join('');
    if (!p) return;
    for (const [id, item] of [['trA', p.a], ['trB', p.b]]) {
      $(id).innerHTML = `${diagramSVG(item, st.strings, { width: 150 })}<b>${prettyName(item.shape.name)}</b>`;
    }
    $('trBpm').textContent = st.bpm;
    document.querySelectorAll('#trEvery button').forEach((btn) => btn.classList.toggle('active', +btn.dataset.every === st.every));
    renderBeats(0);

    const rec = progress.pair(pairKey());
    $('trRecord').textContent = rec
      ? `Seu recorde: ${rec.bpm} BPM, ${everyText(rec.every)} (${rec.rounds} ${rec.rounds === 1 ? 'rodada limpa' : 'rodadas limpas'}).`
      : 'Ainda sem recorde nesta troca.';

    // dicas nos dois sentidos da troca (A → B e B → A), sem repetir
    const position = fingeringTips(p.b, p.a, st.strings).filter((t) => /região|Mudou de cordas|deslize|Mude a mão/.test(t));
    const tips = [...new Set([...changeTips(p.a, p.b, st.strings), ...changeTips(p.b, p.a, st.strings), ...position])];
    tips.push('A troca tem que estar pronta no 1: comece devagar até sair sem buraco no som.');
    $('trTips').innerHTML = tips.map((t) => `<li>${t}</li>`).join('');
  }

  $('trPairs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    stop();
    st.pair = st.pairs[+btn.dataset.i];
    const rec = progress.pair(pairKey());
    st.bpm = rec ? Math.max(MIN_BPM, rec.bpm - 10) : 60;
    st.every = rec?.every ?? 4;
    $('trResult').hidden = true;
    $('trStatus').textContent = 'Escolha a velocidade e aperte Começar.';
    render();
  });
  $('trMinus').addEventListener('click', () => { st.bpm = Math.max(MIN_BPM, st.bpm - 5); render(); });
  $('trPlus').addEventListener('click', () => { st.bpm = Math.min(MAX_BPM, st.bpm + 5); render(); });
  $('trEvery').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-every]');
    if (!btn || st.running) return;
    st.every = +btn.dataset.every;
    render();
  });
  $('trStart').addEventListener('click', () => (st.running ? stop() : start()));
  $('trResult').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-result]');
    if (btn) finishRound(btn.dataset.result);
  });
  $('trClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stop);

  return {
    open(analysis, songKey, title) {
      st.pairs = changePairs(analysis);
      st.strings = analysis.strings;
      st.songKey = songKey;
      st.title = title;
      st.pair = st.pairs[0] ?? null;
      const rec = st.pair && progress.pair(pairKey());
      st.bpm = rec ? Math.max(MIN_BPM, rec.bpm - 10) : 60;
      st.every = rec?.every ?? 4;
      $('trResult').hidden = true;
      $('trStatus').textContent = st.pair
        ? 'Escolha a velocidade e aperte Começar. O metrônomo conta 4 antes de começar.'
        : 'Esta faixa não tem trocas de forma para treinar.';
      $('trStage').hidden = !st.pair;
      render();
      onOpen?.();
      dialog.showModal();
    },
    get running() {
      return st.running;
    },
    get songKey() {
      return st.songKey;
    },
  };
}
