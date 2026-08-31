'use strict';

// Laufzeit der Studien-Verfassung 2.0.0 — die vier evidenztragenden Regeln, die im
// Code leben muessen und nicht in einer Vorlage: R1 Zugriffs-Register, R2 Fenster-Mauer,
// R4 Ergebnis-Sperre, R6 Zeitpunkt-Ehrlichkeit (Vintage).
//
// Bewusst EINE Datei ohne Fremd-Abhaengigkeiten: node-Standardbibliothek, keine
// absoluten Pfade, keine Nutzer-Identitaeten, Speicherort nur ueber Umgebungsvariable
// (R12a). Wer die Studie auf einem anderen Rechner oder mit einem anderen Motor
// weiterfaehrt, braucht genau diese Datei und die Regel-Registry, sonst nichts.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REGELWERK_PFAD = path.join(__dirname, '..', 'protocol', 'early-detection', '2.0.0', 'rules.json');
const DATENWURZEL_ENV = 'EARLY_DETECTION_DATA_ROOT';

class VerfassungsBruch extends Error {}

// Kanonisierung — EXAKT festgeschrieben, nicht "irgendeine stabile Form".
//
// Erzeuger (Python) und Pruefer (JS) hatten denselben unterspezifizierten
// chainAlgorithm erfuellt und trotzdem verschiedene Bytes erzeugt: Python schreibt
// per Vorgabe `", "` und `": "`, JS schrieb `,` und `:`. Die realen Eintraege sind
// mit der Python-Form gehasht; also ist die Python-Form die Regel:
//   - Schluessel sortiert
//   - Elementtrenner ", "  ·  Schluesseltrenner ": "
//   - Nicht-ASCII roh (kein \uXXXX), UTF-8
//   - gehasht wird {previousHash + alle Eintragsfelder ausser eventHash}
// Entspricht json.dumps(obj, sort_keys=True, ensure_ascii=False).
// Zahlen: Python-repr und JS-toString liefern beide die kuerzeste rundlauf-treue
// Darstellung und stimmen daher bei gewoehnlichen Dezimalzahlen ueberein (0.9 -> "0.9").
// Sie weichen ab, sobald Exponentialschreibweise ins Spiel kommt (Python "1e-07" gegen
// JS "1e-7") und bei negativer Null (Python "-0.0" gegen JS "0"). Genau diese Faelle
// werden abgewiesen statt stillschweigend falsch gehasht.
// BEKANNTE GRENZE, hier benannt statt versteckt: ob Python eine ganzzahlige Gleitkomma-
// zahl als "1.0" geschrieben hat, ist nach dem JSON-Parsen in JS nicht mehr erkennbar
// (dort ist es die Zahl 1). Solche Werte kommen im Register nicht vor; kaemen sie dazu,
// braeuchte die Kanonisierung eine Typangabe in der Datei.
function kanonisch(wert) {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(', ')}]`;
  if (wert && typeof wert === 'object') {
    return `{${Object.keys(wert).sort().map((k) => `${kanonisch(k)}: ${kanonisch(wert[k])}`).join(', ')}}`;
  }
  if (wert === undefined || wert === null) return 'null';
  if (typeof wert === 'boolean') return wert ? 'true' : 'false';
  if (typeof wert === 'number') {
    if (!Number.isFinite(wert)) {
      throw new VerfassungsBruch(`R1: nicht-endliche Zahl (${wert}) im Register`);
    }
    if (Object.is(wert, -0)) {
      throw new VerfassungsBruch('R1: negative Null im Register — Python und JS schreiben sie verschieden');
    }
    const text = String(wert);
    if (/[eE]/.test(text)) {
      throw new VerfassungsBruch(
        `R1: Zahl in Exponentialschreibweise (${text}) — Python und JS setzen den Exponenten verschieden`,
      );
    }
    return text;
  }
  // JSON.stringify laesst Nicht-ASCII roh und escapt nur Steuerzeichen, Anfuehrungs-
  // zeichen und Backslash — deckungsgleich mit Pythons ensure_ascii=False.
  return JSON.stringify(wert);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function ladeRegelwerk(pfad = REGELWERK_PFAD) {
  return JSON.parse(fs.readFileSync(pfad, 'utf8'));
}

function datenwurzel() {
  const wert = process.env[DATENWURZEL_ENV];
  if (!wert) {
    throw new VerfassungsBruch(
      `Speicherort unbekannt: ${DATENWURZEL_ENV} ist nicht gesetzt (R12a verbietet einen fest verdrahteten Pfad)`,
    );
  }
  return wert;
}

// ── R2: Fenster-Mauer ──────────────────────────────────────────────────────────
// Entdecken, Pruefen und Endtest sind physisch getrennte Zeitraeume mit Pufferjahren
// dazwischen (reifebereinigt: jedes Ereignis braucht 4 Folgequartale). Eine Anfrage
// nach einem fremden Quartal ist kein Warnfall, sondern ein Abbruch.

function quartalsSchluessel(quartal) {
  const treffer = /^(\d{4})q([1-4])$/.exec(String(quartal).toLowerCase());
  if (!treffer) throw new VerfassungsBruch(`Kein gueltiger Quartalsschluessel: ${quartal}`);
  return Number(treffer[1]) * 4 + Number(treffer[2]) - 1;
}

function fensterAus(regelwerk, modus) {
  const fenster = (regelwerk.fenster || {})[modus];
  if (!fenster) {
    throw new VerfassungsBruch(`Unbekannter Modus: ${modus} (erlaubt: ${Object.keys(regelwerk.fenster || {}).join(', ')})`);
  }
  return fenster;
}

function pruefeFenster(modus, quartal, optionen = {}) {
  const regelwerk = optionen.regelwerk || ladeRegelwerk();
  const fenster = fensterAus(regelwerk, modus);
  const schluessel = quartalsSchluessel(quartal);
  const von = quartalsSchluessel(fenster.von);
  const bis = quartalsSchluessel(fenster.bis);
  if (schluessel < von || schluessel > bis) {
    throw new VerfassungsBruch(
      `R2: Quartal ${quartal} liegt ausserhalb des Fensters '${modus}' (${fenster.von}..${fenster.bis}) — Fenster-Mauer verletzt`,
    );
  }
  if (fenster.versiegelt && optionen.oeffnungsprotokoll !== regelwerk.oeffnungsprotokollMarke) {
    throw new VerfassungsBruch(
      `R2/R4: Das Fenster '${modus}' ist versiegelt und wird genau einmal nach Oeffnungsprotokoll geoeffnet`,
    );
  }
  return true;
}

// ── R4: Ergebnis-Sperre ────────────────────────────────────────────────────────
// Kurse, Renditen und Ergebnis-Etiketten fliessen nie in die Signal-Konstruktion.
// Jeder Lauf protokolliert, ob er Ergebnisdaten beruehrt hat — und darf sie nur lesen,
// wenn genau dieser Lauf VORHER im Zugriffs-Register angemeldet wurde (R1).

function starteLauf({ laufId, modus, register = null, regelwerk = null }) {
  if (!laufId) throw new VerfassungsBruch('R4: Jeder Lauf braucht eine laufId');
  const geladen = regelwerk || ladeRegelwerk();
  const angemeldet = new Set(
    ((register && register.events) || [])
      // Die realen Eintraege tragen `typ`, der Filter sah nur `type`. Bis E3 harmlos,
      // danach haette R4 legitime, ordnungsgemaess angemeldete Laeufe abgewiesen.
      .filter((event) => (event.typ || event.type) === ART_ZUGRIFF)
      .map((event) => event.runId),
  );
  const protokoll = {
    laufId,
    modus,
    ergebnisdatenBeruehrt: false,
    geleseneEndpunkte: [],
    regelwerkVersion: geladen.version,
  };
  return {
    protokoll: () => ({ ...protokoll, geleseneEndpunkte: [...protokoll.geleseneEndpunkte] }),
    leseSignaldaten(quartal) {
      pruefeFenster(modus, quartal, { regelwerk: geladen });
      return true;
    },
    leseErgebnisdaten(endpunkt) {
      // R4/E3 — Endpunkt-Klassen-Sperre. Sie steht VOR der Anmeldungs-Pruefung, und
      // das ist der ganze Punkt: ein verbrauchter Endpunkt bleibt auch fuer einen
      // ordnungsgemaess angemeldeten Lauf gesperrt. Eine Sperre, die sich durch eine
      // Anmeldung aufheben liesse, waere keine.
      pruefeEndpunktKlasse(endpunkt, geladen);
      if (!angemeldet.has(laufId)) {
        throw new VerfassungsBruch(
          `R4: Lauf ${laufId} liest Ergebnisdaten '${endpunkt}', ohne im Zugriffs-Register angemeldet zu sein`,
        );
      }
      protokoll.ergebnisdatenBeruehrt = true;
      protokoll.geleseneEndpunkte.push(endpunkt);
      return true;
    },
  };
}

// ── R4/E3: Endpunkt-Klassen-Sperre ────────────────────────────────────────────
// Ein Endpunkt, der einmal praeregistriert getestet wurde, ist fuer seine Signalfamilie
// aufgebraucht. Die Sperre lebt an drei Orten (Praeregistrierung, Registry, Laufzeit) —
// hier ist die Laufzeit.
//
// GESUCHT WIRD ALS TEILSTRING, und das ist eine bewusste Entscheidung gegen die
// elegantere Wortgrenzen-Variante: die erste Fassung zerlegte den Namen in Woerter und
// liess 'kursrendite_x' glatt durch, weil 'kursrendite' nun einmal nicht 'kurs' ist.
// Deutsche Zusammensetzungen (Aktienkurs, Kursausbruch, Renditereihe) haetten die Sperre
// am ersten Tag entwertet. Der Preis der Teilstring-Suche ist Falsch-Rot bei Woertern wie
// 'diskurs' — das kostet eine Umbenennung. Falsch-Gruen kostet die Studie.

function endpunktSperren(regelwerk) {
  const r4 = (regelwerk.regeln || []).find((regel) => regel.id === 'R4');
  return (r4 && r4.endpunktSperren) || [];
}

function pruefeEndpunktKlasse(endpunkt, regelwerk) {
  if (!endpunkt) throw new VerfassungsBruch('R4: Ein Ergebnis-Zugriff ohne Endpunkt-Namen existiert nicht');
  const sperren = endpunktSperren(regelwerk);
  if (sperren.length === 0) {
    // Fail-closed: eine leere Sperrliste ist kein Freibrief, sondern ein kaputtes
    // Regelwerk. Wer die Liste leert, soll das merken — nicht erst der Endbericht.
    throw new VerfassungsBruch(
      'R4: Die Registry fuehrt keine endpunktSperren. Ohne sie ist nicht entscheidbar, '
      + 'ob dieser Endpunkt verbraucht ist — der Lauf haelt an, statt zu raten.',
    );
  }
  const name = String(endpunkt).toLowerCase();
  for (const sperre of sperren) {
    for (const klasse of sperre.verboteneKlassen || []) {
      if (name.includes(String(klasse).toLowerCase())) {
        throw new VerfassungsBruch(
          `R4: Endpunkt '${endpunkt}' faellt in die gesperrte Klasse '${klasse}' `
          + `(${sperre.signalfamilie}, verbraucht am ${sperre.verbrauchtAm}). ${sperre.regel}`,
        );
      }
    }
  }
  return true;
}

// ── R1/E3: Serverzeit gegen Erstzugriff ───────────────────────────────────────
// R1 verlangt den Vergleich der SERVER-Push-Zeit mit dem ersten Datenzugriff, nicht den
// zweier lokaler Uhren. serverConfirmedAt kommt aus dem Date-Kopf der GitHub-API-Antwort;
// accessedAt ist die im Register angemeldete fruehestmoegliche Zugriffszeit.

function pruefeServerzeit({ serverConfirmedAt, ersterZugriffAm, accessedAt = null }) {
  const server = Date.parse(serverConfirmedAt);
  const zugriff = Date.parse(ersterZugriffAm);
  if (Number.isNaN(server)) throw new VerfassungsBruch(`R1: Unlesbare Serverzeit: ${serverConfirmedAt}`);
  if (Number.isNaN(zugriff)) throw new VerfassungsBruch(`R1: Unlesbarer Erstzugriff: ${ersterZugriffAm}`);
  if (!(zugriff > server)) {
    throw new VerfassungsBruch(
      `R1: Erstzugriff ${ersterZugriffAm} liegt nicht NACH der Server-Bestaetigung ${serverConfirmedAt} — `
      + 'die Vorab-Anmeldung war zum Zeitpunkt des Zugriffs nicht nachweislich auf origin.',
    );
  }
  if (accessedAt !== null && accessedAt !== undefined) {
    const geplant = Date.parse(accessedAt);
    if (Number.isNaN(geplant)) throw new VerfassungsBruch(`R1: Unlesbare angemeldete Zugriffszeit: ${accessedAt}`);
    if (zugriff < geplant) {
      throw new VerfassungsBruch(
        `R1: Erstzugriff ${ersterZugriffAm} liegt VOR der angemeldeten Zugriffszeit ${accessedAt}`,
      );
    }
  }
  return true;
}

// ── R6: Zeitpunkt-Ehrlichkeit ──────────────────────────────────────────────────
// Der Speicher fuehrt je Quartal mehrere Beobachtungs-Staende. Es zaehlt immer der
// Stand, der zum Signal-Zeitpunkt schon existierte — und jede Datenzeile traegt die
// Stand-Kennung mit, sonst laesst sich hinterher nicht mehr sagen, aus welchem Wissen
// sie stammt.

function waehleStand(staende, signalZeitpunkt) {
  const grenze = Date.parse(signalZeitpunkt);
  if (Number.isNaN(grenze)) throw new VerfassungsBruch(`R6: Unlesbarer Signal-Zeitpunkt: ${signalZeitpunkt}`);
  const zulaessig = (staende || [])
    .filter((stand) => {
      const beobachtet = Date.parse(stand.beobachtetAm);
      if (Number.isNaN(beobachtet)) throw new VerfassungsBruch(`R6: Stand ohne lesbaren Zeitpunkt: ${stand.standId}`);
      return beobachtet <= grenze;
    })
    .sort((a, b) => Date.parse(b.beobachtetAm) - Date.parse(a.beobachtetAm));
  if (zulaessig.length === 0) {
    throw new VerfassungsBruch(
      `R6: Kein Beobachtungs-Stand existierte am ${signalZeitpunkt} — NICHT BERECHENBAR statt Zukunftswissen`,
    );
  }
  return zulaessig[0];
}

function stempleZeile(zeile, stand) {
  if (!stand || !stand.standId) throw new VerfassungsBruch('R6: Zeile ohne Stand-Kennung ist nicht zulaessig');
  return { ...zeile, standId: stand.standId, standBeobachtetAm: stand.beobachtetAm };
}

// ── R1: Zugriffs-Register ──────────────────────────────────────────────────────
// Vorab-Anmeldung, nicht Nachher-Protokoll. Die Kette bindet jeden Eintrag an seinen
// Vorgaenger; die Anmeldung muss VOR dem Zugriff liegen. Der Serverzeit-Vergleich
// (Push-Zeit gegen ersten Datenzugriff) kommt in E3 dazu und steht so in der Registry.

function eintragsHash(event, previousHash) {
  const ohneHash = { ...event, previousHash };
  delete ohneHash.eventHash;
  return sha256(kanonisch(ohneHash));
}

// Eintragsarten. Eine Vorab-Anmeldung KANN kein accessedAt tragen: nach dem Hashen
// liesse es sich nie nachtragen, ohne die Kette zu brechen. Die alte Pauschalregel
// "accessedAt ist Pflicht" erzwang damit genau das Nachher-Protokoll, das die
// Kopfzeile dieses Abschnitts ausschliesst. Unbekannte Art -> rot (fail-closed).
const ARTEN_VORAB = new Set(['R15b_NUR_ZAEHLEN', 'PARAMETER_REGISTRIERUNG_UND_R15b_NUR_ZAEHLEN']);
const ART_ZUGRIFF = 'confirmatory_execution_authorized';
// E3: die Nur-Zaehlen-Probe meldet sich wie ein Zugriff an (mit accessedAt, also mit der
// vollen registeredAt < accessedAt-Pruefung), schaltet aber ausdruecklich KEINE
// Ergebnisdaten frei — sie berechnet keine. Beides in einen Topf zu werfen waere die
// bequeme Variante und haette den Zaehllauf zum Ergebnis-Lauf befoerdert.
const ART_ZAEHLPROBE = 'count_only_probe_authorized';
// C0/Strang C: die Anmeldung einer eingefrorenen AUSWAHLREGEL. Sie schaltet keine
// Ergebnisdaten frei und fasst den versiegelten Speicher nicht an — sie bindet den
// Hash der Regel an die Serveruhr, BEVOR die erste Zaehlung im lebenden
// EDGAR-Volltextdienst laeuft. Eigene Art statt Zweckentfremdung der Zaehlproben-Art:
// deren Erlaubnistext verbietet ausdruecklich Firmen-Kennungen, und genau die ist das
// Ergebnis von C0. Ein Lauf unter einem Erlaubnistext anmelden, der ihn verbietet,
// waere eine Falschanmeldung.
const ART_C0_REGELFREEZE = 'C0_REGELFREEZE';
const ARTEN_MIT_ZUGRIFFSZEIT = new Set([ART_ZUGRIFF, ART_ZAEHLPROBE, ART_C0_REGELFREEZE]);

// Die Zugriffszeit-Arten nach aussen: eine KOPIE, nie der lebende Handgriff.
// Ein exportiertes Set ist von jedem requirenden Modul beschreibbar — ein
// einziges `arten.add('was_auch_immer')` erweiterte im laufenden Prozess die
// Verfassung, und zwar genau die Menge, an der die fail-closed-Schranke des
// Server-Beweises haengt. Wer die Menge lesen will, bekommt eine Kopie; wer
// sie aendern will, muss diese Datei anfassen — ein sichtbarer Akt.
function artenMitZugriffszeit() {
  return new Set(ARTEN_MIT_ZUGRIFFSZEIT);
}

function eintragsArt(event) {
  const art = event.typ || event.type;
  if (ARTEN_MIT_ZUGRIFFSZEIT.has(art)) return 'zugriff';
  if (ARTEN_VORAB.has(art)) return 'vorab';
  return null;
}

function pruefeZugriffsRegister(register) {
  if (!register || register.schema !== 'early-detection-outcome-access-ledger/v2') {
    throw new VerfassungsBruch('R1: Zugriffs-Register hat nicht das uebernommene Schema v2');
  }
  if (!register.genesisSha256 || register.genesisSha256.length !== 64) {
    throw new VerfassungsBruch('R1: Zugriffs-Register ohne Genesis-Hash ist nicht verkettbar');
  }
  let previousHash = register.genesisSha256;
  let letzteAnmeldung = null;
  const events = register.events || [];
  events.forEach((event, index) => {
    if (event.previousHash !== previousHash) {
      throw new VerfassungsBruch(`R1: Kette bricht bei Eintrag ${index} (${event.runId || 'ohne runId'})`);
    }
    const erwartet = eintragsHash(event, previousHash);
    if (event.eventHash !== erwartet) {
      throw new VerfassungsBruch(`R1: Eintrag ${index} wurde nachtraeglich veraendert`);
    }
    if (!event.registeredAt) {
      throw new VerfassungsBruch(`R1: Eintrag ${index} ohne Anmeldezeit`);
    }
    const art = eintragsArt(event);
    if (art === null) {
      throw new VerfassungsBruch(
        `R1: Eintrag ${index} traegt eine unbekannte Art (${event.typ || event.type || 'keine'})`,
      );
    }
    if (art === 'vorab') {
      if (event.accessedAt !== null && event.accessedAt !== undefined) {
        throw new VerfassungsBruch(
          `R1: Eintrag ${index} ist eine Vorab-Anmeldung, traegt aber schon eine Zugriffszeit`,
        );
      }
    } else {
      if (!event.accessedAt) {
        throw new VerfassungsBruch(`R1: Eintrag ${index} ist ein Zugriff ohne Zugriffszeit`);
      }
      if (Date.parse(event.registeredAt) >= Date.parse(event.accessedAt)) {
        throw new VerfassungsBruch(
          `R1: Eintrag ${index} wurde nicht VOR dem Zugriff angemeldet (${event.registeredAt} >= ${event.accessedAt})`,
        );
      }
    }
    // Ein ans Ende gehaengter, rueckdatierter Eintrag ueberlebt die reine
    // Kettenpruefung — Monotonie faengt ihn.
    if (letzteAnmeldung !== null && Date.parse(event.registeredAt) < letzteAnmeldung) {
      throw new VerfassungsBruch(
        `R1: Eintrag ${index} ist rueckdatiert (${event.registeredAt} liegt vor dem Vorgaenger)`,
      );
    }
    letzteAnmeldung = Date.parse(event.registeredAt);
    previousHash = event.eventHash;
  });
  return { eventCount: events.length, tailHash: previousHash };
}

function haengeEintragAn(register, event) {
  const previousHash = pruefeZugriffsRegister(register).tailHash;
  const vollstaendig = { ...event, previousHash };
  vollstaendig.eventHash = eintragsHash(vollstaendig, previousHash);
  return { ...register, events: [...(register.events || []), vollstaendig] };
}

module.exports = {
  VerfassungsBruch,
  DATENWURZEL_ENV,
  REGELWERK_PFAD,
  kanonisch,
  sha256,
  ladeRegelwerk,
  datenwurzel,
  quartalsSchluessel,
  pruefeFenster,
  starteLauf,
  waehleStand,
  stempleZeile,
  pruefeZugriffsRegister,
  haengeEintragAn,
  endpunktSperren,
  pruefeEndpunktKlasse,
  pruefeServerzeit,
  ART_ZUGRIFF,
  ART_ZAEHLPROBE,
  ART_C0_REGELFREEZE,
  artenMitZugriffszeit,
};
