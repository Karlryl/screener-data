'use strict';
/**
 * gelesene-felder - beobachtet, welche Snapshot-Felder das Scoring TATSAECHLICH liest.
 *
 * Warum es das gibt (Gerichtsauflage 23.08., Fall Fussabdruck-Vertrag, Lektion L37): der
 * `inputHash` fuehrte seine kohorten-bestimmenden Felder von Hand und deckte drei von
 * dreizehn. Der eigene Waechter fand es nicht, weil er nur pruefte, was auf der Liste stand.
 *
 * Warum ein Proxy und kein Grep: eine Textsuche nach `s.meta.X` ist ein SCHREIBMUSTER. Wer
 * `const m = s.meta; m.industry` schreibt, entkommt ihr - und ein Waechter, der die
 * Schreibweise festnagelt statt der Sache, wird selbst zum Ausfall (L32, L-27.07-d). Ein Proxy
 * zeichnet auf, was der Code beim Laufen ANFASST. Das ist die Sache selbst.
 *
 * Tiefe 2 mit Absicht: aufgezeichnet wird `container.feld` (z. B. `meta.industry`,
 * `marketCap.value`, `annual.annualRev`), darunter kommt der ROHE Wert zurueck. Sonst wandern
 * Proxies in Zahlen-Arrays und in alles, was das Scoring weiterreicht oder serialisiert - und
 * die Aufzeichnung waere Rauschen statt Signal.
 *
 * GRENZE, ehrlich benannt: beobachtet wird nur, was die uebergebenen Snapshots an Codepfaden
 * ausloesen. Ein Zweig, den keiner der Proben-Snapshots erreicht, bleibt unsichtbar. Deshalb
 * gehoeren in die Probe bewusst verschiedene Faelle (profitabel/unprofitabel, geroutet/
 * ausgeschlossen, verschiedene Sektoren und Waehrungen) - und deshalb ist die Zahl der
 * beobachteten Felder eine UNTERGRENZE, nie eine Vollstaendigkeitsgarantie.
 */

/**
 * beobachte(snapshots, lauf) -> Set<string> der gelesenen `container.feld`-Pfade.
 * `lauf` bekommt die eingepackten Snapshots und muss das Scoring darauf ausfuehren.
 */
function beobachte(snapshots, lauf) {
  const gelesen = new Set();

  const packeContainer = (obj, containerName) => new Proxy(obj, {
    get(ziel, prop) {
      if (typeof prop === 'string') gelesen.add(`${containerName}.${prop}`);
      return ziel[prop];           // ROH zurueck - kein Proxy tiefer
    },
    has(ziel, prop) {
      if (typeof prop === 'string') gelesen.add(`${containerName}.${prop}`);
      return prop in ziel;
    },
    ownKeys(ziel) {
      // Wer die Schluessel aufzaehlt, liest potenziell alle - konservativ alle vermerken.
      for (const k of Object.keys(ziel)) gelesen.add(`${containerName}.${k}`);
      return Reflect.ownKeys(ziel);
    },
  });

  const packeWurzel = (s) => new Proxy(s, {
    get(ziel, prop) {
      const v = ziel[prop];
      if (typeof prop !== 'string') return v;
      gelesen.add(prop);           // Top-Level-Block selbst (z. B. "secAnnual")
      if (v && typeof v === 'object' && !Array.isArray(v)) return packeContainer(v, prop);
      return v;
    },
    set(ziel, prop, wert) { ziel[prop] = wert; return true; },   // mergeSecIntoUniverse haengt an
    has(ziel, prop) { return prop in ziel; },
    ownKeys(ziel) { return Reflect.ownKeys(ziel); },
  });

  lauf(snapshots.map(packeWurzel));
  return gelesen;
}

/**
 * Nur die Blatt-Pfade (`container.feld`), ohne die blossen Top-Level-Blocknamen.
 * Die Blocknamen entstehen bei jedem Zugriff mit und sind fuer die Abdeckungsfrage Rauschen.
 */
function nurBlattpfade(gelesen) {
  return new Set([...gelesen].filter((p) => p.includes('.')));
}

module.exports = { beobachte, nurBlattpfade };
