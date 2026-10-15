import { analyzeTrack, annotateChordNames, prettyName } from './analysis.js';
import { diagramSVG, arrowSVG } from './diagram.js';
import { PRESETS, createToneEngine, routeMidi } from './tone.js';
import { createProgress, dayKey, formatMinutes } from './progress.js';
import { createTrainer } from './trainer.js';

const AT = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist';
// Banco de sons FluidR3 (licença MIT), o mesmo que o MuseScore 2 usava. 14,5 MB,
// baixado uma vez e guardado no cache do navegador. Se falhar, volta para o sonivox.
const SOUNDFONT = 'https://cdn.jsdelivr.net/gh/musescore/MuseScore@2.3.2/share/sound/FluidR3Mono_GM.sf3';
const SOUNDFONT_FALLBACK = `${AT}/soundfont/sonivox.sf2`;

// Precisa existir antes do primeiro "Tocar": desvia a saída do alphaTab para a pedaleira.
const tone = createToneEngine();
const SONGS = [
  { title: 'Smoke on the Water — Deep Purple (riff)', file: 'songs/smoke-on-the-water.atex' },
];

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const state = {
  score: null,
  trackIndex: 0,
  analysis: null,
  strategy: 'auto',
  laneBar: -1,
  lastTick: 0,
  findHint: null,
  playing: false,
  challenge: false,
  laps: 0,
  mix: [], // por faixa: { volume: 0–1.5, muted: bool }
  preset: 'original',
  songKey: '',
  songTitle: '',
  fileName: '',
  pass: null, // volta em andamento: { from: tick inicial, speed: menor velocidade usada }
};

const progress = createProgress();

const api = new alphaTab.AlphaTabApi($('score'), {
  core: { fontDirectory: `${AT}/font/` },
  display: { staveProfile: 'Tab', scale: 1.1 },
  notation: { rhythmMode: 'ShowWithBars' },
  player: {
    playerMode: 'EnabledSynthesizer',
    soundFont: SOUNDFONT,
    scrollElement: $('scoreWrap'),
    enableCursor: true,
    enableUserInteraction: true,
  },
});

// Para inspecionar pelo console do navegador: palheta.api, palheta.state, palheta.tone
window.palheta = { api, state, tone };

// O alphaTab nem sempre percebe quando a área da partitura muda de largura
// (janela minimizada, painel redimensionado); redesenha quando isso acontece.
let renderedWidth = $('scoreWrap').clientWidth;
let resizeTimer = null;
new ResizeObserver(() => {
  const width = $('scoreWrap').clientWidth;
  if (!state.score || width === 0 || Math.abs(width - renderedWidth) < 30) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderedWidth = width;
    api.render();
  }, 250);
}).observe($('scoreWrap'));

// ---------- carregar músicas ----------

$('songSelect').innerHTML = SONGS.map((s, i) => `<option value="${i}">${escapeHtml(s.title)}</option>`).join('');
$('songSelect').addEventListener('change', (e) => {
  const song = SONGS[+e.target.value];
  if (song) loadSong(song);
});

async function loadSong(song) {
  showLoading('Carregando tablatura…');
  const res = await fetch(song.file);
  state.fileName = song.file.split('/').pop();
  api.tex(await res.text(), [0]);
}

async function loadFile(file) {
  showLoading(`Abrindo ${file.name}…`);
  state.fileName = file.name;
  if (/\.(atex|txt)$/i.test(file.name)) api.tex(await file.text(), [0]);
  else api.load(new Uint8Array(await file.arrayBuffer()), [0]);
  const sel = $('songSelect');
  sel.querySelector('option[data-file]')?.remove();
  sel.insertAdjacentHTML('beforeend', `<option data-file value="file">Arquivo: ${escapeHtml(file.name)}</option>`);
  sel.value = 'file';
}

$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
  e.target.value = '';
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

function showLoading(text) {
  $('loading').textContent = text;
  $('loading').hidden = false;
}

