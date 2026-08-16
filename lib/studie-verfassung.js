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

function kanonisch(wert) {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(',')}]`;
  if (wert && typeof wert === 'object') {
    return `{${Object.keys(wert).sort().map((k) => `${JSON.stringify(k)}:${kanonisch(wert[k])}`).join(',')}}`;
  }
  return JSON.stringify(wert === undefined ? null : wert);
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
      .filter((event) => event.type === 'confirmatory_execution_authorized')
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

function pruefeZugriffsRegister(register) {
  if (!register || register.schema !== 'early-detection-outcome-access-ledger/v2') {
    throw new VerfassungsBruch('R1: Zugriffs-Register hat nicht das uebernommene Schema v2');
  }
  if (!register.genesisSha256 || register.genesisSha256.length !== 64) {
    throw new VerfassungsBruch('R1: Zugriffs-Register ohne Genesis-Hash ist nicht verkettbar');
  }
  let previousHash = register.genesisSha256;
  const events = register.events || [];
  events.forEach((event, index) => {
    if (event.previousHash !== previousHash) {
      throw new VerfassungsBruch(`R1: Kette bricht bei Eintrag ${index} (${event.runId || 'ohne runId'})`);
    }
    const erwartet = eintragsHash(event, previousHash);
    if (event.eventHash !== erwartet) {
      throw new VerfassungsBruch(`R1: Eintrag ${index} wurde nachtraeglich veraendert`);
    }
    if (!event.registeredAt || !event.accessedAt) {
      throw new VerfassungsBruch(`R1: Eintrag ${index} ohne Anmelde- oder Zugriffszeit`);
    }
    if (Date.parse(event.registeredAt) >= Date.parse(event.accessedAt)) {
      throw new VerfassungsBruch(
        `R1: Eintrag ${index} wurde nicht VOR dem Zugriff angemeldet (${event.registeredAt} >= ${event.accessedAt})`,
      );
    }
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
};
