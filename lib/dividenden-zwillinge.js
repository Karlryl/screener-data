'use strict';
/**
 * Report only: firms whose listings show dividend yields (filter feed field dy, percent) more than a factor
 * of two apart. Tokio Marine 24.36 % against 2.68 % at the ADR (2026-10-31) is the case that named it. This is a
 * search signal, not a verdict: a preferred share or a second share class may pay a different yield for real.
 * Nothing here reads or writes a snapshot, and no board number depends on it.
 */
const nameKey = s => String(s).trim().toLowerCase();
const pct = v => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

/**
 * @param {{universum: object[], top?: number}} opts universum: rows of filter/universum.json (t ticker, n name, dy yield in %, b board).
 * @returns {{firmen: number, mitBoard: number, zeilen: string[], beispiele: object[]}}
 */
function dividendenZwillinge({ universum, top = 5 }) {
  const gruppen = new Map();
  for (const r of universum) if (r.n && Number.isFinite(r.dy) && r.dy > 0) gruppen.set(nameKey(r.n), [...(gruppen.get(nameKey(r.n)) || []), r]);
  const treffer = [];
  for (const rows of gruppen.values()) {
    if (rows.length < 2) continue;
    const hoch = Math.max(...rows.map(r => r.dy)), tief = Math.min(...rows.map(r => r.dy));
    if (hoch > 2 * tief) treffer.push({ name: rows[0].n, hoch, tief, faktor: hoch / tief, mitBoard: rows.some(r => r.b),
      zeilen: rows.map(r => ({ ticker: r.t, dy: r.dy })).sort((a, b) => b.dy - a.dy) });
  }
  treffer.sort((a, b) => b.faktor - a.faktor);
  const mitBoard = treffer.filter(t => t.mitBoard).length;
  if (!treffer.length) return { firmen: 0, mitBoard: 0, zeilen: [], beispiele: [] };
  const beispiele = treffer.slice(0, top);
  const nenne = t => `${t.name} (${t.zeilen[t.zeilen.length - 1].ticker} ${pct(t.tief)} %, ${t.zeilen[0].ticker} ${pct(t.hoch)} %)`;
  return { firmen: treffer.length, mitBoard, beispiele, zeilen: [
    `Hinweis zur Dividendenrendite: Bei ${treffer.length} Firmen liegt sie bei den Notierungen um mehr als das Doppelte auseinander, bei ${mitBoard} davon steht eine Notierung auf einem Board. Weitester Abstand: ${beispiele.map(nenne).join('; ')}. Das ist ein Suchsignal und nicht jede Abweichung ist falsch, denn Vorzugsaktien und zweite Aktiengattungen zahlen echt anders; die großen Abstände sind zuerst gegen die Firmenangabe zu prüfen.`] };
}

module.exports = { dividendenZwillinge };
