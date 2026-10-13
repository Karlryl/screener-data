'use strict';
/**
 * kr-stiller-leerlauf — Waechter gegen den gruenen Lauf ueber leeren Daten (build-krannual.js).
 *
 * DER BEFUND (Silent-Failure-Review 19.08.2026): der Zweig "zu wenig Daten" war die einzige
 * Ausfahrt fuer den Fall "JEDER Jahresabruf kam mit status 000 sauber zurueck, aber es wurde
 * keine einzige Kennzahl zugeordnet". Er schrieb nur eine console.warn und liess den Lauf mit
 * Exit 0 enden. Genau so sieht aber ein kaputter corp_code, eine von OpenDART umbenannte
 * account_id oder ein Regress in pick() aus: Transport gruen, Zuordnung leer, CI gruen — und
 * der Altbestand veraltet still weiter, ohne dass irgendjemand hinschaut.
 *
 * Solange der Adapter EINEN Ticker holte, war das folgenlos. Mit zehn Tickern ist es eine
 * reale Blindstelle, darum faerbt ein unbekannter Leerlauf den Lauf jetzt rot.
 *
 * DIE GEGENRICHTUNG IST GENAUSO WICHTIG: Finanzunternehmen melden nach dem FSS-Branchenschema
 * und haben die gesuchten Konten schlicht nicht. Wuerden die den Lauf rot faerben, waere die
 * Meldung ein Dauer-Fehlalarm und damit wertlos. Sie stehen namentlich in
 * KR_OHNE_STANDARDKONTEN — und dieser Test prueft BEIDE Richtungen.
 *
 * Kein Netz: getJSON ist gestubbt (derselbe Seam, den tests/p0-haertung3 benutzt).
 *
 * Run: node tests/kr-stiller-leerlauf.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const krannual = require('../scripts/build-krannual.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-leerlauf-'));
const neu = (name, inhalt) => { const p = path.join(tmp, name); fs.writeFileSync(p, inhalt); return p; };
process.env.OPENDART_KEY = process.env.OPENDART_KEY || 'TESTKEY';

// Jeder Abruf antwortet SAUBER (status 000) — aber mit Konten, die der Adapter nicht kennt.
// Das ist der gefaehrliche Fall: kein Netzfehler, kein 013, trotzdem null Zuordnung.
const sauberAberLeer = async () => ({
  status: '000',
  list: [{ account_id: 'ifrs-full_IrgendwasAnderes', sj_div: 'CIS', account_nm: 'x', thstrm_amount: '123' }],
});

(async () => {
  await test('UNBEKANNTER Ticker ohne Zuordnung faerbt den Lauf ROT (der Befund)', async () => {
    const p = neu('kr-unbekannt.json', '{}');
    const nurUnbekannt = { '999999.KS': '00000001' };
    await assert.rejects(
      () => krannual.main({ getJSON: sauberAberLeer, out: p, kr: nurUnbekannt }),
      /unvollstaendig/,
      'ein sauberer Abruf ohne jede Zuordnung darf NICHT mit Exit 0 enden');
  });

  await test('BEKANNTER Ausnahme-Ticker laesst den Lauf GRUEN (kein Dauer-Fehlalarm)', async () => {
    const p = neu('kr-bekannt.json', '{}');
    const bekannt = Object.keys(krannual.KR_OHNE_STANDARDKONTEN);
    assert.ok(bekannt.length >= 1, 'die Ausnahmeliste darf nicht leer sein, sonst prueft dieser Test nichts');
    const nurBekannt = { [bekannt[0]]: krannual.KR[bekannt[0]] };
    await krannual.main({ getJSON: sauberAberLeer, out: p, kr: nurBekannt }); // darf NICHT werfen
  });

  await test('die Ausnahmeliste nennt fuer jeden Eintrag einen Grund', () => {
    for (const [tk, grund] of Object.entries(krannual.KR_OHNE_STANDARDKONTEN)) {
      assert.ok(typeof grund === 'string' && grund.length > 20,
        `${tk} braucht eine nachvollziehbare Begruendung, keine Platzhalter`);
      assert.ok(krannual.KR[tk], `${tk} steht in der Ausnahmeliste, aber nicht in KR — toter Eintrag`);
    }
  });

  await test('ein ECHTER Netzfehler bleibt weiterhin rot (keine Ueberdeckung durch die Ausnahme)', async () => {
    const p = neu('kr-netz.json', '{}');
    const bekannt = Object.keys(krannual.KR_OHNE_STANDARDKONTEN)[0];
    const nurBekannt = { [bekannt]: krannual.KR[bekannt] };
    const wirft = async () => { throw new Error('ECONNRESET'); };
    await assert.rejects(
      () => krannual.main({ getJSON: wirft, out: p, kr: nurBekannt }),
      /unvollstaendig/,
      'auch ein gelisteter Ticker darf einen Netzfehler nicht verschlucken');
  });

  console.log(`\nkr-stiller-leerlauf.test.js: ${pass} ok, ${fail} fail`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