let soundFontFallbackUsed = false;
api.error.on((err) => {
  console.error(err);
  // Falha antes do tocador ficar pronto e falando do banco de sons: usa o sonivox.
  const aboutSoundFont = /sound ?font|\.sf[23]/i.test(`${err?.message ?? ''} ${err?.stack ?? ''}`);
  if (!soundFontFallbackUsed && !api.isReadyForPlayback && aboutSoundFont) {
    soundFontFallbackUsed = true;
    console.warn('Banco de sons FluidR3 indisponível, usando o sonivox');
    api.loadSoundFontFromUrl(SOUNDFONT_FALLBACK, false);
    return;
  }
  showLoading(`Não consegui abrir essa música. ${err?.message ?? ''}`);
});
api.renderFinished.on(() => {
  $('loading').hidden = true;
  renderedWidth = $('scoreWrap').clientWidth;
});

api.scoreLoaded.on((score) => {
  state.score = score;
  // Roda antes do primeiro desenho, então os nomes já aparecem acima da tablatura.
  try {
    annotateChordNames(score, () => new alphaTab.model.Chord());
  } catch (err) {
    console.error('Não consegui escrever os nomes dos acordes', err);
  }
  const title = [score.title, score.artist].filter(Boolean).join(' — ');
  $('songTitle').textContent = title || 'Sem título';
  state.songTitle = title || state.fileName || 'Sem título';
  // por arquivo: o riff embutido e um .gp da mesma música têm progresso separado
  state.songKey = `${score.title}|${score.artist}|${state.fileName}`.toLowerCase();
  state.pass = null;
  renderProgress();
  $('trackSelect').innerHTML = score.tracks
    .map((t, i) => {
      const name = escapeHtml(t.name || `Faixa ${i + 1}`);
      return `<option value="${i}">${hasTab(t) ? name : `${name} (sem tablatura)`}</option>`;
    })
    .join('');
  let first = score.tracks.findIndex(isGuitarTrack);
  if (first < 0) first = score.tracks.findIndex(hasTab);
  first = Math.max(0, first);
  state.mix = score.tracks.map((_, i) => ({ volume: 1, muted: i !== first }));
  state.trackIndex = -1;
  selectTrack(first, first > 0);
  updateSpeedLabel();
});

const hasTab = (t) => Boolean(t.staves[0]?.isStringed && t.staves[0].tuning.length);
const GUITAR_NAME = /guit|viol[aã]o|riff/i;
const NOT_GUITAR_NAME = /voc|voz|voice|organ|[óo]rg[aã]o|piano|key|teclad|synth|drum|bateria|bass|baixo/i;

// Arquivos Guitar Pro costumam dar afinação de guitarra até para voz e teclado,
// então olho o instrumento MIDI (24–31 = guitarras) e o nome da faixa.
function isGuitarTrack(t) {
  if (!hasTab(t)) return false;
  const program = t.playbackInfo?.program;
  if (program >= 24 && program <= 31) return true;
  if (NOT_GUITAR_NAME.test(t.name)) return false;
  return GUITAR_NAME.test(t.name) || t.staves[0].tuning.length === 6;
}

$('trackSelect').addEventListener('change', (e) => selectTrack(+e.target.value, true, true));

// regenerate: refaz a MIDI (a faixa escolhida é a que passa pela pedaleira). Ao carregar
// uma música não precisa: o próprio alphaTab gera a MIDI logo depois do scoreLoaded.
function selectTrack(index, render, regenerate = false) {
  const prev = state.trackIndex;
  const mix = state.mix;
  // Se só a faixa anterior estava tocando, a nova faixa assume o lugar dela.
  if (prev >= 0 && prev !== index && mix.every((m, i) => m.muted || i === prev)) mix[prev].muted = true;
  if (mix[index]) {
    mix[index].muted = false;
    if (mix[index].volume === 0) mix[index].volume = 1;
  }
  state.trackIndex = index;
  $('trackSelect').value = String(index);
  if (render) setTimeout(() => api.renderTracks([state.score.tracks[index]]), 0);
  renderMixer();
  if (regenerate) regenerateMidi();
  else applyMix();
  analyze();
}

