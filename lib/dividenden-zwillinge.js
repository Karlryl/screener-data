'use strict';
/**
 * Report only: firms whose listings show dividend yields (filter feed field dy, percent) more than a factor
 * of two apart. Tokio Marine 24.36 % against 2.68 % at the ADR (2026-10-31) is the case that named it. This is a
 * search signal, not a verdict: a preferred share or a second share class may pay a different yield for real, and
 * Chinese A and H shares pay the same dividend per share at different prices. Nothing here reads or writes a
 * snapshot, and no board number depends on it.
 */
const nameKey = s => String(s).trim().toLowerCase();
const pct = v => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hasYield = r => Number.isFinite(r.dy) && r.dy > 0;

/**
 * @param {{universum: object[], top?: number}} opts universum: rows of filter/universum.json (t ticker, n name, dy yield in %, b board).
 * @returns {{firmen: number, mitBoard: number, zeilen: string[], beispiele: object[]}} A feed in which no row carries a
 *   yield at all is reported as not checkable, never as zero firms.
 */
function dividendenZwillinge({ universum, top = 5 }) {
  if (!universum.some(hasYield)) {
    return { firmen: null, mitBoard: null, beispiele: [], zeilen: [`Hinweis zur Dividendenrendite: Im Filter-Feed trägt keine der ${universum.length} Zeilen eine Rendite (Feld dy); der Vergleich der Notierungen ist nicht prüfbar, das ist keine Entwarnung.`] };
  }
  const gruppen = new Map();
  for (const r of universum) if (r.n && hasYield(r)) gruppen.set(nameKey(r.n), [...(gruppen.get(nameKey(r.n)) || []), r]);
  const mehrfach = [...gruppen.values()].filter(rows => rows.length >= 2);
  const treffer = [];
  for (const rows of mehrfach) {
    const hoch = Math.max(...rows.map(r => r.dy)), tief = Math.min(...rows.map(r => r.dy));
    if (hoch > 2 * tief) treffer.push({ name: rows[0].n, hoch, tief, faktor: hoch / tief, mitBoard: rows.some(r => r.b),
      zeilen: rows.map(r => ({ ticker: r.t, dy: r.dy })).sort((a, b) => b.dy - a.dy) });
  }
  treffer.sort((a, b) => b.faktor - a.faktor);
  const mitBoard = treffer.filter(t => t.mitBoard).length;
  if (!treffer.length) {
    return { firmen: 0, mitBoard: 0, beispiele: [], zeilen: [`Hinweis zur Dividendenrendite: Bei keiner der ${mehrfach.length} Firmen mit mindestens zwei Notierungen und Rendite liegen die Renditen mehr als das Doppelte auseinander.`] };
  }
  const beispiele = treffer.slice(0, top);
  const nenne = t => `${t.name} (${t.zeilen[t.zeilen.length - 1].ticker} ${pct(t.tief)} %, ${t.zeilen[0].ticker} ${pct(t.hoch)} %)`;
  return { firmen: treffer.length, mitBoard, beispiele, zeilen: [
    `Hinweis zur Dividendenrendite: Bei ${plural(treffer.length, 'Firma', 'Firmen')} liegt sie bei den Notierungen um mehr als das Doppelte auseinander, bei ${mitBoard} davon steht eine Notierung auf einem Board. Die größten Abstände: ${beispiele.map(nenne).join('; ')}. Das ist ein Suchsignal und nicht jede Abweichung ist falsch: Vorzugsaktien und zweite Aktiengattungen zahlen echt anders, und bei chinesischen A- und H-Aktien gleicht die Dividende je Aktie, nur die Kurse unterscheiden sich. Bei derselben Aktie an zwei indischen Börsen (NSE und BSE) ist eine Abweichung dagegen eher ein Datenfehler.`] };
}

module.exports = { dividendenZwillinge };
