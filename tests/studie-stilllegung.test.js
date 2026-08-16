'use strict';

// Waechter zum Stilllegungs-Record der Studien-Verfassung 2.0.0 (E0, Teil 3).
//
// Die SACHE, die hier festgenagelt wird, ist NICHT "die Datei sieht richtig aus",
// sondern: KEIN Beweisartefakt des Altapparats ist verschwunden oder veraendert.
// Deshalb wird jeder Eintrag ueber seinen INHALTS-Hash geprueft, nicht ueber seinen
// Pfad — ein umbenanntes oder ueberschriebenes Artefakt faellt genauso auf wie ein
// geloeschtes. Und die Liste selbst ist per Mengen-Digest gebunden: wer einen Eintrag
// still herausnimmt, bricht den Digest.
//
// Zwei Tiers, weil ein CI-Checkout die Alt-Branch-Objekte nicht zwingend hat:
//   Tier A (hart, immer): alle Eintraege mit onMain=true gegen den Arbeitsbaum.
//   Tier B (hart, wenn erreichbar): Alt-Branch-Eintraege gegen `git cat-file`.
// Nicht erreichbare Eintraege werden NAMENTLICH ausgegeben, nie stumm uebersprungen,
// und die Zahl der harten Pruefungen muss minimumVerifiable erreichen — ein Lauf,
// der aus Versehen nichts prueft, ist rot, nicht gruen.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const RECORD = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'supersede-record.json');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonicalDigest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function blobFromCommit(commit, repoPath) {
  const run = spawnSync('git', ['cat-file', 'blob', `${commit}:${repoPath}`], {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0 || !run.stdout) return null;
  return run.stdout;
}

test('Stilllegungs-Record: Altapparat sauber benannt, Gueltigkeit an Herkunft gebunden', () => {
  const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  assert.equal(record.schema, 'early-detection-supersede-record/v1');
  assert.equal(record.mode, 'SUPERSEDE_NO_DELETE');
  assert.equal(record.supersedes, 'FEM-SEC-US@1.2.0');

  const alt = record.altApparatus;
  assert.match(alt.commit, /^[0-9a-f]{40}$/, 'Alt-Commit muss ein voller SHA sein, kein Kurzhash');
  assert.ok(alt.branch && alt.branch.length > 0);
  for (const schutz of ['kein Loeschen', 'kein Force-Push', 'keine rueckwirkende Aenderung']) {
    assert.ok(alt.protection.includes(schutz), `Schutzzusage fehlt: ${schutz}`);
  }

  // Teil 3 Ablauf (2): der Record ist wertlos ohne Herkunfts-Schliessung + Daten-Vertrag.
  assert.ok(Array.isArray(record.validOnlyWith) && record.validOnlyWith.length >= 2);
  for (const rel of record.validOnlyWith) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `validOnlyWith-Artefakt fehlt: ${rel}`);
  }
});

test('Stilllegungs-Record: Beweisliste ist per Mengen-Digest gegen stilles Streichen gesichert', () => {
  const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  assert.equal(
    canonicalDigest(record.preservedEvidence),
    record.preservedEvidenceSetSha256,
    'preservedEvidenceSetSha256 passt nicht zur Liste — ein Eintrag wurde veraendert oder entfernt',
  );

  const onMain = record.preservedEvidence.filter((e) => e.onMain === true).length;
  assert.equal(record.minimumVerifiable, onMain, 'minimumVerifiable muss der Zahl der main-Eintraege entsprechen');
  assert.ok(onMain > 0);
});

test('Stilllegungs-Record: jedes erhaltene Beweisartefakt hat noch seinen Inhalts-Hash', () => {
  const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  const alt = record.altApparatus.commit;
  const ungeprueft = [];
  let hart = 0;

  for (const entry of record.preservedEvidence) {
    let bytes = null;
    if (entry.onMain === true) {
      const abs = path.join(REPO, entry.path);
      assert.ok(fs.existsSync(abs), `Als onMain gefuehrtes Beweisartefakt fehlt im Arbeitsbaum: ${entry.id}`);
      bytes = fs.readFileSync(abs);
    } else {
      bytes = blobFromCommit(alt, entry.path);
      if (bytes === null) {
        ungeprueft.push(`${entry.id} (${entry.path} @ ${alt.slice(0, 10)})`);
        continue;
      }
    }
    assert.equal(sha256(bytes), entry.sha256, `Inhalts-Hash weicht ab: ${entry.id}`);
    assert.equal(bytes.length, entry.bytes, `Byte-Laenge weicht ab: ${entry.id}`);
    hart += 1;
  }

  if (ungeprueft.length > 0) {
    // Nie stumm: was nicht geprueft werden konnte, steht namentlich im Log.
    console.log(`UNGEPRUEFT (Alt-Branch-Objekt nicht im Checkout): ${ungeprueft.join(', ')}`);
  }
  assert.ok(
    hart >= record.minimumVerifiable,
    `Nur ${hart} Artefakte hart geprueft, verlangt sind ${record.minimumVerifiable} — ein Lauf ohne Pruefung ist kein gruener Lauf`,
  );
});