// ---------- mixer (volume por faixa) ----------

const SPEAKER_ON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';

const isSilent = (m) => m.muted || m.volume === 0;

function applyTrack(i) {
  if (!state.score || !api.isReadyForPlayback) return;
  const track = state.score.tracks[i];
  const m = state.mix[i];
  api.changeTrackVolume([track], m.volume);
  api.changeTrackMute([track], isSilent(m));
}

function applyMix() {
  if (!state.score || !api.isReadyForPlayback) return;
  api.changeTrackSolo(state.score.tracks, false);
  state.score.tracks.forEach((_, i) => applyTrack(i));
}

function renderMixer() {
  $('mixRows').innerHTML = state.score.tracks.map((t, i) => {
    const m = state.mix[i];
    const name = escapeHtml(t.name || `Faixa ${i + 1}`);
    const mine = i === state.trackIndex;
    const pct = Math.round(m.volume * 100);
    return `<div class="mix-row${mine ? ' mine' : ''}${isSilent(m) ? ' muted' : ''}">
      <button class="mix-mute" data-i="${i}" title="${m.muted ? 'Ligar' : 'Silenciar'}" aria-label="${m.muted ? 'Ligar' : 'Silenciar'} ${name}">${m.muted ? SPEAKER_OFF : SPEAKER_ON}</button>
      <span class="mix-name" title="${name}">${name}${mine ? ' · sua faixa' : ''}</span>
      <input type="range" min="0" max="150" step="5" value="${pct}" data-i="${i}" aria-label="Volume de ${name}">
      <span class="mix-val">${pct}%</span>
    </div>`;
  }).join('');
  updateMixSummary();
}

function updateMixSummary() {
  const playing = state.mix.filter((m) => !isSilent(m)).length;
  $('mixSummary').textContent = playing <= 1 ? '· só a sua faixa' : `· ${playing} de ${state.mix.length} tocando`;
}

$('mixRows').addEventListener('input', (e) => {
  if (e.target.type !== 'range') return;
  const i = +e.target.dataset.i;
  const m = state.mix[i];
  m.volume = +e.target.value / 100;
  if (m.volume > 0) m.muted = false;
  // atualiza só a linha (redesenhar tudo interromperia o arraste do controle)
  const row = e.target.closest('.mix-row');
  row.querySelector('.mix-val').textContent = `${e.target.value}%`;
  row.classList.toggle('muted', isSilent(m));
  row.querySelector('.mix-mute').innerHTML = m.muted ? SPEAKER_OFF : SPEAKER_ON;
  applyTrack(i);
  updateMixSummary();
});

$('mixRows').addEventListener('click', (e) => {
  const btn = e.target.closest('.mix-mute');
  if (!btn) return;
  const m = state.mix[+btn.dataset.i];
  m.muted = !m.muted;
  if (!m.muted && m.volume === 0) m.volume = 1;
  renderMixer();
  applyTrack(+btn.dataset.i);
});

$('mixSolo').addEventListener('click', () => {
  state.mix.forEach((m, i) => { m.muted = i !== state.trackIndex; });
  renderMixer();
  applyMix();
});

$('mixAll').addEventListener('click', () => {
  state.mix.forEach((m) => {
    m.muted = false;
    if (m.volume === 0) m.volume = 1;
  });
  renderMixer();
  applyMix();
});

// ---------- timbre da guitarra (presets e pedaleira) ----------

api.midiLoad.on((midi) => {
  const track = state.score?.tracks[state.trackIndex];
  if (!track) return;
  const channels = new Set([track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel]);
  routeMidi(midi, channels, PRESETS[state.preset]?.program ?? null);
});

