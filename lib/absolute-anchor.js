/**
 * lib/absolute-anchor.js — Reusable Absolute Anchor for Screener Formulas
 *
 * STATUS: verified-DESIGN, Konstanten [TODO-CAL]; Norm-Tabelle nur für medtech_devices abgestimmt.
 * system_app_software und fabless_semi sind mit '-TODO-retrofit' markiert → noch nicht retrofittet.
 *
 * Governance:
 *   SI-1: Hartes Gate (gateOpen) auf Basis absoluter Sektor-Normen — für den Shortlist-Cut gedacht,
 *         NICHT als harter Score-Kill eingebaut (der REL-Pfad läuft separat in court-score.js).
 *   SI-2: Absolute Kaliber-Achse (absKaliber) als Ergänzung zum cross-sektionalen REL-Score.
 *   SI-3: blendScore kombiniert ABS + REL; β=0-Pfad = pure REL → faithful-refactor-Anker für den
 *         späteren SaaS/Fabless-Retrofit ohne Verhaltensänderung am bestehenden court-score.js.
 *
 * Design-Entscheide:
 *   - eff-Komponente in absKaliber nutzt q(opMargin, norm.eff) direkt (nicht max der drei Arme).
 *     Begründung: einfachste, deterministischste Implementierung; die Disjunktions-Logik von effGatePass
 *     ist nur für das binäre Gate (SI-1) gedacht. Beim Retrofit kann eff-q erweitert werden.
 *   - Alle Funktionen sind rein und deterministisch: kein fs, kein Netz, kein Date, kein Math.random.
 *   - null/NaN → 0 in q() (sichere Null, kein Fehler-Throw).
 *
 * Abweichung von court-score.js-Mathematik (für späteren Retrofit):
 *   court-score.js nutzt pseudo-z = (raw - Median) / MAD + tanh-Sättigung (cross-sektional, relativ).
 *   Dieses Modul nutzt einen linearen Clip zwischen absoluten Floor/Elite-Ankern (SI-2-Definition).
 *   Der β=0-Pfad (blendScore mit beta=0) mappt auf 100*rel und ist ein faithful-refactor-Anker:
 *   Wenn in einem zukünftigen Retrofit court-score.js das 'core'-Signal als 'rel'-Argument übergibt,
 *   entsteht kein Verhaltens-Bruch für SaaS/Fabless (die ABS-Normen sind noch -TODO-retrofit).
 */

'use strict';

// ---------------------------------------------------------------------------
// Sektor-Norm-Tabelle (Konstanten [TODO-CAL])
// ---------------------------------------------------------------------------

/**
 * NORMS — eingefrorene Sektor-Norm-Tabelle.
 * Jeder Eintrag hat:
 *   id:     versionierter Bezeichner (Format: '<bucket>-norms-<datum>')
 *   growth: { floor, elite } — minimale bzw. Ausnahme-Wachstumsrate (jährlich, relativ)
 *   gm:     { floor, elite } — Bruttomarge (0..1)
 *   eff:    { floor, elite } — operative Effizienz-Marge (opMargin; 0..1)
 *
 * Platzhalter-Einträge haben id: '...-TODO-retrofit' und null-Felder → noch nicht abgestimmt.
 * Beim Retrofit: id updaten, Felder befüllen, Tests erweitern.
 */
