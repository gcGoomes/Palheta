// Progresso de estudo: tempo praticado por dia e por música, dias seguidos e recordes
// (velocidade numa volta completa e BPM nas trocas de acorde). Fica no localStorage
// deste navegador; se ele não estiver disponível, o app funciona igual, só não lembra.

const KEY = 'guitarra-guiada:progresso';
const SAVE_EVERY_MS = 15000;

export const dayKey = (date = new Date()) => date.toLocaleDateString('sv'); // AAAA-MM-DD local

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (data && data.days && data.songs && data.pairs) return data;
  } catch {
    // dado corrompido ou armazenamento bloqueado: começa do zero
  }
  return { days: {}, songs: {}, pairs: {} };
}

export function createProgress() {
  const data = load();
  let dirty = false;
  let lastSave = Date.now();

  const save = () => {
    if (!dirty) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // sem armazenamento: segue sem lembrar
    }
    dirty = false;
    lastSave = Date.now();
  };
  const touch = () => {
    dirty = true;
    if (Date.now() - lastSave > SAVE_EVERY_MS) save();
  };
  const song = (key, title) => {
    data.songs[key] ??= { title, seconds: 0, bestFull: 0, sections: {} };
    if (title) data.songs[key].title = title;
    return data.songs[key];
  };

  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  return {
    // Soma tempo de prática (em segundos) no dia de hoje e na música.
    practice(songKey, title, seconds) {
      const today = dayKey();
      data.days[today] = (data.days[today] ?? 0) + seconds;
      if (songKey) song(songKey, title).seconds += seconds;
      touch();
    },

    // Velocidade (0–1) de uma volta completa: na música inteira (section = null) ou num
    // trecho (section = "compassos 1–4"). Devolve true quando é recorde novo.
    recordSpeed(songKey, title, speed, section = null) {
      const s = song(songKey, title);
      if (section) {
        if (speed <= (s.sections[section] ?? 0)) return false;
        s.sections[section] = speed;
      } else {
        if (speed <= s.bestFull) return false;
        s.bestFull = speed;
      }
      dirty = true;
      save();
      return true;
    },

    pair(pairKey) {
      return data.pairs[pairKey] ?? null;
    },

    // Rodada limpa no treino de trocas. Recorde = maior BPM; empate no BPM vale se trocou mais rápido.
    recordPair(pairKey, label, bpm, every) {
      const old = data.pairs[pairKey];
      const better = !old || bpm / every > old.bpm / old.every;
      data.pairs[pairKey] = {
        label,
        rounds: (old?.rounds ?? 0) + 1,
        bpm: better ? bpm : old.bpm,
        every: better ? every : old.every,
      };
      dirty = true;
      save();
      return better;
    },

    songStats(songKey) {
      return data.songs[songKey] ?? null;
    },

    pairsOf(songKey) {
      return Object.entries(data.pairs)
        .filter(([k]) => k.startsWith(`${songKey}::`))
        .map(([, v]) => v);
    },

    secondsOn(day) {
      return data.days[day] ?? 0;
    },

    // Dias seguidos com pelo menos 1 minuto de prática. Se hoje ainda não chegou a 1 minuto,
    // a sequência até ontem continua valendo.
    streak() {
      const d = new Date();
      if (!(data.days[dayKey(d)] >= 60)) d.setDate(d.getDate() - 1);
      let count = 0;
      while (data.days[dayKey(d)] >= 60) {
        count++;
        d.setDate(d.getDate() - 1);
      }
      return count;
    },

    save,
  };
}

export function formatMinutes(seconds) {
  const min = Math.floor(seconds / 60);
  if (min < 1) return seconds > 0 ? '< 1 min' : '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
