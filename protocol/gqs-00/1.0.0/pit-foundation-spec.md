# Point-in-Time-Foundation für GQS/GES

Status: **Spezifikation READY, Datenbasis NOT_READY**. Diese Architektur ist umsetzbar, aber nicht aktiviert. Der erste ehrliche Pfad ist SEC-US; globale Abdeckung ist ein späteres Gate.

## 1. Unverhandelbare Zeitregel

Für einen Bewertungsstichtag `t` darf nur ein Datensatz verwendet werden, dessen

`known_at = max(observed_at, source_published_at, filed_at)`

kleiner oder gleich `t` ist. Fehlt ein benötigter Veröffentlichungs-/Acceptance-Zeitpunkt, ist der Fakt für den Backtest nicht verwendbar. `period_end <= t` allein reicht ausdrücklich nicht. Original-as-filed und spätere Restatements bleiben getrennte Revisionen; eine jüngere Revision überschreibt nie eine ältere Sicht.

## 2. Persistentes Entity- und Listing-Ledger

Die stabile Ebene ist `entity_id`, nicht Ticker. Ein Entity ist die wirtschaftliche Gesellschaft; Listings, ADRs und Primärnotierungen hängen zeitlich daran.

```text
entities(
  entity_id UUID PK, legal_name, jurisdiction, cik NULL,
  valid_from, valid_to NULL, created_at, source_payload_sha256
)

listings(
  listing_id UUID PK, entity_id FK, ticker, exchange_mic, isin NULL, cusip NULL,
  security_type, currency, is_adr, adr_ratio NULL,
  valid_from, valid_to NULL, source, source_revision, payload_sha256
)

entity_events(
  event_id UUID PK, entity_id FK, event_type,
  effective_at, announced_at NULL, predecessor_entity_id NULL,
  successor_entity_id NULL, listing_id NULL, terms_json,
  source, source_revision, payload_sha256
)
```

`event_type` umfasst mindestens `ticker_change`, `listing_start`, `listing_end`, `adr_ratio_change`, `primary_listing_change`, `split`, `reverse_split`, `spin_off`, `merger`, `acquisition`, `bankruptcy`, `delisting`, `cash_distribution`. Änderungen sind append-only; Korrekturen erzeugen eine neue Revision und eine explizite Supersession-Kante. Die vorhandene Ticker-Landkarte seit Juli 2026 ist ein Startbeleg, keine rückwirkende Entity-Historie.

## 3. Append-only Fact- und Payload-Schema

```text
source_payloads(
  payload_sha256 CHAR(64) PK, source, source_locator,
  fetched_at, source_published_at NULL, http_etag NULL,
  content_type, byte_length, storage_uri, license_class,
  parser_version, immutable BOOLEAN
)

fact_observations(
  fact_id UUID PK, entity_id FK, listing_id NULL,
  taxonomy, concept, period_start NULL, period_end,
  value DECIMAL, unit, currency NULL,
  observed_at, source_published_at NULL, filed_at NULL,
  source, source_revision, accession NULL, context_id NULL,
  payload_sha256 FK, parser_version, quality_state,
  supersedes_fact_id NULL, ingested_at
)

UNIQUE(source, source_revision, accession, context_id, taxonomy, concept,
       entity_id, period_start, period_end, unit, currency, value)
```

`quality_state` ist `accepted`, `quarantined` oder `rejected`. Rohpayload und Hash sind unveränderlich. Parserkorrekturen erzeugen neue Observationen mit neuer `parser_version`; sie ändern den Payload nicht. Der SEC-Companyfacts-Cache im heutigen Repository enthält wertvolle historische Filingzeilen, aber nicht die geforderte unveränderliche Folge aller abgerufenen Payloadrevisionen und nicht durchgehend den Acceptance-Zeitpunkt.

## 4. Historische Universe- und Listing-Mitgliedschaft

```text
universe_membership(
  membership_id UUID PK, universe_id, entity_id, listing_id,
  valid_from, valid_to NULL, inclusion_reason, exclusion_reason NULL,
  decided_at, rule_version, source_payload_sha256
)
```

Mitgliedschaft wird für jeden Stichtag aus damals bekannten Listing-, Preis-, Größen- und Liquiditätsdaten berechnet und als Vintage mit Manifest eingefroren. Ein heutiger Watchlistbestand darf niemals rückwirkend als damaliges Universum dienen. Delistete und fusionierte Namen bleiben in alten Vintages erhalten.

## 5. As-of-Schnittstelle

Die einzige Feature-Schnittstelle lautet konzeptionell:

```text
facts_as_of(entity_id, concepts[], evaluation_at, revision_policy='known_then')
universe_as_of(universe_id, evaluation_at)
listing_as_of(entity_id, evaluation_at)
prices_after(listing_id, execution_at, horizon, adjustment_policy_version)
```

`facts_as_of` wählt je wirtschaftlichem Fact-Key die jüngste Revision mit `known_at <= evaluation_at`. `revision_policy='original_as_filed'` wählt die erste damals bekannte Einreichung; `known_then` darf eine bis `t` bereits bekannte Amendment-Revision verwenden. Eine Query, die ein `known_at > t` zurückgibt, ist ein harter Testfehler.

## 6. Preise, Corporate Actions und Outcomes

```text
price_bars(
  listing_id, session_date, open, high, low, close, volume,
  split_factor_known_then, cash_distribution_known_then,
  source, source_revision, payload_sha256,
  PRIMARY KEY(listing_id, session_date, source_revision)
)
```

Features sehen nur Preise bis zum Availability-Cutoff. Outcomes beginnen an der ersten im Protokoll zugelassenen Ausführung und verwenden ausschließlich nachfolgende, splits-/ausschüttungsbereinigte Preise. Ein verifiziertes Delisting wird über dokumentierte Bar-/Aktiengegenleistung abgerechnet; fehlt sie bei endgültigem wertlosen Abgang, gilt −100 %. Ein bloß endender Kursfeed ist kein Delistingbeleg und wandert in Quarantäne. Fusionen und Spin-offs laufen über `entity_events`, nicht über heutige Tickerheuristik.

## 7. Ingestion, Idempotenz und Wiederherstellung

Jeder Lauf erzeugt zuerst ein unveränderliches Payloadobjekt und danach ein Manifest:

```text
ingest_manifests(
  run_id, source, started_at, completed_at NULL, status,
  requested_count, payload_count, accepted_fact_count,
  quarantined_count, rejected_count, manifest_sha256,
  code_commit, parser_version, parent_manifest_sha256 NULL
)
```

- Idempotenzschlüssel ist der vollständige Payloadhash plus Source-Revision; derselbe Payload erzeugt keine zweite Factmenge.
- Deduplizierung arbeitet auf dem `UNIQUE`-Schlüssel, nicht auf gerundeten Werten.
- Abweichende Werte zum selben Fact-Key sind Revisionen, kein stiller Upsert.
- Quarantäne bewahrt Payload, Parserdiagnose und Kandidatenzuordnung; sie speist keine Features.
- Retention: Payloads, Manifeste, Entity-Events und verwendete Facts dauerhaft; abgeleitete Featurematrizen mindestens bis zur vollständigen Reproduktionsabnahme plus sieben Jahre.
- Wiederherstellung: leere Datenbank aus Payloadstore + geordneter Manifestkette neu aufbauen; anschließend Tabellen-, Manifest- und Stichprobenhashes vergleichen.
- Atomare Veröffentlichung: erst wenn Payloadcount, Quarantänequote, Foreign Keys und Hashmanifest grün sind, wird ein Vintage sichtbar.

## 8. Migration ohne erfundene Vergangenheit

1. Bestehende SEC-XBRL-Payloads werden mit ihrem belegten Fetch-/Filing-Stand importiert. Historische `filed`-Zeilen dürfen als Filingdatum dienen; der exakte Acceptance-Zeitpunkt bleibt `UNKNOWN`, bis er aus SEC-Submission-/Filingmetadaten belegt ist.
2. Die Ticker-Landkarte und Newcomer-Logs werden ab ihrem realen Startdatum importiert. Vor Juli 2026 entsteht daraus keine künstliche Mitgliedschaft.
3. Yahoo-Snapshots erhalten nur den tatsächlich belegten `observed_at`. Ihre darin enthaltenen aktuellen/letzten Fundamentals werden nicht auf alte Perioden-Enden zurückprojiziert.
4. Bestehende Board-Vintages bleiben Mess- und Outcome-Anker, nicht Ersatz für fehlende Rohuniversen.
5. Historische SEC-US-Vintages werden erst ab dem ersten vollständig rekonstruierbaren Acceptance-, Entity-, Universe- und Preisdatum als backtestfähig markiert.

## 9. Status der heutigen Bausteine