const NORMS = Object.freeze({
  medtech_devices: Object.freeze({
    id: 'medtech-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.29 }),
    gm:     Object.freeze({ floor: 0.55, elite: 0.70 }),
    eff:    Object.freeze({ floor: 0.08, elite: 0.25 }),
  }),

  // diagnostics_lst (D&LST) — gefrorene Norm-Zeile (Konstanten [TODO-CAL]).
  // COHORT-AWARE GM (Spec §1/§3): die GM-Ökonomie der zwei Kohorten differiert materiell
  // (TMO ~41% vs IDXX ~58% würde eine gepoolte GM-Säule korrumpieren) → GM-NORMS PRO KOHORTE:
  //   dx:    gm floor 0.50 / elite 0.65 (sekulär, hohe Marge)
  //   tools: gm floor 0.38 / elite 0.58 (funding-zyklisch, bimodale Marge)
  // growth/eff sind kohorten-gemeinsam: growth floor 0.15 (gateOpen-Floor, latestOrganicYoY),
  //   eff floor 0.10 / elite 0.25 (FCF-Marge primär, OpM-Fallback — Spec §3).
  // absKaliber-Gewichte {growth .40, gm .20, eff .40} werden in court-score.js gesetzt (nicht hier).
  // Die kohorten-spezifischen Einträge teilen sich die EINE normTableId 'dlst-norms-2026-06-20'.
  diagnostics_lst: Object.freeze({
    id: 'dlst-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.30 }),
    gm:     Object.freeze({ floor: 0.38, elite: 0.65 }), // gepoolter Fallback (nicht für Scoring genutzt)
    eff:    Object.freeze({ floor: 0.10, elite: 0.25 }),
  }),
  diagnostics_lst_dx: Object.freeze({
    id: 'dlst-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.30 }),
    gm:     Object.freeze({ floor: 0.50, elite: 0.65 }),
    eff:    Object.freeze({ floor: 0.10, elite: 0.25 }),
  }),
  diagnostics_lst_tools: Object.freeze({
    id: 'dlst-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.30 }),
    // v1.2 Fix 1 [TODO-CAL]: tools-GM-Floor 0.30 -> 0.28 (war v1.1: 0.38 -> 0.30). ÖKONOMISCHE
    // BEGRÜNDUNG (1 Zeile): CRO-/Service-Modell-Tools (MEDP/IQV/CRL) laufen STRUKTURELL bei ~28-33% Brutto-
    // marge — ihre Kosten der Leistungserbringung sind personal-/standort-getrieben (Studien-Sites, klinisches
    // Personal), nicht consumable-getrieben wie Instrument-Ökonomik (>50% GM) → ein defensibler Service-Class-
    // Floor liegt am UNTEREN Rand dieses ~28-33%-Bands, nicht am 0.30-Punkt, der v1.1 exakt auf MEDPs 0.3006
    // (6bp Clearance) gesetzt war = OVERFIT. Bei 0.28 hat MEDP ~2.1pp echtes Headroom und eine kleine GM-Daten-
    // revision kann die Headline nicht mehr still kippen. Verifiziert NARROW: zwischen [0.28,0.30) liegt KEIN
    // weiterer Name (nächst-höhere tools-GM über 0.28 sind AVTR 0.327/CRL 0.330/IQV 0.333, alle bereits >0.30
    // und draußen am Growth-/eff-Gate, NICHT am GM-Floor) → der Floor-Move admittiert KEINEN neuen Namen.
    // elite bleibt 0.58 (absKaliber-Skala-Oberkante unverändert).
    gm:     Object.freeze({ floor: 0.28, elite: 0.58 }),
    eff:    Object.freeze({ floor: 0.10, elite: 0.25 }),
  }),

  system_app_software: Object.freeze({
    id: 'system-app-software-norms-TODO-retrofit',
    growth: null,
    gm:     null,
    eff:    null,
  }),

  fabless_semi: Object.freeze({
    id: 'fabless-semi-norms-TODO-retrofit',
    growth: null,
    gm:     null,
    eff:    null,
  }),
});

// ---------------------------------------------------------------------------
// Kernfunktionen
// ---------------------------------------------------------------------------

/**
 * q(raw, {floor, elite}) — linearer Clip auf [0, 1].
 * Mappt raw auf den Bereich [floor, elite]: floor → 0, elite → 1, dazwischen linear.
 * Werte unter floor werden auf 0 geclippt, Werte über elite auf 1.
 * null / NaN / undefined → 0 (sichere Null).
 *
 * @param {number|null|undefined} raw
 * @param {{ floor: number, elite: number }} norm
 * @returns {number}
 */
function q(raw, { floor, elite }) {
  if (raw == null || !isFinite(raw)) return 0;
  const range = elite - floor;
  if (range === 0) return raw >= elite ? 1 : 0;
  const scaled = (raw - floor) / range;
  return Math.max(0, Math.min(1, scaled));
}

/**
 * effGatePass(rec, norm) — Effizienz-Gate mit Land-Grab-Schutz (Disjunktion, SI-1).
 * Gibt true, wenn MINDESTENS EINE dieser Bedingungen erfüllt ist:
 *   1. rec.opMargin  >= norm.eff.floor         (profitable operations)
 *   2. rec.fcfMargin >= 0.05                   (FCF-positiv)
 *   3. (rec.growth + rec.opMargin) >= 0.30     (RoX-Arm: Hochseiler mit Wachstumsprämie)
 *
 * @param {{ opMargin: number, fcfMargin: number, growth: number }} rec
 * @param {{ eff: { floor: number } }} norm
 * @returns {boolean}
 */
