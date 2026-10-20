// Biblioteca "Minhas músicas": guarda os arquivos abertos no IndexedDB deste navegador.
// Dois depósitos: "musicas" tem só os dados pequenos (nome, título, onde parou), para a lista
// abrir rápido; "arquivos" tem os bytes, lidos só na hora de abrir a música.

const DB_NAME = 'palheta';
const DB_VERSION = 1;
const SONGS = 'musicas';
const FILES = 'arquivos';

// Identificador pelo conteúdo: o mesmo arquivo aberto de novo (até com outro nome) cai na mesma
// entrada. Hash simples (cyrb53) em vez de crypto.subtle, que não existe fora de https/localhost
// (ex.: celular abrindo o app pelo IP do computador).
export function fileId(bytes) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}-${bytes.length}`;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('transação cancelada'));
});

export function createLibrary() {
  let opening = null;

  // Navegação privada e navegadores antigos podem recusar ou travar a abertura;
  // depois de 4 s desiste, e o app segue sem biblioteca.
  function db() {
    opening ??= new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) throw new Error('IndexedDB indisponível');
      const timer = setTimeout(() => reject(new Error('IndexedDB não respondeu')), 4000);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(SONGS, { keyPath: 'id' });
        req.result.createObjectStore(FILES, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const conn = req.result;
        conn.onversionchange = () => conn.close();
        resolve(conn);
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error);
      };
    });
    return opening;
  }

  return {
    // Mais recentes primeiro.
    async list() {
      const conn = await db();
      const all = await done(conn.transaction(SONGS).objectStore(SONGS).getAll());
      return all.sort((a, b) => b.lastUsed - a.lastUsed);
    },

    async get(id) {
      const conn = await db();
      return (await done(conn.transaction(SONGS).objectStore(SONGS).get(id))) ?? null;
    },

    async bytes(id) {
      const conn = await db();
      const rec = await done(conn.transaction(FILES).objectStore(FILES).get(id));
      return rec ? new Uint8Array(rec.bytes) : null;
    },

    // bytes só na primeira vez (a música nova); depois basta atualizar os dados.
    async save(entry, bytes = null) {
      const conn = await db();
      const tx = conn.transaction([SONGS, FILES], 'readwrite');
      tx.objectStore(SONGS).put(entry);
      if (bytes) tx.objectStore(FILES).put({ id: entry.id, bytes: bytes.slice().buffer });
      await finished(tx);
    },

    // Muda alguns campos; se a música foi removida nesse meio-tempo, não recria.
    async update(id, patch) {
      const conn = await db();
      const tx = conn.transaction(SONGS, 'readwrite');
      const store = tx.objectStore(SONGS);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) store.put({ ...req.result, ...patch });
      };
      await finished(tx);
    },

    async remove(id) {
      const conn = await db();
      const tx = conn.transaction([SONGS, FILES], 'readwrite');
      tx.objectStore(SONGS).delete(id);
      tx.objectStore(FILES).delete(id);
      await finished(tx);
    },
  };
}
