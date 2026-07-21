'use strict';
/**
 * lib/sec-user-agent.js — SEC-EDGAR-User-Agent aus der Umgebung (PII-Schutz).
 *
 * SEC verlangt einen kontakttragenden User-Agent (sonst stiller HTTP 403).
 * Der Wert kommt ZUR LAUFZEIT aus process.env.SEC_CONTACT und wird NIE im Code
 * hartcodiert (E-20260721-3: Karls Klarname+Mail lagen zuvor als Literal in 11
 * getrackten Dateien eines PUBLIC-Repos). Setup: SEC_CONTACT als env-Variable
 * bzw. GitHub-Actions-Secret, Format z. B. "Name screener-data mail@example.com".
 *
 * IMPORT-SICHER: secUserAgent() wirft NICHT beim Modul-Load (mehrere SEC-Puller
 * werden von Tests + refresh-universe require't; ein Load-throw ohne gesetztes
 * SEC_CONTACT würde die Suite reissen). Wer fail-fast VOR einem Request will,
 * ruft assertSecContact() explizit auf.
 */
function secUserAgent() {
  return (process.env.SEC_CONTACT || '').trim();
}

// Optionaler fail-loud Guard fuer den Request-Pfad (nie beim Import aufrufen).
function assertSecContact() {
  const ua = secUserAgent();
  if (!ua || !/@/.test(ua)) {
    throw new Error('SEC_CONTACT fehlt oder traegt keine Kontakt-Mail — SEC '
      + 'verlangt einen kontakttragenden User-Agent (sonst 403). Setze SEC_CONTACT '
      + '(env-Variable / CI-Secret), z. B. "Name screener-data mail@example.com".');
  }
  return ua;
}

module.exports = { secUserAgent, assertSecContact };
