// Desenha diagramas de acorde (cordas na vertical, a mais grave à esquerda) em SVG.

const FRETS_SHOWN = 5;

export function diagramSVG(item, strings, { width = 150, compact = false } = {}) {
  const notes = item.notes;
  const fingering = item.fingering ?? { fingers: {}, barres: [] };
  const n = strings.length;
  const fretted = notes.filter((x) => x.fret > 0 && !x.dead);
  const maxFret = fretted.length ? Math.max(...fretted.map((x) => x.fret)) : 0;
  const minFret = fretted.length ? Math.min(...fretted.map((x) => x.fret)) : 1;
  const first = maxFret <= FRETS_SHOWN ? 1 : minFret;

  const padL = first > 1 ? 26 : 16;
  const padR = 16;
  const top = compact ? 18 : 24;
  const fretH = compact ? 20 : 26;
  const r = compact ? 7 : 9.5;
  const height = top + fretH * FRETS_SHOWN + (compact ? 6 : 20);
  const dx = (width - padL - padR) / (n - 1);
  const X = (s) => padL + (s - 1) * dx;
  const Y = (fret) => top + (fret - first + 0.5) * fretH;

  let svg = `<svg class="diagram" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Diagrama de ${item.shape.name}">`;

  for (let f = 0; f <= FRETS_SHOWN; f++) {
    const y = top + f * fretH;
    svg += `<line x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}" class="${f === 0 && first === 1 ? 'dg-nut' : 'dg-fret'}"/>`;
  }
  for (let s = 1; s <= n; s++) {
    svg += `<line x1="${X(s)}" x2="${X(s)}" y1="${top}" y2="${top + FRETS_SHOWN * fretH}" class="dg-string"/>`;
  }
  if (first > 1) {
    svg += `<text x="${padL - 5}" y="${Y(first) + 4}" text-anchor="end" class="dg-pos">${first}ª</text>`;
  }

  for (let s = 1; s <= n; s++) {
    const note = notes.find((x) => x.string === s);
    const mark = !note || note.dead ? '×' : note.fret === 0 ? '○' : '';
    if (mark) svg += `<text x="${X(s)}" y="${top - 6}" text-anchor="middle" class="dg-mark">${mark}</text>`;
  }

  const inBarre = new Set();
  for (const b of fingering.barres) {
    const covered = fretted.filter((x) => fingering.fingers[x.string] === b.finger && x.fret === b.fret);
    covered.forEach((x) => inBarre.add(x.string));
    const tied = covered.every((x) => x.tied);
    const x1 = X(b.from) - r, x2 = X(b.to) + r, y = Y(b.fret);
    svg += `<rect x="${x1}" y="${y - r}" width="${x2 - x1}" height="${2 * r}" rx="${r}" class="dg-dot${tied ? ' tied' : ''}"/>`;
    svg += `<text x="${(X(b.from) + X(b.to)) / 2}" y="${y + 4}" text-anchor="middle" class="dg-num${tied ? ' tied' : ''}">${b.finger}</text>`;
  }
  for (const x of fretted) {
    if (inBarre.has(x.string)) continue;
    const finger = fingering.fingers[x.string];
    svg += `<circle cx="${X(x.string)}" cy="${Y(x.fret)}" r="${r}" class="dg-dot${x.tied ? ' tied' : ''}"/>`;
    if (finger) svg += `<text x="${X(x.string)}" y="${Y(x.fret) + 4}" text-anchor="middle" class="dg-num${x.tied ? ' tied' : ''}">${finger}</text>`;
  }

  if (!compact) {
    for (const s of strings) {
      const name = s.name.replace(/([A-G])b/, '$1♭').replace('#', '♯');
      svg += `<text x="${X(s.string)}" y="${height - 4}" text-anchor="middle" class="dg-label">${name}</text>`;
    }
  }
  return svg + '</svg>';
}

export function arrowSVG(dir, size = 22) {
  const d = dir === 'down' ? 'M12 3v17m-6.5-6.5L12 20l6.5-6.5' : 'M12 21V4m-6.5 6.5L12 4l6.5 6.5';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
