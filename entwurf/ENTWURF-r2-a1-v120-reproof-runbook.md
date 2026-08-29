# ENTWURF — Re-Proof-Runbook v1.2.0 (Kennungsbruecke)

> **ENTWURF. Nicht registriert, nicht eingefroren, nirgends verlinkt.**
> Liegt bewusst ausserhalb von `protocol/`, `reports/studie/` und `research/studie/`,
> damit kein Waechter ihn als Studien-Artefakt fuehrt. Er wird erst Runbook, wenn der
> Orchestrator den zugehoerigen Korrektur-Record abgenommen hat.
> Der teure Determinismus-Re-Proof laeuft **genau einmal**.
>
> **Sequenz-Amendment (ENTSCHIED 6):** Der Re-Proof wartet **nicht mehr** auf die
> T171-Diagnose. Die urspruengliche Reihenfolge war Ressourcen-Sequenzierung, keine
> Methodik-Abhaengigkeit — die Korrekturen aendern Bytes, keine Schlussfolgerung.
> T171 laeuft parallel bei Codex.

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
- **Warum das ein Handgriff bleibt und kein Bau-Check ist:** Der Sollwert gehoert laut
  ENTSCHIED 6 in den **Post-Run-Closure-Record** — und genau der entsteht erst durch
  diesen Lauf. Ein Check im Bau waere zirkulaer. Er ist deshalb ein Pruefschritt
  **nach** dem Lauf, sobald der Record existiert (Schritt 6 unten).

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

1. **Korrektur-Record** und **E3-Allowlist-Supplement** abnehmen, nach
   `protocol/early-detection/2.0.0/` verschieben, einfrieren, hashen, committen. (Die
   dortige `.gitattributes`-Regel `/protocol/early-detection/** text eol=lf` greift
   automatisch — kein eigener Eintrag noetig.) Beim Einfrieren pruefen, ob der im
   Korrektur-Record gepinnte Skript-Hash noch auf das Skript passt.
2. HMAC-Key-Fingerprint-Sollwert in der Order festhalten (Abschnitt 1).
3. `--self-test` fahren. **Erwartung: genau zwei benannte Pruefungen sind ROT** — die
   beiden Fixture-Pin-Pruefungen, mit Klartext-Grund im Pruefausgang („post-run closure
   record for artifact version 1.2.0 does not exist yet"). Das ist die **dokumentierte
   Zwischenlage** nach Abschnitt 5, kein Defekt. Alle uebrigen Pruefungen muessen gruen
   sein — inklusive der drei neuen (Naht-Platzierung, Mauer-Guard auf accepted-Format,
   zehn Zaehler je Fenster).
4. Sabotagen einzeln fahren, Exit-Codes nach Abschnitt 2 lesen.
5. Empirischen Bau **einmal** fahren.
6. **Nach dem Lauf:** Shard-Groessen protokollieren; Key-Fingerprint des Artefakts gegen
   den Sollwert aus Schritt 2 pruefen.
7. Neue Nahtmenge + `periodKeyTransitionsCollapsedIntoSeams` +
   `seamEventDatesFallenBackToPeriodKey` dem Orchestrator zur **Methodik-Abnahme**
   vorlegen. Bis zur Abnahme wird die Zahl nirgends zitiert.
8. **Erst nach der Abnahme:** den v1.2.0-Closure-Record schreiben (Abschnitt 5). Danach
   werden die beiden roten Pruefungen aus Schritt 3 gruen — und zwar weil der Pin
   existiert, nicht weil jemand eine Erwartung gesenkt hat.

---

## 5. Pin-Protokoll — entschieden (ENTSCHIED 6, Q1)

**Zwei Stufen, weil ein Vorab-Record logisch nichts pinnen kann, was er noch nicht
berechnet hat.** Auch der 1.1.0-Closure-Record entstand NACH seinem Lauf.

| Stufe | Record | Wann | Pinnt |
| --- | --- | --- | --- |
| 1 | Korrektur-Record (vorab eingefroren) | vor dem Lauf | Skript-Hash, `ARTIFACT_VERSION` 1.2.0, Prozedur |
| 2 | `r2-a1-v120-closure-record.json` (append-only) | nach dem Lauf **und** nach der Abnahme | `pinnedExpectedLogicalPayloadSha256`, `boundArtifactVersion`, `keyFingerprintSha256`-SOLLWERT, gelaufener Skript-Hash |

Der **1.1.0-Closure-Record bleibt unangetastet** (SUPERSEDE_NO_DELETE); Version 1.1.0
bleibt gegen ihr eigenes archiviertes Artefakt pruefbar.

**Im Code:** `pinned_fixture_binding()` loest den Payload-Pin ueber `CLOSURE_RECORDS` je
`ARTIFACT_VERSION` auf. Fehlender Record, falscher Status oder ein widersprechendes
`boundArtifactVersion` = **lautes Verweigern**, nie ein stiller Rueckfall auf einen
fremden Pin.

**Sabotage-Richtung:** Die Eingangs-Fakten (Fixture-Bytes, `deliberateMutation`) sind
versionsfrei und kommen weiter aus dem Blocker-Closure; **nur der Ausgabe-Pin** wird je
Version aufgeloest. Damit mutiert die Sabotage **Inhalt unter derselben Version** und der
Pin feuert aus dem richtigen Grund. Ohne diese Trennung waere sie rot geworden, weil die
Version sprang — gruen-aber-falsch mit umgekehrtem Vorzeichen.

---

## 6. Was dieses Runbook nicht tut

- Es startet keinen Lauf und praejudiziert keinen Ausgang.
- Es nimmt die neue Nahtmenge nicht ab — das ist Orchestrator-Sache.
- Es beruehrt Blocker 3 nicht; Auftrag 1 bleibt HOLD.
- Es sagt nichts ueber den Endtest, der versiegelt und unverbraucht bleibt.
