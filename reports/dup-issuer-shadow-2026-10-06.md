# Duplicate-issuer shadow export, 2026-10-06

The export now reports listed secondary tickers through the optional `dupIssuer`
field. A sourced hand table records exactly nine issuers, 19 tickers and ten
secondary tickers, including the currently absent GE.VI. No rank, score, name,
exclusion, board membership or short-list membership is changed.

## Implementation and scope

- `configs/dup-issuer-shadow-table.json` preserves the supplied R11 sources,
  verbatim quotes, source check date 2026-09-30 and entry date 2026-10-06.
  Sources were not reopened; this task has no network access.
- The loader rejects malformed records. `secondaryIndex` and
  `applyDupIssuerShadow` add only
  `{of, issuer, basis: "hand-table:dup-issuer-shadow"}` to listed secondaries.
  Kept and unlisted tickers receive no key, not null or false.
- All three real export mappers call the applicator through one shared step.
  The table loads once for the production build and also covers direct mapper
  callers. Missing or malformed tables throw instead of silently losing flags.
- `codeKeeps` records R11's production-rule re-enactment; it does not select the
  true primary listing. `homeListingProposal` is information only, null for
  unresolved cases, and has no effect on the exported marker.
- The identity register, issuer aliases and production deduplication are unchanged.
  M16 applies verbatim: "Erkennung und Meldung sind erlaubt; jede
  Verschmelzungs-Entscheidung auf Basis dieser Erkennung bleibt bis zu einem
  eigenen Gericht gesperrt."
- The Markdown contract documents all three row types. The shared JSON contract
  is unchanged: its required-field lists already permit additive optional keys.

## Frozen-generation comparison

Generation: `2026-10-03T09:31:17.258Z`.

`index.json` SHA256:
`2b785612ce8ffafcfe64d06a7bad51885785abfbac260642700e49a3dcdebe3b`.

Measurement unit: exported row occurrences, not unique tickers or issuers.
All 29 JSON files and their manifest are checked before processing; original
hashes are checked again after writing the copies to a fresh temporary directory.
Only the pure marker applicator runs over these rows; the export mappers do not
recompute the frozen generation. Every written after file is read back and deep
compared against its original after removing only the added `dupIssuer` key.

`node scripts/dup-issuer-shadow-diff.js` exited 0:

```text
Files compared: 29; rows compared: 11923; rows changed: 11; other differences: 0
Changed rows by feed: {"full":9,"shortLists":2,"overview":0,"survival":0}
Only added key: dupIssuer; no rank, score, name or membership changed.
```

Exact flagged-row list copied from the command output:

```jsonl
{"file":"full/financials.json","track":"profitable","ticker":"1GLXY.MI","rank":70,"dupIssuer.of":"GLXY"}
{"file":"full/health-care.json","track":"unprofitable","ticker":"6855.HK","rank":275,"dupIssuer.of":"AAPG"}
{"file":"full/industrials.json","track":"profitable","ticker":"GCP.DE","rank":246,"dupIssuer.of":"GE"}
{"file":"full/industrials.json","track":"profitable","ticker":"AERO.MX","rank":1478,"dupIssuer.of":"AERO"}
{"file":"full/industrials.json","track":"unprofitable","ticker":"AVAV.SW","rank":41,"dupIssuer.of":"AVAV"}
{"file":"full/materials.json","track":"profitable","ticker":"AMRZ.SW","rank":425,"dupIssuer.of":"AMRZ"}
{"file":"full/materials.json","track":"profitable","ticker":"KCO.DE","rank":927,"dupIssuer.of":"KCO.VI"}
{"file":"full/utilities.json","track":"profitable","ticker":"CPLE3.SA","rank":59,"dupIssuer.of":"ELPC"}
{"file":"full/utilities.json","track":"profitable","ticker":"AXIA3.SA","rank":109,"dupIssuer.of":"AXIA"}
{"file":"industrials.json","track":"unprofitable","ticker":"AVAV.SW","rank":41,"dupIssuer.of":"AVAV"}
{"file":"utilities.json","track":"profitable","ticker":"CPLE3.SA","rank":59,"dupIssuer.of":"ELPC"}
```