// Refaz a MIDI (troca de faixa ou de instrumento) sem perder o ponto da música.
function regenerateMidi() {
  if (!state.score || !api.isReadyForPlayback) return;
  const wasPlaying = state.playing;
  const tick = api.tickPosition;
  if (wasPlaying) api.pause();
  api.loadMidiForScore();
  // O tocador volta para o início ao receber a MIDI nova e ignora um tickPosition enviado
  // logo em seguida; a posição é reaplicada quando ele avisar que voltou (playerPositionChanged).
  state.pendingSeek = { tick, until: performance.now() + 3000 };
  applyMix();
  if (!wasPlaying) return;
  // As mensagens chegam ao tocador na ordem enviada, então o play vem depois da MIDI nova.
  // (requestAnimationFrame não serve: o navegador não o dispara com a aba escondida.)
  setTimeout(() => api.play(), 50);
  setTimeout(() => { if (!state.playing) api.play(); }, 800);
}

const TONE_KEY = 'palheta:timbre';
const OLD_TONE_KEY = 'guitarra-guiada:timbre'; // nome antigo do app

function renderTonePanel() {
  $('presets').innerHTML = Object.entries(PRESETS)
    .map(([id, p]) => `<button class="preset${id === state.preset ? ' active' : ''}" data-preset="${id}">${p.label}</button>`)
    .join('');
  for (const key of ['drive', 'tone', 'reverb']) {
    $(`fx-${key}`).value = tone.params[key];
  }
  updateToneSummary();
}

function updateToneSummary() {
  const p = PRESETS[state.preset];
  const custom = ['drive', 'tone', 'reverb'].some((k) => tone.params[k] !== p[k]);
  $('toneSummary').textContent = `· ${p.label}${custom ? ' (ajustado)' : ''}`;
  $('fx-drive-out').textContent = tone.params.drive === 0 ? 'desligada' : `${tone.params.drive}%`;
  $('fx-reverb-out').textContent = tone.params.reverb === 0 ? 'desligado' : `${tone.params.reverb}%`;
  try {
    localStorage.setItem(TONE_KEY, JSON.stringify({ preset: state.preset, ...tone.params }));
    localStorage.removeItem(OLD_TONE_KEY);
  } catch {
    // sem armazenamento local: só não lembra na próxima vez
  }
}

function choosePreset(id) {
  const before = PRESETS[state.preset].program;
  state.preset = id;
  const p = PRESETS[id];
  tone.set({ drive: p.drive, tone: p.tone, reverb: p.reverb });
  renderTonePanel();
  if (p.program !== before) regenerateMidi();
}

$('presets').addEventListener('click', (e) => {
  const btn = e.target.closest('.preset');
  if (btn) choosePreset(btn.dataset.preset);
});

for (const key of ['drive', 'tone', 'reverb']) {
  $(`fx-${key}`).addEventListener('input', (e) => {
    tone.set({ [key]: +e.target.value });
    updateToneSummary();
  });
}

try {
  const saved = JSON.parse(localStorage.getItem(TONE_KEY) ?? localStorage.getItem(OLD_TONE_KEY) ?? 'null');
  if (saved && PRESETS[saved.preset]) {
    state.preset = saved.preset;
    tone.set({ drive: saved.drive, tone: saved.tone, reverb: saved.reverb });
  }
} catch {
  // preferência salva inválida ou indisponível: fica no padrão
}
renderTonePanel();

// ---------- análise e painel do professor ----------

