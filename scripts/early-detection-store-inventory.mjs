// E1 Phase 1 - Bestandsaufnahme des SEC-Komponentenspeichers.
// Read-only. Schreibt nur nach --out. Kein Netz.
// Aufruf: node inventar.mjs --data-root <pfad> --closure <provenance-closure.json> --out <bericht.json> [--hash all|sample|none]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const dataRoot = arg('data-root');
const closurePath = arg('closure');
const outPath = arg('out');
const hashMode = arg('hash', 'sample');
if (!dataRoot || !closurePath || !outPath) { console.error('fehlende Argumente'); process.exit(2); }

const sha256File = (p) => new Promise((res, rej) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(p).on('error', rej).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex')));
});

const closure = JSON.parse(fs.readFileSync(closurePath, 'utf8'));
const sealed = new Map(closure.payloads.map((p) => [p.payloadSha256, p]));
const superset = new Map(closure.supersetObservations.map((p) => [p.payloadSha256, p]));

// 1. Alle Beobachtungs-Records von der Platte lesen (die Wahrheit auf dem Datenträger).
const obsRoot = path.join(dataRoot, 'observations', 'sec-fsd');
const quarters = fs.readdirSync(obsRoot).filter((d) => /^\d{4}q[1-4]$/.test(d)).sort();
const obs = [];
for (const q of quarters) {
  for (const f of fs.readdirSync(path.join(obsRoot, q))) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(fs.readFileSync(path.join(obsRoot, q, f), 'utf8'));
    obs.push({
      quarter: q, file: f,
      variant: rec.datasetVariant, observedAt: rec.observedAt,
      sha: rec.payloadSha256, bytes: rec.payloadBytes,
      blobRel: rec.payloadPath, quality: rec.qualityState,
      quarantine: rec.quarantineReasons || [],
      members: rec.archiveValidation ? rec.archiveValidation.members : null,
      uncompressed: rec.archiveValidation ? rec.archiveValidation.uncompressedBytes : null,
      sourceUrl: rec.archiveEvidence ? rec.archiveEvidence.replayUrl : rec.originalSourceUrl,
      originalUrl: rec.originalSourceUrl,
      inSealed: sealed.has(rec.payloadSha256),
      inSuperset: superset.has(rec.payloadSha256),
    });
  }
}

// 2. Blob-Existenz + Groesse pruefen; optional Pruefsumme neu rechnen.
const sampleIdx = new Set();
if (hashMode === 'sample') {
  const step = Math.max(1, Math.floor(obs.length / 12));
  for (let i = 0; i < obs.length; i += step) sampleIdx.add(i);
}
for (let i = 0; i < obs.length; i++) {
  const o = obs[i];
  const abs = path.join(dataRoot, o.blobRel.split('/').join(path.sep));
  o.blobPath = o.blobRel;
  if (!fs.existsSync(abs)) { o.blob = 'FEHLT'; continue; }
  const st = fs.statSync(abs);
  o.blobBytes = st.size;
  o.blob = st.size === o.bytes ? 'groesse_ok' : 'GROESSE_ABWEICHEND';
  if (hashMode === 'all' || (hashMode === 'sample' && sampleIdx.has(i))) {
    const h = await sha256File(abs);
    o.hashRecomputed = h === o.sha ? 'sha256_ok' : 'SHA256_ABWEICHEND';
    if (h !== o.sha) o.hashActual = h;
  }
}

// 3. Auswertung.
const byQuarter = {};
for (const o of obs) {
  const b = (byQuarter[o.quarter] = byQuarter[o.quarter] || { legacy: 0, post2024: 0, revision: 0, other: 0, sealed: 0, superset: 0, unbekannt: 0 });
  if (o.variant === 'legacy_earliest_archived') b.legacy++;
  else if (o.variant === 'post_2024_reprocessed_or_current') b.post2024++;
  else if (o.variant === 'archived_digest_revision') b.revision++;
  else b.other++;
  if (o.inSealed) b.sealed++; else if (o.inSuperset) b.superset++; else b.unbekannt++;
}
const allQ = []; for (let y = 2009; y <= 2024; y++) for (let q = 1; q <= 4; q++) allQ.push(`${y}q${q}`);