The observations match the supplied P31 expectations. GE.VI has no row in this
generation. The two short-list occurrences repeat two of the nine full-board
secondary tickers; they are not two additional issuers.

## Not entered, why

- RBI, QSR / QSP.TO: R11 describes economically equivalent exchangeable shares,
  not secondary listings. No entry and no flag.
- Molson Coors, TAP-A / TPX.TO: the same exchangeable-share distinction applies;
  the class attribution of TPX.TO is additionally unproven. No entry and no flag.

## Open decision

Visible removal of secondary rows would change ranks and membership. That needs
its own council decision and is outside this shadow task. Home-listing proposals
must not become selection rules through this reporting table.

## Verification

`node --test tests/dup-issuer-shadow-table.test.js tests/scoring/dup-issuer-shadow-export.test.js`
exited 0: 34 tests, 34 pass, 0 fail, 0 skipped. The guard runs all three real
mapper bodies with unrelated data helpers isolated in memory; the real hand-table
loader and marker run normally. An otherwise identical mapper run with the marker
bypassed provides the before-output comparison. No real snapshots are read.

Deliberate red proof, on the unprocessed in-memory pair only:

```text
$ node tests/scoring/dup-issuer-shadow-export.test.js --prove-red
AssertionError [ERR_ASSERTION]: CPLE3.SA: missing/wrong dupIssuer.of (expected ELPC)
+ actual - expected
+ undefined
- 'ELPC'
Exit code: 1
```

The normal suite also asserts that this unprocessed pair is rejected. No test was
disabled or weakened, and the red proof never mutates the writer or frozen files.

The documented `validateExport(afterDir)` invocation, which calls the same
validator as CLI `--check`, exited 0 on the written after tree:

```text
findash-export/v1 schema OK.
```

`docs/findash-export-v1.contract.json` was not modified; the new key requires no
change to its required-field lists. `git diff --check` passed, and git status
contains only the eight changed target files. No commit, push or publication is
part of this task.

An independent read-only reviewer found no concrete defects (96% confidence),
reran both new tests with 34 passes and independently reproduced the red proof.
The reviewer did not read the frozen generation or execute the complete gate.

`node scripts/test-gate.js --mode=all` was not run: existing tests can read
snapshots and other files outside the task's explicit read whitelist. The brief
both requires that run and forbids those reads. A clarification request is
pending; no exception has been assumed and no complete-gate success is claimed.

## Rule-of-40 board and full 63-file recount (06.10.)

Der Rule-of-40-Schreiber markiert jede ausgewaehlte Uebersichtszeile mit demselben
`applyDupIssuerShadow` aus der gemeinsamen Bibliothek; die Handtabelle wird einmal
je Build geladen. Die Pruefung der geschriebenen Datei verlangt den exakten Marker
und weist auch Marker an primaeren oder unbekannten Tickern zurueck.
Fehlende oder kaputte Tabellen fuehren beim CLI-Build und beim CLI-Check zum bestehenden Fehlmarker.

Die vollstaendige Nachzaehlung bestaetigt D10/B2: **12 markierte Board-Zeilen**,
darunter `quality/utilities.json`, AXIA3.SA, Rang 60, `of: AXIA`.
Die fruehere Zahl 11 oben betrifft nur die damals geprueften 29 Dateien, nicht alle 63.
Die 476 Zeilen in `rule40/overview.json` enthalten keine bekannte Zweitnotierung;
**0 Rule-of-40-Zeilen aendern sich**, beide Rule-of-40-Dateien bleiben byte-identisch.