function analyze() {
  const track = state.score.tracks[state.trackIndex];
  let a;
  try {
    a = analyzeTrack(track, { strategy: state.strategy });
  } catch (err) {
    console.error(err);
    a = { ok: false, reason: `Não consegui analisar esta faixa, mas a tablatura continua aí ao lado. (Detalhe: ${err.message})` };
  }
  state.analysis = a;
  state.laneBar = -1;
  state.findHint = null;

  document.querySelectorAll('.segmented button').forEach((b) => {
    b.classList.toggle('active', a.ok && b.dataset.strategy === a.strategy);
  });

  if (!a.ok) {
    $('diagram').innerHTML = '';
    $('coachName').textContent = '–';
    $('coachDesc').textContent = a.reason;
    $('coachStroke').className = 'stroke';
    $('coachStroke').innerHTML = '';
    $('coachCount').textContent = '';
    $('coachTips').innerHTML = '';
    $('coachNext').innerHTML = '';
    $('lane').innerHTML = '<p class="empty">Sem tablatura nesta faixa.</p>';
    $('shapes').innerHTML = '';
    $('strategyNote').textContent = '';
    return;
  }

  const modeText = a.strategy === 'riff'
    ? 'Modo riff: quando há tempo entre as notas, palheta para baixo (mais peso); nas notas rápidas, alterna como um pêndulo.'
    : 'Modo pêndulo: a mão nunca para. Desce nos tempos e sobe nos "e", mesmo quando não encosta nas cordas.';
  const autoText = state.strategy === 'auto'
    ? ` Escolhi esse modo porque ${a.autoStrategy === 'riff' ? 'a faixa parece um riff (poucas cordas por vez)' : 'a faixa parece uma batida de acordes'}.`
    : '';
  $('strategyNote').textContent = modeText + autoText;

  renderShapes();
  const first = a.items[0];
  if (first) {
    showItem(first, { kicker: 'Primeira forma' });
    renderLane(first.barIndex);
  }
}

document.querySelectorAll('.segmented button').forEach((b) => {
  b.addEventListener('click', () => {
    state.strategy = b.dataset.strategy;
    const shown = state.shownBeat;
    analyze();
    const info = shown && state.analysis.beatMap.get(shown.id);
    if (info?.item) {
      showItem(info.item);
      renderLane(info.item.barIndex);
    }
  });
});

function showItem(item, { kicker = 'Agora', hold = false } = {}) {
  const a = state.analysis;
  state.shownBeat = item.beat;
  $('diagram').innerHTML = diagramSVG(item, a.strings);
  $('coachKicker').textContent = hold ? 'Segure' : kicker;
  $('coachName').textContent = prettyName(item.shape.name);
  $('coachDesc').textContent = capitalize(item.shape.desc) + (item.shape.notesText ? ` · ${item.shape.notesText}` : '');

  const stroke = $('coachStroke');
  if (hold) {
    stroke.className = 'stroke hold';
    stroke.textContent = 'O som continua: não palhete de novo';
  } else {
    stroke.className = `stroke ${item.stroke}`;
    stroke.innerHTML = `${arrowSVG(item.stroke)} Palhetada para ${item.stroke === 'down' ? 'baixo' : 'cima'}`;
  }

  const durDetail = item.tiedOver ? `${item.durName} ligada à seguinte` : item.durName;
  $('coachCount').innerHTML = `Entra <b>${item.count.long}</b> e dura <b>${item.durText}</b> (${durDetail}).`;

  $('coachTips').innerHTML = [
    ...a.tipsFor(item).map((t) => `<li>${t}</li>`),
    `<li class="why">${item.strokeWhy}</li>`,
  ].join('');

  const next = a.nextOf(item);
  $('coachNext').innerHTML = next && next !== item
    ? `<span>Depois vem</span>${diagramSVG(next, a.strings, { width: 92, compact: true })}<b>${prettyName(next.shape.name)}</b><span class="next-arrow" style="color: var(--${next.stroke})">${arrowSVG(next.stroke, 18)}</span>`
    : '';

  document.querySelectorAll('.shape').forEach((el) => el.classList.toggle('active', el.dataset.key === item.key));
}

function renderShapes() {
  const a = state.analysis;
  $('shapes').innerHTML = a.shapes.map((s, i) => {
    const frets = s.item.notes.filter((n) => n.fret > 0 && !n.dead).map((n) => n.fret);
    const where = frets.length ? `${Math.min(...frets)}ª casa · ` : '';
    return `
    <button class="shape" data-i="${i}" data-key="${escapeHtml(s.key)}">
      ${diagramSVG(s.item, a.strings, { width: 76, compact: true })}
      <b>${prettyName(s.item.shape.name)}</b>
      <small>${where}${s.count}×</small>
    </button>`;
  }).join('');
}

