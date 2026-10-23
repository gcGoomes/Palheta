import { analyzeTrack, annotateChordNames, prettyName } from './analysis.js';
import { diagramSVG, arrowSVG } from './diagram.js';
import { PRESETS, createToneEngine, routeMidi } from './tone.js';
import { createProgress, dayKey, formatMinutes } from './progress.js';
import { createTrainer } from './trainer.js';
import { createLibrary, fileId } from './library.js';
import { createTuner } from './tuner.js';
import { createChordDictionary, parseChord } from './chords.js';

const AT = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist';
// Bancos de sons para escolher no painel de timbre. O navegador baixa uma vez e guarda em cache.
// - FluidR3 (MIT): o que o MuseScore 2 usava, servido pelo jsDelivr.
// - MuseScore General 0.2 (MIT): o do MuseScore 3, derivado do FluidR3; cópia local em sons/,
//   porque o servidor oficial não libera o download por outro site (licença e créditos em sons/).
// - GeneralUser GS 2.0.3: cópia local em sons/, como o autor pede para sites (licença em sons/).
// - Sonivox: o banco leve que vem com o alphaTab; também é o reserva quando outro falha.
// trim: ganho que iguala o volume da guitarra entre os bancos (medido com o riff embutido),
// para a comparação de ouvido ser justa.
const BANKS = {
  fluid: { label: 'FluidR3', size: '14 MB', trim: 1, url: 'https://cdn.jsdelivr.net/gh/musescore/MuseScore@2.3.2/share/sound/FluidR3Mono_GM.sf3' },
  musescore: { label: 'MuseScore General', size: '40 MB', trim: 1, url: new URL('sons/MuseScore_General.sf3', location.href).href },
  generaluser: { label: 'GeneralUser GS', size: '32 MB', trim: 0.59, url: new URL('sons/GeneralUser-GS.sf2', location.href).href },
  sonivox: { label: 'Sonivox', size: '1 MB', trim: 0.26, url: `${AT}/soundfont/sonivox.sf2` },
};
const BANK_KEY = 'palheta:banco';

function savedBank() {
  try {
    const id = localStorage.getItem(BANK_KEY);
    return BANKS[id] ? id : 'fluid';
  } catch {
    return 'fluid';
  }
}

// Precisa existir antes do primeiro "Tocar": desvia a saída do alphaTab para a pedaleira.
const tone = createToneEngine();
tone.setTrim(BANKS[savedBank()].trim);
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
  bank: savedBank(),
  bankLoading: null, // troca em andamento: { target, previous }
  songKey: '',
  songTitle: '',
  fileName: '',
  pass: null, // volta em andamento: { from: tick inicial, speed: menor velocidade usada }
  libId: null, // música aberta, se ela está em Minhas músicas (as embutidas não ficam lá)
  opening: null, // arquivo sendo aberto: { entry, bytes (só se é novo na biblioteca) }
};

const progress = createProgress();
const library = createLibrary();
// Mesma chave do progresso (minutos e recordes) usada no scoreLoaded.
const songKeyOf = (title, artist, fileName) => `${title}|${artist}|${fileName}`.toLowerCase();

const api = new alphaTab.AlphaTabApi($('score'), {
  core: { fontDirectory: `${AT}/font/` },
  display: { staveProfile: 'Tab', scale: 1.1 },
  notation: { rhythmMode: 'ShowWithBars' },
  player: {
    playerMode: 'EnabledSynthesizer',
    soundFont: BANKS[state.bank].url,
    scrollElement: $('scoreWrap'),
    enableCursor: true,
    enableUserInteraction: true,
  },
});

// ---------- afinador e dicionário de acordes ----------

const pauseSong = () => { if (state.playing) api.pause(); };
const tuner = createTuner({ getSongStrings: () => state.analysis?.strings, onOpen: pauseSong });
const chords = createChordDictionary({ onOpen: pauseSong });
$('tunerBtn').addEventListener('click', () => tuner.open());
$('chordsBtn').addEventListener('click', () => chords.open());

