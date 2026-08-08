# Confirmatory execution runbook

Status: **BLOCKED WHILE ANY EXECUTION GATE IS RED**.

This runbook does not authorize an outcome access. It fixes the only permitted order once every data, blindness and audit artifact exists.

1. Produce the complete raw input without opening locked labels in an analysis environment. The input identity is the SHA-256 of its exact bytes. It contains `entityListingLedger`, `historicalUniverse`, `femSignals`, the complete `femControlPool`, `technicalOnlySignals`, the complete `technicalOnlyControlPool`, `hLatePopulation`, `conceptMap`, `analysisCutoffAt`, `researchCorpusSha256` and `componentManifest`. The manifest contains the canonical SHA-256 of every named embedded component plus the external research-corpus hash. The input contains no accepted `matchedSets`, prepared candidate states, `growthEvents[].qualifies`, technical-transition result or H-FEM pass/fail fields.
2. Create a run-specific gate-evidence file from `execution-gate-evidence-template.json` and one run-specific artifact per gate from `execution-gate-artifact-template.json`. Every one of the eleven non-code gates must point to one PASS artifact whose exact bytes are committed on an ancestor of fetched `origin/main`. Each artifact attests the exact full-input byte hash, the complete gate-specific set of component hashes, a reproducible method and timestamped evidence required by the sealed runner. Each unique evidence path must exist in the same remote commit and its exact bytes must match its declared SHA-256. The `researchCorpusSealed` artifact attests the separate external corpus-manifest hash; the gate-artifact file hash proves the attestation file's identity and is never equated with the corpus hash.
3. Before any process reads the raw input, append a `confirmatory_execution_authorized` event to `outcome-access-ledger.json`. It must bind `runId`, `accessAt`, `actor`, `scope`, `purpose`, `analysisCutoffAt`, `inputFileSha256`, `gateEvidenceFileSha256`, `researchCorpusSha256`, `protocolManifestSha256`, `previousHash` and the canonical `eventHash`.
4. Update `outcome-access-checkpoint.json` to the exact new event count, chain head and ledger-file SHA-256. Commit and push the ledger and checkpoint to protected `origin/main`. A local commit, unpushed branch or zero-event genesis checkpoint never authorizes the run.
5. Run the exact locked Python/NumPy environment:

   `python scripts/early-detection-confirmatory.py --gate-evidence <run-gates.json> --input <raw-input.json> --output <result.json>`

Before reading `<raw-input.json>`, the runner checks the local manifest and every sealed file byte-for-byte against fetched `origin/main`, verifies the complete remote checkpoint history, validates the latest authorization event, and verifies every remote gate artifact. It then hashes the input bytes, recomputes every embedded component hash, compares them with every gate artifact and the bound corpus/cutoff, derives all labels/matches/splits/statistics internally and writes a result carrying both input and authorization identities.

Any mismatch blocks without a result. Any method or runtime change after outcome access requires a new semantic protocol and a future locked window.