$('shapes').addEventListener('click', (e) => {
  const el = e.target.closest('.shape');
  if (!el) return;
  const item = state.analysis.shapes[+el.dataset.i].item;
  showItem(item, { kicker: 'Forma' });
  renderLane(item.barIndex);
  if (!state.playing && api.tickCache) api.tickPosition = api.tickCache.getBeatStart(item.beat);
});

// ---------- treino de trocas e progresso ----------

const trainer = createTrainer({
  progress,
  onOpen: () => { if (state.playing) api.pause(); },
  onRound: () => renderProgress(),
});

$('openTrainer').addEventListener('click', () => {
  if (!state.analysis?.ok) {
    toast('Escolha uma faixa com tablatura para treinar as trocas.');
    return;
  }
  trainer.open(state.analysis, state.songKey, state.songTitle);
});

// Tempo de prática: conta enquanto a música ou o treino de trocas está tocando.
setInterval(() => {
  if (!state.playing && !trainer.running) return;
  progress.practice(state.songKey, state.songTitle, 1);
  renderProgress();
}, 1000);

// Uma "volta" vale para recorde só se começou no início (da música ou do trecho escolhido);
// a velocidade registrada é a menor usada durante a volta.
function passStartTick() {
  return api.playbackRange?.startTick ?? 0;
}

function startPass(fromTick) {
  state.pass = { from: fromTick, speed: api.playbackSpeed };
}

function sectionLabel() {
  const range = api.playbackRange;
  const cache = api.tickCache;
  if (!range || !cache) return null;
  const tracks = new Set([state.trackIndex]);
  const first = cache.findBeat(tracks, range.startTick)?.beat;
  const last = cache.findBeat(tracks, Math.max(range.startTick, range.endTick - 1))?.beat;
  if (!first || !last) return 'trecho escolhido';
  const a = first.voice.bar.index + 1;
  const b = last.voice.bar.index + 1;
  return a === b ? `compasso ${a}` : `compassos ${a}–${b}`;
}

function finishPass() {
  const pass = state.pass;
  if (!pass || pass.from > passStartTick() + 960) return;
  const speed = Math.round(pass.speed * 100) / 100;
  const section = sectionLabel();
  if (progress.recordSpeed(state.songKey, state.songTitle, speed, section)) {
    const where = section ? `no trecho (${section})` : 'na música inteira';
    toast(`Novo recorde ${where}: ${Math.round(speed * 100)}% da velocidade!`);
  }
  renderProgress();
}

function speedText(speed) {
  const pct = `${Math.round(speed * 100)}%`;
  return state.score?.tempo ? `${pct} (${Math.round(state.score.tempo * speed)} BPM)` : pct;
}