function effGatePass(rec, norm) {
  if (rec.opMargin  >= norm.eff.floor)            return true;
  if (rec.fcfMargin >= 0.05)                       return true;
  if ((rec.growth + rec.opMargin) >= 0.30)         return true;
  return false;
}

/**
 * gateOpen(rec, bucket) — Hartes SI-1-Gate über absolute Sektor-Normen.
 * Gibt true, wenn:
 *   - rec.growth >= NORMS[bucket].growth.floor
 *   - rec.gm     >= NORMS[bucket].gm.floor
 *   - effGatePass(rec, NORMS[bucket]) === true
 *
 * Nur für den Shortlist-Cut gedacht, NICHT als harter Score-Kill.
 * Wirft, wenn bucket nicht in NORMS oder Norm-Felder null (noch nicht retrofittet).
 *
 * @param {{ growth: number, gm: number, opMargin: number, fcfMargin: number }} rec
 * @param {string} bucket
 * @returns {boolean}
 */
function gateOpen(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`gateOpen: unbekannter Bucket "${bucket}"`);
  if (!norm.growth || !norm.gm || !norm.eff) throw new Error(`gateOpen: Bucket "${bucket}" noch nicht retrofittet (TODO)`);
  if (rec.growth < norm.growth.floor) return false;
  if (rec.gm     < norm.gm.floor)     return false;
  return effGatePass(rec, norm);
}

/**
 * absKaliber(rec, bucket, weights) — Absolute Kaliber-Punktzahl (SI-2), Wert in [0, 1].
 * Σ weights[k] * q(rec[k], NORMS[bucket][k]) für k ∈ { growth, gm, eff }.
 *
 * eff-Komponente: q(rec.opMargin, NORMS[bucket].eff).
 * Design-Entscheid: opMargin direkt (einfach, deterministisch); die Disjunktions-Arme
 * von effGatePass sind nur für das binäre Gate (SI-1). Retrofit-Note: für den RoX-Arm
 * wäre max(opMargin, growth+opMargin-0.30+eff.floor) als eff-Input möglich.
 *
 * Default-Gewichte: { growth: 0.45, gm: 0.30, eff: 0.25 } (Summe = 1.0).
 *
 * @param {{ growth: number, gm: number, opMargin: number }} rec
 * @param {string} bucket
 * @param {{ growth?: number, gm?: number, eff?: number }} [weights]
 * @returns {number}
 */
function absKaliber(rec, bucket, weights) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliber: unbekannter Bucket "${bucket}"`);
  if (!norm.growth || !norm.gm || !norm.eff) throw new Error(`absKaliber: Bucket "${bucket}" noch nicht retrofittet (TODO)`);
  const w = Object.assign({ growth: 0.45, gm: 0.30, eff: 0.25 }, weights);
  return w.growth * q(rec.growth, norm.growth)
       + w.gm     * q(rec.gm,     norm.gm)
       + w.eff    * q(rec.opMargin, norm.eff);
}

/**
 * blendScore(absK, rel, beta) — Gemischter Score (SI-3), Wert in [0, 100].
 * blendScore = 100 * (beta * absK + (1 - beta) * rel)
 *
 * beta=0  → pure REL (faithful-refactor-Anker für SaaS/Fabless-Retrofit)
 * beta=1  → pure ABS
 * Default beta: 0.6
 *
 * @param {number} absK  — absolute Kaliber-Punktzahl, [0, 1]
 * @param {number} rel   — relativer Score aus REL-Engine (court-score.js 'core'), [0, 1]
 * @param {number} [beta=0.6]
 * @returns {number}
 */
function blendScore(absK, rel, beta) {
  const b = (beta === undefined || beta === null) ? 0.6 : beta;
  return 100 * (b * absK + (1 - b) * rel);
}

/**
 * normTableId(bucket) — Gibt die id des Norm-Eintrags zurück (für Audit/Governance).
 *
 * @param {string} bucket
 * @returns {string}
 */
function normTableId(bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`normTableId: unbekannter Bucket "${bucket}"`);
  return norm.id;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { q, NORMS, effGatePass, gateOpen, absKaliber, blendScore, normTableId };