const report = {
  schema: 'studie-e1-bestandsaufnahme/v1',
  erzeugtAm: new Date().toISOString(),
  dataRoot, closureSha256: closure.closureSha256,
  beobachtungen: {
    aufPlatte: obs.length,
    versiegelt: obs.filter((o) => o.inSealed).length,
    obermenge: obs.filter((o) => o.inSuperset).length,
    wederNoch: obs.filter((o) => !o.inSealed && !o.inSuperset).length,
    imVertragAberNichtAufPlatte: [...sealed.keys()].filter((s) => !obs.some((o) => o.sha === s)),
    obermengeNichtAufPlatte: [...superset.keys()].filter((s) => !obs.some((o) => o.sha === s)),
  },
  quartale: {
    erwartet: allQ.length,
    aufPlatte: quarters.length,
    fehlendGanz: allQ.filter((q) => !quarters.includes(q)),
    ohneLegacyStand: allQ.filter((q) => !byQuarter[q] || byQuarter[q].legacy === 0),
    ohnePost2024Stand: allQ.filter((q) => !byQuarter[q] || byQuarter[q].post2024 === 0),
    ohneVersiegeltenPost2024: allQ.filter((q) => !obs.some((o) => o.quarter === q && o.variant === 'post_2024_reprocessed_or_current' && o.inSealed)),
  },
  bytes: {
    gesamt: obs.reduce((a, o) => a + (o.blobBytes || 0), 0),
    versiegelt: obs.filter((o) => o.inSealed).reduce((a, o) => a + (o.blobBytes || 0), 0),
    obermenge: obs.filter((o) => o.inSuperset).reduce((a, o) => a + (o.blobBytes || 0), 0),
  },
  integritaet: {
    hashModus: hashMode,
    blobFehlt: obs.filter((o) => o.blob === 'FEHLT').map((o) => ({ quarter: o.quarter, sha: o.sha, pfad: o.blobRel })),
    groesseAbweichend: obs.filter((o) => o.blob === 'GROESSE_ABWEICHEND').map((o) => ({ quarter: o.quarter, sha: o.sha, erwartet: o.bytes, ist: o.blobBytes })),
    geprueftePruefsummen: obs.filter((o) => o.hashRecomputed).length,
    pruefsummeAbweichend: obs.filter((o) => o.hashRecomputed === 'SHA256_ABWEICHEND').map((o) => ({ quarter: o.quarter, sha: o.sha, ist: o.hashActual })),
  },
  qualitaet: {
    nichtAccepted: obs.filter((o) => o.quality !== 'accepted').map((o) => ({ quarter: o.quarter, variant: o.variant, quality: o.quality, gruende: o.quarantine })),
    leerVerdaechtig: obs.filter((o) => (o.bytes || 0) < 1_000_000).map((o) => ({ quarter: o.quarter, variant: o.variant, bytes: o.bytes, uncompressed: o.uncompressed })),
  },
  jeQuartal: byQuarter,
  beobachtungenDetail: obs.map((o) => ({ quarter: o.quarter, variant: o.variant, observedAt: o.observedAt, bytes: o.bytes, sha: o.sha, inSealed: o.inSealed, inSuperset: o.inSuperset, blob: o.blob, hash: o.hashRecomputed || null, originalUrl: o.originalUrl })),
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
const r = report;
console.log('Beobachtungen auf Platte :', r.beobachtungen.aufPlatte, '(versiegelt', r.beobachtungen.versiegelt, '/ Obermenge', r.beobachtungen.obermenge, '/ unbekannt', r.beobachtungen.wederNoch + ')');
console.log('Quartale                 :', r.quartale.aufPlatte, 'von', r.quartale.erwartet, '- fehlend ganz:', r.quartale.fehlendGanz.join(' ') || '(keine)');
console.log('ohne 2018er-Stand        :', r.quartale.ohneLegacyStand.join(' ') || '(keine)');
console.log('ohne 2025er-Stand        :', r.quartale.ohnePost2024Stand.join(' ') || '(keine)');
console.log('ohne VERSIEGELTEN 2025er :', r.quartale.ohneVersiegeltenPost2024.join(' ') || '(keine)');
console.log('Rohbytes gesamt          :', (r.bytes.gesamt / 1e9).toFixed(2), 'GB (versiegelt', (r.bytes.versiegelt / 1e9).toFixed(2), 'GB)');
console.log('Blobs fehlend            :', r.integritaet.blobFehlt.length, '| Groesse abweichend:', r.integritaet.groesseAbweichend.length);
console.log('Pruefsummen nachgerechnet:', r.integritaet.geprueftePruefsummen, '| davon abweichend:', r.integritaet.pruefsummeAbweichend.length);
console.log('nicht accepted           :', r.qualitaet.nichtAccepted.length);
console.log('Bericht                  :', outPath);

// ponytail: Selbstpruefung statt Test-Datei - faellt aus, wenn die Zaehl-Logik bricht.
if (r.beobachtungen.versiegelt + r.beobachtungen.obermenge + r.beobachtungen.wederNoch !== r.beobachtungen.aufPlatte) {
  throw new Error('Selbstpruefung fehlgeschlagen: Zerlegung versiegelt/Obermenge/unbekannt deckt nicht alle Beobachtungen');
}