Zaehleinheit sind Zeilenvorkommen, nicht eindeutige Ticker oder Firmen.
`rows compared: 27595` umfasst auch Diagnosezeilen und die unveraenderten Zusatzfeeds.
`excluded.json` und `druckenmiller/` werden vollstaendig verglichen, bekommen aber keine
Markierung, weil ihre eigenen Schreiber keinen solchen Schritt haben.
GE.VI kommt in der Ausschlussliste und ihrem Diagnosebein vor, nicht auf einem Board;
diese zwei Vorkommen sind keine zusaetzlichen markierten Board-Zeilen.
Der bestehende Mapper-Test enthaelt weder eine 11er-Sollzahl noch eine Dateiliste und blieb unveraendert.

`node scripts/dup-issuer-shadow-diff.js`, Exit-Code 0, vollstaendige Ausgabe:

```text
SHA256 verified: 63 files; index.json 2b785612ce8ffafcfe64d06a7bad51885785abfbac260642700e49a3dcdebe3b
Generation: 2026-10-03T09:31:17.258Z
Files compared: 63; rows compared: 27595; rows changed: 12; other differences: 0
consumer-discretionary.json: 0 flagged rows
consumer-staples.json: 0 flagged rows
druckenmiller/candidates.json: 0 flagged rows
druckenmiller/duquesne13f.json: 0 flagged rows
druckenmiller/meta.json: 0 flagged rows
druckenmiller/regime.json: 0 flagged rows
energy.json: 0 flagged rows
excluded.json: 0 flagged rows
financials.json: 0 flagged rows
full/consumer-discretionary.json: 0 flagged rows
full/consumer-staples.json: 0 flagged rows
full/energy.json: 0 flagged rows
full/financials.json: 1 flagged rows
full/health-care.json: 1 flagged rows
full/industrials.json: 3 flagged rows
full/it-services.json: 0 flagged rows
full/materials.json: 2 flagged rows
full/real-estate.json: 0 flagged rows
full/semiconductors.json: 0 flagged rows
full/software-comm-services.json: 0 flagged rows
full/tech-hardware.json: 0 flagged rows
full/utilities.json: 2 flagged rows
health-care.json: 0 flagged rows
index.json: 0 flagged rows
industrials.json: 1 flagged rows
it-services.json: 0 flagged rows
materials.json: 0 flagged rows
overview.json: 0 flagged rows
quality/consumer-discretionary.json: 0 flagged rows
quality/consumer-staples.json: 0 flagged rows
quality/energy.json: 0 flagged rows
quality/health-care.json: 0 flagged rows
quality/index.json: 0 flagged rows
quality/industrials.json: 0 flagged rows
quality/it-services.json: 0 flagged rows
quality/materials.json: 0 flagged rows
quality/overview.json: 0 flagged rows
quality/semiconductors.json: 0 flagged rows
quality/software-comm-services.json: 0 flagged rows
quality/tech-hardware.json: 0 flagged rows
quality/utilities.json: 1 flagged rows
real-estate.json: 0 flagged rows
rule40/index.json: 0 flagged rows
rule40/overview.json: 0 flagged rows
semiconductors.json: 0 flagged rows
smallcap/consumer-discretionary.json: 0 flagged rows
smallcap/consumer-staples.json: 0 flagged rows
smallcap/energy.json: 0 flagged rows
smallcap/financials.json: 0 flagged rows
smallcap/health-care.json: 0 flagged rows
smallcap/index.json: 0 flagged rows
smallcap/industrials.json: 0 flagged rows
smallcap/it-services.json: 0 flagged rows
smallcap/materials.json: 0 flagged rows
smallcap/overview.json: 0 flagged rows
smallcap/real-estate.json: 0 flagged rows
smallcap/semiconductors.json: 0 flagged rows
smallcap/software-comm-services.json: 0 flagged rows
smallcap/utilities.json: 0 flagged rows
software-comm-services.json: 0 flagged rows
survival.json: 0 flagged rows
tech-hardware.json: 0 flagged rows
utilities.json: 1 flagged rows
Total flagged rows: 12
Rule40 changed rows: 0
{"file":"full/financials.json","track":"profitable","ticker":"1GLXY.MI","rank":70,"dupIssuer.of":"GLXY"}
{"file":"full/health-care.json","track":"unprofitable","ticker":"6855.HK","rank":275,"dupIssuer.of":"AAPG"}
{"file":"full/industrials.json","track":"profitable","ticker":"GCP.DE","rank":246,"dupIssuer.of":"GE"}
{"file":"full/industrials.json","track":"profitable","ticker":"AERO.MX","rank":1478,"dupIssuer.of":"AERO"}
{"file":"full/industrials.json","track":"unprofitable","ticker":"AVAV.SW","rank":41,"dupIssuer.of":"AVAV"}
{"file":"full/materials.json","track":"profitable","ticker":"AMRZ.SW","rank":425,"dupIssuer.of":"AMRZ"}
{"file":"full/materials.json","track":"profitable","ticker":"KCO.DE","rank":927,"dupIssuer.of":"KCO.VI"}
{"file":"full/utilities.json","track":"profitable","ticker":"CPLE3.SA","rank":59,"dupIssuer.of":"ELPC"}
{"file":"full/utilities.json","track":"profitable","ticker":"AXIA3.SA","rank":109,"dupIssuer.of":"AXIA"}
{"file":"industrials.json","track":"unprofitable","ticker":"AVAV.SW","rank":41,"dupIssuer.of":"AVAV"}
{"file":"quality/utilities.json","track":"profitable","ticker":"AXIA3.SA","rank":60,"dupIssuer.of":"AXIA"}
{"file":"utilities.json","track":"profitable","ticker":"CPLE3.SA","rank":59,"dupIssuer.of":"ELPC"}
Changed rows by feed: {"full":9,"shortLists":2,"overview":0,"survival":0,"quality":1,"smallcap":0,"rule40":0}
Only added key: dupIssuer; no rank, score, name or membership changed.
Unchanged feeds: excluded.json and druckenmiller/ (separate writers, no shadow step).
After directory: C:\Users\Anwender\AppData\Local\Temp\dup-issuer-shadow-after-z378hv
```

