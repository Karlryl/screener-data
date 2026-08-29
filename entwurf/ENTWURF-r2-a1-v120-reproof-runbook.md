# ENTWURF — Re-Proof-Runbook v1.2.0 (Kennungsbruecke)

> **ENTWURF. Nicht registriert, nicht eingefroren, nirgends verlinkt.**
> Liegt bewusst ausserhalb von `protocol/`, `reports/studie/` und `research/studie/`,
> damit kein Waechter ihn als Studien-Artefakt fuehrt. Er wird erst Runbook, wenn der
> Orchestrator den zugehoerigen Korrektur-Record abgenommen hat.
> Der teure Determinismus-Re-Proof laeuft **genau einmal**, nach der Diagnose (T171).

---

## AUF EINEN BLICK

Drei Dinge koennen den einen Lauf wertlos machen, obwohl er gruen aussieht.
Alle drei sind vor dem Start zu erledigen, nicht danach.

1. **HMAC-Key-Fingerprint vorher pinnen** — sonst gruenes Attest auf falschem Schluessel.
2. **Exit-Code-Semantik der Sabotage ist INVERTIERT** — Erfolg gibt 1 zurueck, Fehlschlag 0.
3. **Shard-Decke beobachten** — 180 KB im Bau, 200 KB im Schreiben, harter Abbruch.

---

## 1. Ungepinnter HMAC-Key — gruen-aber-falsch

**Befund.** `keyFingerprintSha256` wird ausschliesslich **A gegen B** verglichen: das Feld
steht in `INDEPENDENT_FINGERPRINT_FIELDS` und wird in
`compare_independent_build_records` feldweise zwischen den beiden Builder-Records
geprueft. Es gibt **keinen Vergleich gegen einen Sollwert**.

**Folge.** Starten beide Prozesse mit demselben *falschen* Schluessel, sind alle
Fingerprints gleich, `passes` ist `true`, das Determinismus-Attest ist gruen — und es
attestiert ein Artefakt mit falschen, nicht wiederherstellbaren Pseudonymen. Die
gemeinsame Umgebung der beiden Prozesse ist genau der Grund, warum der A/B-Vergleich
das nicht sehen kann: Prozess B erbt denselben `--identity-key-file`-Pfad.

**Auflage vor dem Lauf.**

- Den Soll-Wert `keyFingerprintSha256` = SHA-256 der Schluesselbytes **schriftlich in der
  Re-Proof-Order festhalten**, bevor der Lauf startet. Er ist der Fingerprint des
  Schluessels, mit dem 1.1.0 gebaut wurde — die Korrektur wechselt den Schluessel nicht.
- Nach dem Lauf `construction.identifierProtection.keyFingerprintSha256` im Artefakt
  gegen diesen Sollwert vergleichen. Abweichung = Abbruch, nicht Nacherzaehlung.
- Der Sollwert ist ein Einweg-Fingerprint und darf in die Order; der Schluessel selbst
  niemals.

---

## 2. Exit-Code-Falle: `--sabotage-independent-rebuild` ist invertiert

**Befund.** In `sabotage_independent_rebuild` gilt:

- Sabotage **erkannt** (der gewuenschte Ausgang) → `return 1`
- Sabotage **nicht erkannt** (der Fehlschlag) → `return 0`

Dieselbe Umkehr tragen `sabotage_cross_seam`, `sabotage_reversible_ids`,
`sabotage_determinism_fixture` und `sabotage_bridge_write`. Sie ist **Absicht**: der
Testrahmen verlangt fuer eine gelungene Sabotage einen Exit ungleich null.

**Folge.** Jeder Wrapper, der nach gewohntem Muster `!= 0` als Fehler wertet — Shell mit
`set -e`, ein CI-Schritt ohne `|| true`, ein Scheduler, ein `subprocess.run(check=True)` —
macht den Lauf flaky oder bricht ihn genau dann ab, wenn die Sabotage **funktioniert** hat.

**Auflage.** Im Wrapper explizit dokumentieren und pruefen:
`Erfolg == Exit 1`, `Fehlschlag == Exit 0`. Kein `set -e` ueber diesen Aufrufen.
Die zugehoerigen Beweisdateien (`observedStatus: "RED"`) sind die inhaltliche Wahrheit;
der Exit-Code ist nur ihr Transport.

---

## 3. Shard-Decke: 180 KB Bau / 200 KB Schreiben

**Befund.** Zwei Decken, unterschiedliche Zahlen:

- **Bau:** `SHARD_MAX_BYTES = 180 * 1024`. `manifest_from_artifact` schneidet neue Shards,
  sobald die kanonischen Bytes die Grenze erreichen — und **bricht hart ab**, wenn eine
  **einzelne Entitaet** allein darueber liegt.
- **Schreiben:** `write_sharded_artifact` prueft nach jedem Schreibvorgang gegen
  `200 * 1024` und bricht ab.
- **Zusaetzlich** deckelt `tests/studie-deckel.test.js` (R14a) jedes Studien-Artefakt
  typfrei auf 200 KB — Skripte und Berichte eingeschlossen.

**Kandidaten.** Die Entitaeten mit der hoechsten Nahtzahl (Stand 1.1.0: 11 Naehte). Punkt A
haengt jeder Naht `seamEventDate` und `periodKeysCollapsed` an, also rund 45 Byte pro Naht
mehr; der Ereignis-Zusammenfall senkt zugleich die Nahtzahl. Netto erwartet neutral bis
kleiner, aber **nicht angenommen, sondern gemessen**.

**Auflage.** Nach dem Lauf aus dem Manifest ablesen und protokollieren:
`max(shards[].bytes)` und die Zahl der Shards. Punkt B legt die neuen Groessen in `counts`
und damit ins **Manifest**, nicht in die Shards — B ist fuer die Decke unkritisch.

---

## 4. Reihenfolge des einen Laufs

1. Korrektur-Record abnehmen, nach `protocol/early-detection/2.0.0/` verschieben,
   einfrieren, committen. (Die dortige `.gitattributes`-Regel `/protocol/early-detection/**
   text eol=lf` greift automatisch — kein eigener Eintrag noetig.)
2. HMAC-Key-Fingerprint-Sollwert in der Order festhalten (Abschnitt 1).
3. `--self-test` fahren. **Erwartung heute: zwei benannte Pruefungen sind ROT** — die
   beiden Fixture-Pin-Pruefungen. Grund steht im Klartext im Pruefausgang: der Pin wurde
   unter 1.1.0 berechnet. Das ist **kein Defekt**, sondern die offene Orchestrator-Weiche
   aus Abschnitt 5. Alle uebrigen Pruefungen muessen gruen sein.
4. Sabotagen einzeln fahren, Exit-Codes nach Abschnitt 2 lesen.
5. Empirischen Bau **einmal** fahren.
6. Key-Fingerprint gegen Sollwert, Shard-Groessen protokollieren.
7. Neue Nahtmenge + `periodKeyTransitionsCollapsedIntoSeams` +
   `seamEventDatesFallenBackToPeriodKey` dem Orchestrator zur **Methodik-Abnahme**
   vorlegen. Bis zur Abnahme wird die Zahl nirgends zitiert.

---

## 5. Offen — vor Schritt 3 zu entscheiden

Der `pinnedExpectedLogicalPayloadSha256` der Determinismus-Fixture wurde unter
Artefakt-Version 1.1.0 berechnet und steht im **eingefrorenen** Closure-Record.
`ARTIFACT_VERSION` liegt im HMAC-Payload, also aendert der Bump jede E-, I- und S-ID und
damit den Pin.

Der Patch **weist den alten Pin namentlich ab**, in Pruef- **und** in Sabotage-Richtung.
Die Sabotage-Richtung ist der unauffaelligere Fall: ohne Wache waere sie rot geworden,
weil die Version sprang, nicht weil die Mutation wirkte — gruen-aber-falsch mit
umgekehrtem Vorzeichen.

**Weiche fuer den Orchestrator:** Welcher Record traegt den neuen Pin, und wie kann ein
*vorab* eingefrorener Record einen Ausgabewert pinnen, den er noch nicht berechnet hat?
Der eingefrorene Record wird **nicht** editiert. Naheliegend, aber hier nicht entschieden:
ein eigener append-only Folge-Record, der nach dem einen Lauf den neuen Pin **und** den
neuen Implementierungs-Hash aufnimmt, ohne die 1.1.0-Werte zu ueberschreiben.

---

## 6. Was dieses Runbook nicht tut

- Es startet keinen Lauf und praejudiziert keinen Ausgang.
- Es nimmt die neue Nahtmenge nicht ab — das ist Orchestrator-Sache.
- Es beruehrt Blocker 3 nicht; Auftrag 1 bleibt HOLD.
- Es sagt nichts ueber den Endtest, der versiegelt und unverbraucht bleibt.
