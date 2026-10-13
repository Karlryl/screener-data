# B1 Tag 415 — Formvorbehalt (53-Wochen) + Report-Ausweis-Hinweise

**Status: Tag 415 GÜLTIG, von Karl akzeptiert 21.07.2026 (Entscheid E-20260721-1, Option A).**
Dieser Annex dokumentiert die eine bekannte Protokoll-Abweichung des konfirmatorischen
B1-Laufs (`reports/b1-validation-2026-07-19.json`, Commit `4eb1a02501`, Tag 415) offen.
Er ändert das Ergebnis nicht — er hält es ehrlich fest.

## Formvorbehalt: 53-Wochen-/Transition-Ausschluss fehlt (§1 Z.25)

**Protokoll §1 Z.25 (eingefroren, `protocol/b1-registered-20260719.md`) verlangt wörtlich:**
> „abgeleitetes Q4 = FY − (Q1+Q2+Q3) eingeschlossen; **Transition-/53-Wochen-Perioden
> ausgeschlossen und gezählt**."

**Ist-Zustand am Code (verifiziert 21.07.):** Der Ausschluss-/Zähl-Mechanismus fehlt in der
gesamten Erkennungskette:
- `lib/sec-pit.js` akzeptiert Jahresperioden 330–380 d (ein 53-Wochen-FY = 371 d fällt hinein)
  und Quartale 80–110 d (ein 14-Wochen-Quartal ≈ 98 d fällt hinein), ohne sie zu markieren;
  der `yoyPartner`-Kommentar delegiert die Verwerfung ausdrücklich „an den Aufrufer".
- `lib/b1-detect.js` (der Aufrufer) hat weder einen 53-Wochen-Ausschluss noch einen Zähler
  in den `counters`; einziger Perioden-Filter ist `consecutive` (End-Abstand 60–125 d, zu weit).
- `scripts/b1-validate.js` filtert nur nach Discovery-CIK (§6) und `usable`.

**Effekt: ergebnisneutral.** Codex' Kreuz-Review schätzt ~17 von 2.378 Roh-Events betroffen
(≈ 0,7 %); der Haupttest-p von 0,16 (alle 90-%-CIs schließen die Null ein) dreht dadurch nicht
ins Positiv. Ein NULL kann durch etwas Zusatzrauschen nicht zu einem Fund werden — die Richtung
der Verzerrung entwertet höchstens ein Positiv, nie ein NULL (dieselbe Logik wie beim Shumway-Gate).

**Karls Entscheid (21.07., E-20260721-1 A):** Den ergebnisneutralen Formfehler akzeptieren und offen
dokumentieren, statt den einen Validation-Schuss ein zweites Mal — nach Kenntnis des NULL — zu
verbrauchen (eine ergebnis-informierte Zweitmessung ist selbst ein methodischer Freiheitsgrad).
Tag 415 gilt als konformer Validation-Schuss mit dieser dokumentierten Abweichung.

## Report-Ausweis-Hinweise aus dem Codex-Kreuz-Review (kein Ergebniseffekt)

Diese Ausweis-Punkte sind ab Tag 416 im Report-Code (`scripts/b1-validate.js`) für KÜNFTIGE
B-Backtests geheilt; der bereits generierte Tag-415-Report bleibt unverändert:
- **Claim 5:** `discoveryExcluded` meldete `discEventCiks.size` (CIK-Anzahl) statt der tatsächlich
  aus Validation entfernten Event-Records. Ab Tag 416 getrennt als `discoveryExcludedCiks` +
  `discoveryExcludedEvents`.
- **Claim 3 P2-Rest (Survivorship-Bilanz, §8 Z.101):** Die deskriptive Attrition auf der vollen
  companyfacts-CIK-Population wird ab Tag 416 explizit als `survivorship`-Block ausgewiesen
  (aus den bereits vorhandenen `counters`). Deskriptiv, null Entscheidungsgewalt (§7 Z.84–85).

**Nicht betroffen (widerlegte Claims):** Claim 2 (Mahalanobis, abgelegtes Fehlurteil), Claim 3-Kern
(Survivorship kippt Verdikt — Fehlurteil, `balanceOk` speist sich aus der gruppen-relativen
Preis-Fehlquote §8 Z.92, nicht der absoluten Survivorship-Quote), Claim 4 (EV/Sales — §5 schreibt
die EV-Formel nicht vor). Volle Prüfung: Vault `_B1-KREUZREVIEW-PRUEFUNG-2026-07-21.md`.