Die SHA256-Pruefung aller 63 Originale erfolgt vor der Verarbeitung und nochmals
nach dem Schreiben der temporaeren Kopien; auch die Pruefsummenliste bleibt unveraendert.
Jede Kopie wird von der Platte gelesen und nach Entfernen allein des neuen Schluessels
gegen ihr Original geprueft, einschliesslich Zeilen- und Schluesselreihenfolge.

Der neue Test baut echte Dateien mit dem Rule-of-40-Fixture und prueft die gepflanzte
Paarung ELPC/CPLE3.SA auf der Platte, die unveraenderten anderen Zeilen sowie einen
Build mit nur im Speicher ueberbruecktem Marker. Er prueft zudem eine Zweitnotierung
ohne Vollboard-Zeile und ohne ihren primaeren Ticker sowie fehlende, falsche und
unerlaubte Marker in einer separaten temporaeren Dateikopie.

Absichtlicher Rotnachweis, Exit-Code 1: Nur die reine Assertion `assertRejected` wurde
in einer Speicherkopie umgedreht und danach zurueckgesetzt; kein schreibender Test und
keine Quelldatei wurden veraendert. Der normale Check lehnt die geschriebene Kopie
ohne Marker ab; die umgedrehte Assertion verlangt absichtlich das Gegenteil.

```text
[rule40] Zeile 0 (CPLE3.SA): dupIssuer stimmt nicht mit der Handtabelle ueberein.
AssertionError [ERR_ASSERTION]: written secondary without its exact dupIssuer must be rejected

false !== true

In-memory assertion restored; source and original board SHA256 unchanged.
[yahoo-q4-hand-table-summary] {"observed":0,"corrected":0,"missing":0,"stale":0,"alreadyCorrected":0}
```

Der vollstaendige TEST-BEFEHL des Briefs einschliesslich `tests/jsdoc-exports.test.js`
bestand mit Exit-Code 0; letzte Zeilen:

```text
ℹ tests 45
ℹ suites 0
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1581.1149
```

Kein Commit, Push oder Netzwerkzugriff; die Auslieferung bleibt beim Auftraggeber.
