#!/usr/bin/env node
/**
 * Tag 77 — Dashboard mit Refresh-Button
 * Standalone HTML mit "Discover"-Button. Klick triggert GitHub-Workflow,
 * polled Status, lädt Methods-Report nach Done.
 */
'use strict';
const fs = require('fs');

const REPO_OWNER = 'Karlryl';
const REPO_NAME = 'screener-data';
const WORKFLOW = 'daily-pull.yml';

function main() {
  const outFile = process.argv[2] || './dashboard.html';

  const html = `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Karl's Stock-Screener — Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #e2e8f0; margin: 0; padding: 30px; min-height: 100vh; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { color: #f1f5f9; font-size: 32px; margin: 0 0 8px; }
  .sub { color: #94a3b8; font-size: 14px; margin-bottom: 30px; }
  .card { background: rgba(30, 41, 59, 0.7); border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 16px; backdrop-filter: blur(10px); }
  .hero { text-align: center; padding: 40px 24px; }
  .discover-btn { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; font-size: 22px; font-weight: 700; padding: 18px 48px; border-radius: 50px; cursor: pointer; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3); transition: all 0.2s; letter-spacing: 0.5px; }
  .discover-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(16, 185, 129, 0.4); }
  .discover-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  .discover-btn:disabled:hover { transform: none; }
  .status { margin-top: 20px; padding: 14px; border-radius: 8px; font-size: 14px; min-height: 50px; display: none; }
  .status.active { display: block; }
  .status.info { background: #3b82f622; border: 1px solid #3b82f6; color: #93c5fd; }
  .status.success { background: #10b98122; border: 1px solid #10b981; color: #6ee7b7; }
  .status.error { background: #ef444422; border: 1px solid #ef4444; color: #fca5a5; }
  .links { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; justify-content: center; }
  .links a { background: #334155; color: #cbd5e1; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-size: 13px; transition: background 0.15s; }
  .links a:hover { background: #475569; color: #f1f5f9; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 20px; }
  .stat { background: rgba(15, 23, 42, 0.5); padding: 12px 16px; border-radius: 8px; border-left: 3px solid #8b5cf6; }
  .stat .num { font-size: 22px; font-weight: 700; color: #f1f5f9; }
  .stat .lbl { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .pat-modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 100; align-items: center; justify-content: center; padding: 24px; }
  .pat-modal.open { display: flex; }
  .pat-content { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 28px; max-width: 500px; }
  .pat-content h3 { margin: 0 0 12px; color: #f1f5f9; }
  .pat-content p { color: #cbd5e1; font-size: 13px; line-height: 1.5; margin: 8px 0; }
  .pat-content input { width: 100%; padding: 10px 12px; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; font-family: monospace; margin: 12px 0; font-size: 13px; }
  .pat-content button { background: #10b981; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; margin-right: 8px; }
  .pat-content button.cancel { background: #475569; }
  .pat-content code { background: #0f172a; padding: 2px 6px; border-radius: 3px; color: #a78bfa; font-size: 11px; }
  .progress-bar { height: 6px; background: #334155; border-radius: 3px; overflow: hidden; margin-top: 8px; }
  .progress-bar .fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); animation: progress 2s ease-in-out infinite; }
  @keyframes progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
  .footer { text-align: center; color: #64748b; font-size: 11px; margin-top: 30px; }
</style>
</head>
<body>

<div class="container">
  <h1>📊 Karl's Stock-Screener</h1>
  <div class="sub">23 Methoden, 70 Stocks, autonome Pipeline. Klick „Discover" um frische Daten zu pullen.</div>

  <div class="card hero">
    <button class="discover-btn" id="discover-btn">🔍 Discover</button>
    <div class="status" id="status"></div>
    <div class="links">
      <a href="./methods-report.html">📋 Methods-Report öffnen</a>
      <a href="./diff-report.html">🔄 Diff-Report</a>
      <a href="https://github.com/${REPO_OWNER}/${REPO_NAME}" target="_blank">⚙️ GitHub-Repo</a>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-top:0;color:#f1f5f9;">📅 Pipeline-Status</h3>
    <div class="stats">
      <div class="stat"><div class="num" id="stat-stocks">70</div><div class="lbl">Stocks Watchlist</div></div>
      <div class="stat"><div class="num" id="stat-methods">23</div><div class="lbl">Aktive Methoden</div></div>
      <div class="stat"><div class="num" id="stat-runs">—</div><div class="lbl">Total Runs</div></div>
      <div class="stat"><div class="num" id="stat-last">—</div><div class="lbl">Letzter Run</div></div>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-top:0;color:#f1f5f9;">⚙️ Setup</h3>
    <p style="color:#cbd5e1;font-size:13px;line-height:1.5;">
      Discover-Button braucht einen GitHub Personal Access Token (PAT) mit <code style="background:#0f172a;padding:2px 6px;border-radius:3px;color:#a78bfa;font-size:11px;">repo</code> + <code style="background:#0f172a;padding:2px 6px;border-radius:3px;color:#a78bfa;font-size:11px;">workflow</code> Scope.
      Wird einmalig im Browser-LocalStorage gespeichert (nicht in der HTML-Datei selbst).
      <a href="#" id="reset-pat" style="color:#94a3b8;font-size:11px;margin-left:8px;">PAT zurücksetzen</a>
    </p>
  </div>
</div>

<div class="pat-modal" id="pat-modal">
  <div class="pat-content">
    <h3>🔑 GitHub Personal Access Token</h3>
    <p>Einmalig nötig zum Triggern des Workflows. Wird in deinem Browser gespeichert (LocalStorage), nicht in der Datei.</p>
    <p><strong>Scopes:</strong> <code>repo</code> + <code>workflow</code> (für Action-Trigger).</p>
    <p>Token erstellen: <a href="https://github.com/settings/tokens/new" target="_blank" style="color:#60a5fa;">github.com/settings/tokens/new</a></p>
    <input type="password" id="pat-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx">
    <button id="pat-save">Speichern + Discover starten</button>
    <button class="cancel" id="pat-cancel">Abbrechen</button>
  </div>
</div>

<div class="footer">Last build: ${new Date().toISOString().slice(0, 16)} UTC · Repo: ${REPO_OWNER}/${REPO_NAME}</div>

<script>
const REPO = '${REPO_OWNER}/${REPO_NAME}';
const WORKFLOW = '${WORKFLOW}';
const PAT_KEY = 'screener-pat';

const btn = document.getElementById('discover-btn');
const statusEl = document.getElementById('status');
const patModal = document.getElementById('pat-modal');
const patInput = document.getElementById('pat-input');

function setStatus(text, type) {
  statusEl.className = 'status active ' + (type || 'info');
  statusEl.innerHTML = text;
}

function getPat() { return localStorage.getItem(PAT_KEY); }
function setPat(v) { localStorage.setItem(PAT_KEY, v); }
function clearPat() { localStorage.removeItem(PAT_KEY); }

document.getElementById('reset-pat').addEventListener('click', (e) => {
  e.preventDefault();
  clearPat();
  alert('PAT wurde gelöscht.');
});

document.getElementById('pat-cancel').addEventListener('click', () => {
  patModal.classList.remove('open');
});

document.getElementById('pat-save').addEventListener('click', () => {
  const v = patInput.value.trim();
  if (!v.startsWith('ghp_')) { alert('PAT muss mit ghp_ beginnen.'); return; }
  setPat(v);
  patModal.classList.remove('open');
  triggerDiscover();
});

btn.addEventListener('click', () => {
  if (!getPat()) {
    patModal.classList.add('open');
    patInput.focus();
    return;
  }
  triggerDiscover();
});

async function triggerDiscover() {
  const pat = getPat();
  if (!pat) { setStatus('Kein PAT.', 'error'); return; }
  btn.disabled = true;
  setStatus('🚀 Workflow wird getriggert... <div class="progress-bar"><div class="fill"></div></div>', 'info');

  try {
    const triggerRes = await fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    });
    if (triggerRes.status === 401) {
      setStatus('❌ PAT ungültig oder abgelaufen. <a href="#" id="reset-link" style="color:#fca5a5;">Neu setzen</a>', 'error');
      document.getElementById('reset-link').addEventListener('click', (e) => { e.preventDefault(); clearPat(); patModal.classList.add('open'); });
      btn.disabled = false;
      return;
    }
    if (!triggerRes.ok) throw new Error('Trigger HTTP ' + triggerRes.status);

    setStatus('⏳ Workflow läuft (~5-7 Min). Wird automatisch geladen wenn fertig... <div class="progress-bar"><div class="fill"></div></div>', 'info');

    // Poll status
    let pollCount = 0;
    const maxPolls = 60;  // 10 min max
    const pollInterval = setInterval(async () => {
      pollCount++;
      try {
        const runsRes = await fetch('https://api.github.com/repos/' + REPO + '/actions/runs?per_page=1', {
          headers: { 'Authorization': 'Bearer ' + pat, 'Accept': 'application/vnd.github+json' }
        });
        const data = await runsRes.json();
        const run = data.workflow_runs && data.workflow_runs[0];
        if (!run) return;

        const min = Math.floor(pollCount * 10 / 60);
        const sec = (pollCount * 10) % 60;
        const elapsed = (min ? min + 'm ' : '') + sec + 's';

        if (run.status === 'completed') {
          clearInterval(pollInterval);
          if (run.conclusion === 'success') {
            setStatus('✅ Run #' + run.run_number + ' erfolgreich (' + elapsed + '). Lade Methods-Report... 🔄', 'success');
            setTimeout(() => { window.location.href = './methods-report.html?refreshed=' + Date.now(); }, 1500);
          } else {
            setStatus('❌ Run #' + run.run_number + ' failed (' + run.conclusion + '). <a href="https://github.com/' + REPO + '/actions/runs/' + run.id + '" target="_blank" style="color:#fca5a5;">Logs ansehen</a>', 'error');
            btn.disabled = false;
          }
        } else {
          setStatus('⏳ Run #' + run.run_number + ' läuft (' + elapsed + ', poll ' + pollCount + '/60)... <div class="progress-bar"><div class="fill"></div></div>', 'info');
        }
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setStatus('⏰ Timeout nach 10 Min. Schau in den <a href="https://github.com/' + REPO + '/actions" target="_blank" style="color:#fcd34d;">Action-Logs</a>.', 'error');
          btn.disabled = false;
        }
      } catch (e) { /* poll error, continue */ }
    }, 10000);
  } catch (e) {
    setStatus('❌ Fehler: ' + e.message, 'error');
    btn.disabled = false;
  }
}

// On page load: fetch run-stats
async function loadStats() {
  const pat = getPat();
  if (!pat) return;
  try {
    const res = await fetch('https://api.github.com/repos/' + REPO + '/actions/runs?per_page=10', {
      headers: { 'Authorization': 'Bearer ' + pat, 'Accept': 'application/vnd.github+json' }
    });
    const data = await res.json();
    if (data.total_count) document.getElementById('stat-runs').textContent = data.total_count;
    const last = data.workflow_runs && data.workflow_runs[0];
    if (last) {
      const d = new Date(last.run_started_at);
      const ago = Math.round((Date.now() - d) / 60000);
      document.getElementById('stat-last').textContent = ago < 60 ? ago + 'm' : Math.round(ago/60) + 'h';
    }
  } catch (e) { /* skip */ }
}
loadStats();
</script>

</body></html>`;

  fs.writeFileSync(outFile, html);
  console.log(`✓ Dashboard generated: ${outFile}`);
}
main();