function renderProgress() {
  const streak = progress.streak();
  $('streakChip').textContent = streak ? `${streak} ${streak === 1 ? 'dia seguido' : 'dias seguidos'}` : 'Comece sua sequência hoje';
  $('pStreak').textContent = streak;
  $('pToday').textContent = formatMinutes(progress.secondsOn(dayKey()));
  const song = progress.songStats(state.songKey);
  $('pSong').textContent = formatMinutes(song?.seconds ?? 0);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const secs = days.map((d) => progress.secondsOn(dayKey(d)));
  const max = Math.max(600, ...secs);
  $('pWeek').innerHTML = days.map((d, i) => `
    <div class="day${i === 6 ? ' today' : ''}" title="${d.toLocaleDateString('pt-BR', { weekday: 'long' })}: ${formatMinutes(secs[i])}">
      <div class="bar${secs[i] >= 60 ? ' on' : ''}" style="height: ${Math.round((secs[i] / max) * 52) + 3}px"></div>
      <small>${d.toLocaleDateString('pt-BR', { weekday: 'narrow' })}</small>
    </div>`).join('');

  const rows = [];
  if (song?.bestFull) rows.push(['Música inteira', speedText(song.bestFull)]);
  Object.entries(song?.sections ?? {})
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .forEach(([label, speed]) => rows.push([`Trecho: ${label}`, speedText(speed)]));
  progress.pairsOf(state.songKey)
    .sort((x, y) => y.bpm / y.every - x.bpm / x.every)
    .slice(0, 4)
    .forEach((p) => rows.push([`Troca ${p.label}`, `${p.bpm} BPM, ${p.every === 1 ? 'a cada tempo' : `a cada ${p.every} tempos`}`]));
  $('pRecords').innerHTML = rows.length
    ? rows.map(([a, b]) => `<li><span>${escapeHtml(a)}</span><b>${escapeHtml(b)}</b></li>`).join('')
    : '<li class="empty">Toque a música (ou um trecho com Repetir) do começo ao fim, ou faça uma rodada limpa no treino de trocas, para marcar seu primeiro recorde.</li>';
}

renderProgress();

function renderLane(barIndex) {
  const a = state.analysis;
  const bar = a?.ok && a.bars[barIndex];
  if (!bar) return;
  state.laneBar = barIndex;
  $('laneTitle').textContent = `Batida do compasso ${barIndex + 1}`;
  const showGhost = a.strategy === 'pendulum';
  $('lane').innerHTML = bar.cells.map((c, i) => {
    if (c.kind === 'hit') {
      return `<div class="cell hit ${c.item.stroke}" data-i="${i}">
        <div class="c-arrow">${arrowSVG(c.item.stroke)}</div>
        <div class="c-name">${prettyName(c.item.shape.name)}</div>
        <div class="c-count">${c.label}</div></div>`;
    }
    return `<div class="cell ${c.kind}${showGhost ? ' ghost' : ''}" data-i="${i}">
      <div class="c-arrow">${showGhost ? arrowSVG(c.ghost, 18) : ''}</div>
      <div class="c-name"></div>
      <div class="c-count">${c.label}</div></div>`;
  }).join('');
}

$('lane').addEventListener('click', (e) => {
  const el = e.target.closest('.cell.hit');
  if (!el) return;
  const cell = state.analysis.bars[state.laneBar].cells[+el.dataset.i];
  showItem(cell.item, { kicker: 'Selecionada' });
});

function markCell(barIndex, tickInBar) {
  if (barIndex !== state.laneBar) renderLane(barIndex);
  const bar = state.analysis.bars[barIndex];
  if (!bar) return;
  const idx = Math.floor(tickInBar / bar.unit + 1e-6);
  [...$('lane').children].forEach((el, i) => el.classList.toggle('on', i === idx));
}

// ---------- tocador ----------

api.soundFontLoad.on((e) => {
  if (e.total) $('playBtn').textContent = `Carregando som… ${Math.round((e.loaded / e.total) * 100)}%`;
});

api.playerReady.on(() => {
  $('playBtn').disabled = false;
  setPlayLabel(false);
  applyTransport();
  applyMix();
});
// Não assinar api.midiLoaded: no alphaTab 1.8.4 isso entra em recursão infinita
// (o getter loadedMidiInfo do sintetizador em worker chama a si mesmo).

api.playerStateChanged.on((e) => {
  state.playing = e.state === 1;
  setPlayLabel(state.playing);
  if (e.stopped) state.pass = null;
  else if (state.playing && !state.pass) startPass(api.tickPosition);
});

// Fim da música ou do trecho (com Repetir, dispara a cada volta, antes de voltar ao início).
api.playerFinished.on(() => {
  finishPass();
  state.pass = null;
  if (state.challenge) onLap();
});

api.playedBeatChanged.on((beat) => {
  const info = state.analysis?.beatMap?.get(beat.id);
  if (!info) return;
  if (info.item) showItem(info.item);
  else if (info.holdOf) showItem(info.holdOf, { hold: true });
});