// Tocar no nome da forma, no painel do professor, abre o dicionário com esse acorde.
function coachChord() {
  const item = state.shownItem;
  if (!item || item.notes.filter((n) => !n.dead).length < 2) return null;
  return parseChord(item.shape.name) ? item.shape.name : null;
}
function openCoachChord() {
  const name = coachChord();
  if (name) chords.open(name);
}
$('coachName').addEventListener('click', openCoachChord);
$('coachName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCoachChord(); }
});

// Para inspecionar pelo console do navegador: palheta.api, palheta.state, palheta.tone, palheta.tuner, palheta.chords
window.palheta = { api, state, tone, tuner, chords };

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
  rememberPlace();
  showLoading('Carregando tablatura…');
  const res = await fetch(song.file);
  state.fileName = song.file.split('/').pop();
  state.opening = null;
  api.tex(await res.text(), [0]);
}

// Arquivo aberto pelo botão ou arrastado: se já está na biblioteca, reabre a mesma entrada
// (com faixa, velocidade e posição guardadas); se não, ela é criada quando a música carregar.
async function loadFile(file) {
  rememberPlace();
  showLoading(`Abrindo ${file.name}…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = fileId(bytes);
  let saved = null;
  try {
    saved = await library.get(id);
  } catch {
    // sem biblioteca (navegação privada, por exemplo): abre do mesmo jeito
  }
  openScore(saved ?? { id, fileName: file.name, size: bytes.length, added: Date.now() }, bytes, !saved);
}

function openScore(entry, bytes, isNew) {
  state.fileName = entry.fileName;
  state.opening = { entry, bytes: isNew ? bytes : null };
  if (/\.(atex|txt)$/i.test(entry.fileName)) api.tex(new TextDecoder().decode(bytes), [0]);
  else api.load(bytes, [0]);
  const sel = $('songSelect');
  sel.querySelector('option[data-file]')?.remove();
  sel.insertAdjacentHTML('beforeend', `<option data-file value="file">Arquivo: ${escapeHtml(entry.fileName)}</option>`);
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

// ---------- Minhas músicas (biblioteca no IndexedDB) ----------

async function addToLibrary(score, { entry, bytes }) {
  Object.assign(entry, { title: score.title ?? '', artist: score.artist ?? '', lastUsed: Date.now() });
  try {
    await library.save(entry, bytes);
    if (bytes) toast('Guardada em Minhas músicas');
    if ($('library').open) refreshLibrary();
  } catch (err) {
    console.warn('Não consegui guardar em Minhas músicas', err);
    if (!bytes) return;
    if (state.libId === entry.id) state.libId = null;
    toast('A música abriu, mas não consegui guardar em Minhas músicas (navegação privada ou sem espaço no navegador).');
  }
}

// Guarda a faixa, a velocidade e onde a pessoa parou na música aberta.
let rememberTimer = null;
function rememberPlace() {
  clearTimeout(rememberTimer);
  if (!state.libId || !state.score) return;
  // posição ainda por restaurar (música recém-aberta ou MIDI refeita): vale a que vai voltar
  const seek = state.pendingSeek && performance.now() <= state.pendingSeek.until ? state.pendingSeek : null;
  library.update(state.libId, {
    trackIndex: state.trackIndex,
    speed: +$('speed').value / 100,
    tick: Math.max(0, Math.round(seek ? seek.tick : state.lastTick)),
    lastUsed: Date.now(),
  }).catch((err) => console.warn('Não consegui guardar onde você parou', err));
}

function rememberSoon() {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(rememberPlace, 1500);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) rememberPlace();
});
window.addEventListener('pagehide', rememberPlace);

let libItems = []; // null = biblioteca indisponível neste navegador

async function refreshLibrary() {
  try {
    libItems = await library.list();
  } catch (err) {
    console.warn('Minhas músicas indisponível', err);
    libItems = null;
  }
  renderLibrary();
}

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function usedText(time) {
  const day = (t) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((day(Date.now()) - day(time)) / 86400000);
  if (days <= 0) return 'usada hoje';
  if (days === 1) return 'usada ontem';
  if (days < 30) return `usada há ${days} dias`;
  return `usada em ${new Date(time).toLocaleDateString('pt-BR')}`;
}

function renderLibrary() {
  const list = $('libList');
  const query = $('libSearch').value.trim();
  const findLink = (text) => `<button class="link" data-find>${text}</button>`;
  if (!libItems) {
    list.innerHTML = '<li class="empty">Minhas músicas não funciona neste navegador (talvez esteja em navegação privada). Os arquivos abrem normalmente, só não ficam guardados.</li>';
    return;
  }
  if (!libItems.length) {
    list.innerHTML = `<li class="empty">Nenhuma música guardada ainda. Use "Abrir arquivo" ou arraste um arquivo Guitar Pro, MusicXML ou alphaTex para a janela. Ainda não tem a tab? ${findLink('Procurar tab')}</li>`;
    return;
  }
  const q = plain(query);
  const shown = q ? libItems.filter((m) => plain(`${m.title} ${m.artist} ${m.fileName}`).includes(q)) : libItems;
  if (!shown.length) {
    list.innerHTML = `<li class="empty">Nenhuma música sua com "${escapeHtml(query)}". ${findLink('Procurar essa tab na internet')}</li>`;
    return;
  }
  list.innerHTML = shown.map((m) => {
    const title = m.title || m.fileName;
    const sub = [m.artist, m.title ? m.fileName : ''].filter(Boolean).join(' · ');
    const secs = progress.songStats(songKeyOf(m.title, m.artist, m.fileName))?.seconds ?? 0;
    const current = m.id === state.libId;
    return `<li class="lib-item${current ? ' current' : ''}">
      <button class="lib-open" data-open="${m.id}">
        <b>${escapeHtml(title)}</b>
        ${sub ? `<small>${escapeHtml(sub)}</small>` : ''}
        <small>${current ? 'Aberta agora · ' : ''}${secs ? `${formatMinutes(secs)} praticados` : 'ainda sem prática'} · ${usedText(m.lastUsed)}</small>
      </button>
      <button class="btn small" data-remove="${m.id}" aria-label="Remover ${escapeHtml(title)}">Remover</button>
    </li>`;
  }).join('');
}

async function openFromLibrary(id) {
  $('library').close();
  if (id === state.libId) return; // já está aberta
  rememberPlace();
  let entry = null;
  let bytes = null;
  try {
    entry = await library.get(id);
    bytes = entry && (await library.bytes(id));
  } catch (err) {
    console.warn(err);
  }
  if (!bytes) {
    toast('Não consegui abrir essa música de Minhas músicas.');
    return;
  }
  showLoading(`Abrindo ${entry.title || entry.fileName}…`);
  openScore(entry, bytes, false);
}

async function removeFromLibrary(id) {
  const m = libItems?.find((x) => x.id === id);
  if (!m || !confirm(`Remover "${m.title || m.fileName}" de Minhas músicas? O arquivo guardado neste navegador é apagado; os minutos e recordes continuam.`)) return;
  try {
    await library.remove(id);
    if (state.libId === id) state.libId = null;
  } catch (err) {
    console.warn(err);
    toast('Não consegui remover essa música.');
  }
  refreshLibrary();
}

$('libraryBtn').addEventListener('click', () => {
  $('libSearch').value = '';
  renderLibrary();
  $('library').showModal();
  refreshLibrary();
});
$('libClose').addEventListener('click', () => $('library').close());
$('libAdd').addEventListener('click', () => {
  $('library').close();
  $('fileInput').click();
});
$('libSearch').addEventListener('input', renderLibrary);
$('libList').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  const remove = e.target.closest('[data-remove]');
  if (open) openFromLibrary(open.dataset.open);
  else if (remove) removeFromLibrary(remove.dataset.remove);
  else if (e.target.closest('[data-find]')) {
    $('library').close();
    openFindTab($('libSearch').value.trim());
  }
});

// ---------- Procurar tab (só abre a busca dos sites; nada é baixado pelo app) ----------

const TAB_SEARCH = {
  ftSongsterr: (q) => `https://www.songsterr.com/?pattern=${encodeURIComponent(q)}`,
  // type=500 é o filtro "Guitar Pro" da busca do Ultimate Guitar
  ftUltimate: (q) => `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}&type=500`,
};

function updateTabLinks() {
  const q = $('ftQuery').value.trim();
  for (const [id, url] of Object.entries(TAB_SEARCH)) $(id).href = url(q);
}

function openFindTab(query = '') {
  if (query) $('ftQuery').value = query;
  updateTabLinks();
  $('findTab').showModal();
  $('ftQuery').select();
}

$('findTabBtn').addEventListener('click', () => openFindTab());
$('ftClose').addEventListener('click', () => $('findTab').close());
$('ftQuery').addEventListener('input', updateTabLinks);
$('ftForm').addEventListener('submit', (e) => e.preventDefault());
$('ftForm').addEventListener('click', (e) => {
  if (!e.target.closest('.ft-sites a') || $('ftQuery').value.trim()) return;
  e.preventDefault();
  $('ftQuery').reportValidity();
  $('ftQuery').focus();
});

let soundFontFallbackUsed = false;
api.error.on((err) => {
  console.error(err);
  // Troca de banco que falhou: o banco anterior continua carregado no tocador.
  if (state.bankLoading) {
    const { target, previous } = state.bankLoading;
    state.bankLoading = null;
    state.bank = previous;
    renderBanks(`Não consegui carregar o ${BANKS[target].label}; continua o ${BANKS[previous].label}.`);
    $('playBtn').disabled = false;
    setPlayLabel(state.playing);
    return;
  }
  // Banco inicial que não carregou (antes do tocador ficar pronto): usa o Sonivox.
  const text = `${err?.constructor?.name ?? ''} ${err?.message ?? ''} ${err?.stack ?? ''}`;
  const aboutSoundFont = /FileLoadError|sound ?font|\.sf[23]|riff|hydra/i.test(text);
  if (!soundFontFallbackUsed && !api.isReadyForPlayback && aboutSoundFont && state.bank !== 'sonivox') {
    soundFontFallbackUsed = true;
    console.warn(`Banco ${BANKS[state.bank].label} indisponível, usando o Sonivox`);
    const failed = BANKS[state.bank].label;
    state.bank = 'sonivox';
    tone.setTrim(BANKS.sonivox.trim);
    renderBanks(`O ${failed} não carregou; usando o Sonivox.`);
    api.loadSoundFontFromUrl(BANKS.sonivox.url, false);
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
  state.songKey = songKeyOf(score.title, score.artist, state.fileName);
  state.pass = null;
  const opening = state.opening;
  state.opening = null;
  state.libId = opening?.entry.id ?? null;
  const saved = opening?.entry;
  state.lastTick = 0; // a posição da música anterior não vale para esta
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
  if (score.tracks[saved?.trackIndex]) first = saved.trackIndex;
  state.mix = score.tracks.map((_, i) => ({ volume: 1, muted: i !== first }));
  state.trackIndex = -1;
  selectTrack(first, first > 0);
  if (saved?.speed) {
    $('speed').value = Math.round(saved.speed * 100);
    api.playbackSpeed = +$('speed').value / 100;
  }
  // O tocador volta ao início quando recebe a MIDI desta música e ignoraria um tickPosition
  // enviado agora; a posição é aplicada quando ele avisar que voltou (playerPositionChanged).
  if (saved?.tick > 0) state.pendingSeek = { tick: saved.tick, until: performance.now() + 10000 };
  updateSpeedLabel();
  if (opening) addToLibrary(score, opening);
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

$('trackSelect').addEventListener('change', (e) => {
  selectTrack(+e.target.value, true, true);
  rememberSoon();
});

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

// ---------- banco de sons ----------

function renderBanks(status = '') {
  $('banks').innerHTML = Object.entries(BANKS)
    .map(([id, b]) => `<button class="${id === state.bank ? 'active' : ''}" data-bank="${id}">${b.label} <small>${b.size}</small></button>`)
    .join('');
  $('bankStatus').textContent = status;
}

function chooseBank(id) {
  if (id === state.bank || state.bankLoading || !BANKS[id]) return;
  state.bankLoading = { target: id, previous: state.bank, wasPlaying: state.playing };
  state.bank = id;
  renderBanks(`Carregando ${BANKS[id].label}…`);
  $('playBtn').disabled = true;
  api.loadSoundFontFromUrl(BANKS[id].url, false);
}

// Chamado quando o tocador fica pronto de novo depois de trocar de banco.
function finishBankChange() {
  const done = state.bankLoading;
  state.bankLoading = null;
  try {
    localStorage.setItem(BANK_KEY, state.bank);
  } catch {
    // sem armazenamento: só não lembra na próxima vez
  }
  renderBanks();
  tone.setTrim(BANKS[state.bank].trim);
  toast(`Banco de sons: ${BANKS[state.bank].label}`);
  // Refaz a MIDI para cada faixa pegar o instrumento certo no banco novo.
  regenerateMidi();
  if (done.wasPlaying) setTimeout(() => api.play(), 50);
}

$('banks').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bank]');
  if (btn) chooseBank(btn.dataset.bank);
});

renderBanks();

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

  document.querySelectorAll('button[data-strategy]').forEach((b) => {
    b.classList.toggle('active', a.ok && b.dataset.strategy === a.strategy);
  });

  if (!a.ok) {
    $('diagram').innerHTML = '';
    $('coachName').textContent = '–';
    $('coachName').classList.remove('linked');
    $('coachName').removeAttribute('role');
    state.shownItem = null;
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

document.querySelectorAll('button[data-strategy]').forEach((b) => {
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
  state.shownItem = item;
  $('diagram').innerHTML = diagramSVG(item, a.strings);
  $('coachKicker').textContent = hold ? 'Segure' : kicker;
  $('coachName').textContent = prettyName(item.shape.name);
  const linked = coachChord() != null;
  $('coachName').classList.toggle('linked', linked);
  if (linked) $('coachName').setAttribute('role', 'button');
  else $('coachName').removeAttribute('role');
  $('coachName').tabIndex = linked ? 0 : -1;
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
let practiceTicks = 0;
setInterval(() => {
  if (!state.playing && !trainer.running) return;
  progress.practice(state.songKey, state.songTitle, 1);
  renderProgress();
  if (state.playing && ++practiceTicks % 10 === 0) rememberPlace();
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
  if (!e.total) return;
  const pct = Math.round((e.loaded / e.total) * 100);
  $('playBtn').textContent = `Carregando som… ${pct}%`;
  if (state.bankLoading) $('bankStatus').textContent = `Carregando ${BANKS[state.bankLoading.target].label}… ${pct}%`;
});

api.playerReady.on(() => {
  $('playBtn').disabled = false;
  setPlayLabel(false);
  applyTransport();
  applyMix();
  if (state.bankLoading) finishBankChange();
});
// Não assinar api.midiLoaded: no alphaTab 1.8.4 isso entra em recursão infinita
// (o getter loadedMidiInfo do sintetizador em worker chama a si mesmo).

api.playerStateChanged.on((e) => {
  state.playing = e.state === 1;
  setPlayLabel(state.playing);
  if (!state.playing) rememberPlace();
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
    else {
      state.pass = null;
      rememberSoon();
    }
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
  rememberSoon();
});
$('metro').addEventListener('change', applyTransport);
$('countIn').addEventListener('change', applyTransport);
$('loop').addEventListener('change', applyTransport);
// Repete o compasso mostrado na faixa de batida (arrastar na tablatura é difícil no celular).
$('loopBar').addEventListener('click', () => {
  const bar = state.analysis?.ok && state.analysis.bars[state.laneBar];
  const cache = api.tickCache;
  if (!bar || !bar.beats.length || !cache) return;
  const first = bar.beats[0];
  const last = bar.beats[bar.beats.length - 1];
  const start = cache.getBeatStart(first);
  api.playbackRange = { startTick: start, endTick: cache.getBeatStart(last) + last.playbackDuration };
  api.highlightPlaybackRange(first, last);
  $('loop').checked = true;
  applyTransport();
  $('clearRange').hidden = false;
  if (!state.playing) api.tickPosition = start;
  toast(`Repetindo o compasso ${state.laneBar + 1}`);
});

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
  rememberSoon();
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