| Baustein | Status | Beleg / Grenze |
|---|---|---|
| GQS-00 Formelidentität, Fixtures, Lineal | READY | In diesem versiegelten Verzeichnis vollständig reproduzierbar. |
| SEC Filing-Facts mit `filed` und Accession | PARTIALLY_READY | `external-data/sec-xbrl/` enthält Companyfacts-Historie; Payloadrevisionen und Acceptance-Zeitpunkte sind nicht als append-only Ledger komplett. |
| Tickeränderungs-Mitschnitt | PARTIALLY_READY | `external-data/ticker-map/` existiert erst seit Juli 2026 und ist kein globales Entity-Ledger. |
| Newcomer-/Universe-Vintages | PARTIALLY_READY | `newcomer-log/` und Board-Vintages existieren, aber keine vollständige historische Membership seit 2010. |
| Dauerhafte Rohsnapshot-Vintages | NOT_READY | Vollständiger 7.-August-Lauf nur temporäres Actions-Artefakt; keine dauerhafte tägliche Rohretention. |
| Delisting-/Corporate-Action-Ledger | NOT_FOUND | Einzelne heutige Flags/Preisregeln ersetzen keine effekt-datierte Historie. |
| Historische adjusted prices mit Outcome-Vertrag | PARTIALLY_READY | Preisshards und Rank-IC-Regeln existieren; globale Tiefe, Delistings und Corporate Actions sind nicht vollständig. |
| Exakte As-of-Query und Leakage-Gate | NOT_READY | Noch keine zentrale `known_at`-Schnittstelle über Facts, Universe, Listings und Preise. |
| Lizenzierter PIT-Consensus | NOT_FOUND | Deshalb aus GES v1.0.0 ausgeschlossen. |
| Globale PIT-Abdeckung | UNKNOWN | Erst nach bestandenem SEC-US-Pilot und Quellen-/Lizenzentscheid neu bewerten. |

## 10. Meilensteine, Tests und Aufwand

| Meilenstein | Inhalt | Abnahmetests | Schätzung |
|---|---|---|---|
| M0 Verträge einfrieren | DDL, IDs, `known_at`, Payload-/Manifestformat, SEC-Konzeptkarte | Schema-Fixtures; kein Feld ohne Zeit-/Quellprovenienz | 3–5 Arbeitstage |
| M1 Entity-/Listing-Ledger SEC-US | CIK-Entity, historische Listings, ADR/Primärlisting, Fusionen/Delistings | 500 adjudizierte Ereignisse; ≥99,5 % korrekte Zuordnung; keine überlappenden Primärlistings | 2–3 Wochen |
| M2 Append-only SEC-Ingest | Submissions/filings/companyfacts, Acceptance, Original/Amendment, Payloadstore | Idempotenz; Revisionstest; Payload-Rebuild byte-/hashgleich; Quarantäne fail-closed | 2–3 Wochen |
| M3 Universe- und As-of-Layer | effekt-datierte Membership, Query-API, SEC-GQS-Adapter | 100 Leakage-Fixtures; jede Antwort `known_at<=t`; heutiger Adapter reproduziert GQS-Goldenfälle | 2 Wochen |
| M4 Preise/Outcomes | adjusted bars, Splits, Ausschüttungen, Delisting-/Mergerterms | bekannte Delistings/Merger; −100-%-Pfad; kein Future-Adjustment in Features | 2–3 Wochen |
| M5 Schatten-Replay | ungeöffnete Featurematrizen und Manifeste, noch ohne Outcomeauswertung | zwei vollständige Rebuilds hashgleich; Coverage ≥60 %; unresolved delistings ≤5 % | 1–2 Wochen |
| M6 Pilot-Gate | unabhängiger Readiness-Audit, Prereg-Hash, Testfenster versiegeln | alle Blocker grün; keine Pilotmetrik vorher berechnet | 3–5 Arbeitstage |

Gesamt: grob 9–13 Entwicklerwochen für den ehrlichen SEC-US-Pfad, zuzüglich Quellenklärung für Preise/Corporate Actions. Es wurden keine kostenpflichtigen APIs autorisiert. SEC-Rohdaten sind verfügbar; belastbare historische Kurs-/Corporate-Action-Abdeckung kann Lizenz- oder Kostenentscheidungen benötigen und bleibt bis dahin ein explizites Gate.

## Exit-Kriterium der Foundation

`READY_TO_EXECUTE` gilt erst, wenn M0–M6 grün sind, zwei unabhängige Rebuilds dieselben Manifest- und Featurehashes liefern, die Entity-Auditpräzision mindestens 99,5 % beträgt, kein Leakage-Fixture versagt, mindestens 60 % der sonst zulässigen Entity-Events vier von fünf GES-Faktoren tragen und höchstens 5 % der reifen Outcomes ein ungeklärtes Delisting-/Serienende haben.