api.playerPositionChanged.on((e) => {
  const tick = e.currentTick;
  const seek = state.pendingSeek;
  if (seek) {
    if (performance.now() > seek.until) state.pendingSeek = null;
    else if (tick < seek.tick - 10) {
      state.pendingSeek = null;
      state.restoringSeek = true;
      state.lastTick = seek.tick;
      api.tickPosition = seek.tick;
      return;
    }
  }
  // Qualquer pulo (clique na partitura, volta do Repetir) começa uma volta nova,
  // menos a posição que o próprio app restaura depois de refazer a MIDI.
  if (e.isSeek) {
    if (state.restoringSeek) state.restoringSeek = false;
    else if (state.playing) startPass(tick);
    else state.pass = null;
  }
  state.lastTick = tick;
  if (!state.analysis?.ok || !api.tickCache) return;
  const res = api.tickCache.findBeat(new Set([state.trackIndex]), tick, state.findHint);
  state.findHint = res;
  if (!res) return;
  markCell(res.beat.voice.bar.index, res.beat.playbackStart + (tick - res.start));
});

api.beatMouseDown.on((beat) => {
  const info = state.analysis?.beatMap?.get(beat.id);
  const item = info?.item ?? info?.holdOf;
  if (!item) return;
  showItem(item, { kicker: 'Selecionada' });
  renderLane(beat.voice.bar.index);
});

api.playbackRangeChanged.on((e) => {
  $('clearRange').hidden = !e.playbackRange;
});

function setPlayLabel(playing) {
  $('playBtn').innerHTML = playing
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg> Pausar'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg> Tocar';
}

function applyTransport() {
  api.playbackSpeed = +$('speed').value / 100;
  api.metronomeVolume = $('metro').checked ? 1 : 0;
  api.countInVolume = $('countIn').checked ? 1 : 0;
  api.isLooping = $('loop').checked;
}

function updateSpeedLabel() {
  const v = +$('speed').value;
  const tempo = state.score?.tempo;
  $('speedOut').textContent = tempo ? `${v}% · ${Math.round((tempo * v) / 100)} BPM` : `${v}%`;
}

$('playBtn').addEventListener('click', () => api.playPause());
$('stopBtn').addEventListener('click', () => api.stop());
$('speed').addEventListener('input', () => {
  api.playbackSpeed = +$('speed').value / 100;
  if (state.pass) state.pass.speed = Math.min(state.pass.speed, api.playbackSpeed);
  updateSpeedLabel();
});
$('metro').addEventListener('change', applyTransport);
$('countIn').addEventListener('change', applyTransport);
$('loop').addEventListener('change', applyTransport);
$('clearRange').addEventListener('click', () => {
  api.playbackRange = null;
  api.clearPlaybackRangeHighlight();
  $('clearRange').hidden = true;
});

$('challenge').addEventListener('change', (e) => {
  state.challenge = e.target.checked;
  state.laps = 0;
  if (!state.challenge) return;
  $('loop').checked = true;
  $('speed').value = Math.min(+$('speed').value, 50);
  applyTransport();
  updateSpeedLabel();
  toast(`Desafio ligado: começa em ${$('speed').value}% e sobe 5% a cada volta completa.`);
});

function onLap() {
  state.laps++;
  const v = Math.min(100, +$('speed').value + 5);
  $('speed').value = v;
  api.playbackSpeed = v / 100;
  updateSpeedLabel();
  toast(v >= 100 ? `Volta ${state.laps}: você chegou na velocidade original!` : `Volta ${state.laps} completa, subindo para ${v}%`);
  if (v >= 100) {
    state.challenge = false;
    $('challenge').checked = false;
  }
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  // dois avisos ao mesmo tempo (ex.: recorde + desafio) aparecem juntos
  el.textContent = el.hidden ? text : `${el.textContent} · ${text}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

loadSong(SONGS[0]);
