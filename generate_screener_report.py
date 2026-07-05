"""
Growth Screener — Top-Ergebnisse Report
Fabless AI/Connectivity Semi v5.2 + System/Application SaaS v1.1
Stand: 2026-06-18
"""

from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, PageBreak
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import cm, mm
from reportlab.platypus.flowables import Flowable

# ── Farben ──────────────────────────────────────────────────────────────────
DARK_NAVY   = colors.HexColor('#0D1B2A')
NAVY        = colors.HexColor('#1B2E44')
STEEL       = colors.HexColor('#2D5A8E')
ICE         = colors.HexColor('#EBF2FA')
GOLD        = colors.HexColor('#C8973A')
GOLD_LIGHT  = colors.HexColor('#F5E9D3')
GRAY_LINE   = colors.HexColor('#D1D9E0')
GRAY_ROW    = colors.HexColor('#F7F9FB')
TEXT        = colors.HexColor('#1A202C')
TEXT_MED    = colors.HexColor('#4A5568')
GREEN       = colors.HexColor('#1E6B45')
RED         = colors.HexColor('#9B2335')
SEMI_COLOR  = colors.HexColor('#1A3C5E')  # Fabless accent
SAAS_COLOR  = colors.HexColor('#2D4D22')  # SaaS accent

# ── Styles ───────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def style(name, parent='Normal', **kw):
    s = ParagraphStyle(name, parent=styles[parent], **kw)
    return s

S_COVER_TITLE = style('CoverTitle', 'Title',
    fontSize=28, textColor=colors.white, leading=34,
    spaceAfter=6, alignment=1)
S_COVER_SUB = style('CoverSub', fontSize=12, textColor=GOLD,
    leading=16, alignment=1, spaceAfter=4)
S_COVER_DATE = style('CoverDate', fontSize=10, textColor=colors.HexColor('#A0AEC0'),
    alignment=1, spaceAfter=0)

S_SECTION_TITLE = style('SectionTitle', 'Heading1',
    fontSize=16, textColor=colors.white, leading=20,
    spaceBefore=0, spaceAfter=0)
S_SECTION_BADGE = style('SectionBadge', fontSize=9, textColor=GOLD,
    leading=11, spaceBefore=0, spaceAfter=0)

S_BOX_HEAD = style('BoxHead', fontSize=10, textColor=TEXT,
    fontName='Helvetica-Bold', leading=13, spaceBefore=4, spaceAfter=2)
S_BOX_BODY = style('BoxBody', fontSize=9, textColor=TEXT_MED,
    leading=13, spaceBefore=0, spaceAfter=2)
S_FORMULA = style('Formula', fontSize=9, textColor=DARK_NAVY,
    fontName='Courier', leading=13, spaceBefore=2, spaceAfter=2,
    leftIndent=8)
S_FOOTNOTE = style('Footnote', fontSize=7.5, textColor=TEXT_MED,
    leading=10, spaceAfter=0)

S_TABLE_HEADER = style('TableHeader', fontSize=8.5, textColor=colors.white,
    fontName='Helvetica-Bold', leading=11, alignment=1)
S_TABLE_TICKER = style('TableTicker', fontSize=9, textColor=DARK_NAVY,
    fontName='Helvetica-Bold', leading=12)
S_TABLE_NUM = style('TableNum', fontSize=9, textColor=TEXT, leading=12, alignment=2)

# ── Helper: Colored header block ─────────────────────────────────────────────
class ColorBlock(Flowable):
    """A filled colored rectangle as background."""
    def __init__(self, w, h, color):
        super().__init__()
        self.width = w; self.height = h; self._color = color
    def draw(self):
        self.canv.setFillColor(self._color)
        self.canv.rect(0, 0, self.width, self.height, fill=1, stroke=0)

def section_header(doc_width, color, label, title, universe_str):
    """Returns a KeepTogether block: colored banner + badge + title."""
    tbl_data = [[
        Paragraph(f'<font size="8" color="{GOLD.hexval()}"><b>{label}</b></font>', S_SECTION_BADGE),
        ''
    ], [
        Paragraph(title, S_SECTION_TITLE),
        Paragraph(universe_str, style('UnivStr', fontSize=9, textColor=GOLD, alignment=2))
    ]]
    tbl = Table(tbl_data, colWidths=[doc_width * 0.7, doc_width * 0.3])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), color),
        ('TOPPADDING',    (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING',   (0, 0), (-1, -1), 14),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 12),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('SPAN', (0, 0), (0, 0)),
    ]))
    return KeepTogether([tbl])

def formula_box(doc_width, lines):
    """Gray info box with formula lines."""
    content = [Paragraph(l, S_BOX_BODY if not l.startswith('  ') else S_FORMULA) for l in lines]
    tbl = Table([[content]], colWidths=[doc_width])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), ICE),
        ('TOPPADDING',    (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING',   (0, 0), (-1, -1), 14),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 14),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY_LINE),
        ('LINEABOVE', (0, 0), (-1, 0), 3, STEEL),
    ]))
    return tbl

def score_bar_cell(score, max_score=100):
    """Return a tiny score-bar string (block chars) for visual flair."""
    filled = int(score / max_score * 10)
    bar = '█' * filled + '░' * (10 - filled)
    return bar

def make_fabless_table(members, doc_width):
    """Build the Fabless ranking table."""
    COL_W = [0.7*cm, 2.2*cm, 5.5*cm, 2.0*cm, 1.8*cm, 1.8*cm, 1.8*cm, 1.8*cm]
    header = ['#', 'Ticker', 'Score-Balken', 'Score', 'Umsatz-Wachstum', 'GM', 'Durability', 'Accel.']

    def hdr(t): return Paragraph(t, S_TABLE_HEADER)
    rows = [[hdr(h) for h in header]]

    for i, m in enumerate(members):
        rank = i + 1
        score = m['score']
        bar = score_bar_cell(score)
        dur = m.get('durability', 0)
        dur_color = '#1E6B45' if dur > 0 else '#9B2335'
        accel = m.get('accel', 0) * 100
        accel_color = '#1E6B45' if accel > 0 else '#9B2335'

        row_bg = GRAY_ROW if rank % 2 == 0 else colors.white
        rows.append([
            Paragraph(f'<b>{rank}</b>', style('RN', fontSize=9, textColor=TEXT_MED, alignment=1)),
            Paragraph(f'<b>{m["ticker"]}</b>', S_TABLE_TICKER),
            Paragraph(f'<font face="Courier" size="8" color="#2D5A8E">{bar}</font>',
                      style('Bar', fontSize=8, fontName='Courier', leading=11)),
            Paragraph(f'<b>{score}</b>', style('Sc', fontSize=10, fontName='Helvetica-Bold',
                                                textColor=DARK_NAVY, alignment=1, leading=13)),
            Paragraph(f'{m["growth"]*100:.1f}%',
                      style('Num', fontSize=9, alignment=2, leading=12,
                            textColor=colors.HexColor('#1E6B45') if m['growth'] > 0.5 else TEXT)),
            Paragraph(f'{m["gm"]*100:.1f}%',
                      style('Num2', fontSize=9, alignment=2, leading=12, textColor=TEXT)),
            Paragraph(f'<font color="{dur_color}">{dur:+.2f}</font>',
                      style('Dur', fontSize=9, alignment=2, leading=12)),
            Paragraph(f'<font color="{accel_color}">{accel:+.1f}%</font>',
                      style('Acc', fontSize=9, alignment=2, leading=12)),
        ])

    tbl = Table(rows, colWidths=COL_W, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), SEMI_COLOR),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, GRAY_ROW]),
        ('LINEBELOW', (0, 0), (-1, 0), 1.5, STEEL),
        ('LINEBELOW', (0, 1), (-1, -1), 0.3, GRAY_LINE),
        ('TOPPADDING',    (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]
    tbl.setStyle(TableStyle(style_cmds))
    return tbl

def make_saas_table(members, doc_width):
    """Build the SaaS top-20 ranking table."""
    COL_W = [0.7*cm, 2.2*cm, 4.8*cm, 2.0*cm, 2.0*cm, 1.8*cm, 1.8*cm, 2.4*cm]
    header = ['#', 'Ticker', 'Score-Balken', 'Score', 'Umsatz-Wachstum', 'A2-Forward', 'GM', 'Stage']

    def hdr(t): return Paragraph(t, S_TABLE_HEADER)
    rows = [[hdr(h) for h in header]]

    stage_short = {
        'S3-Cash-Compounder': 'Cash-Comp.',
        'S2-FCF-positiv':     'FCF+',
        'S1-Approaching':     'Approach.',
        'S0-Pre-FCF':         'Pre-FCF',
    }

    for i, m in enumerate(members[:20]):
        rank = i + 1
        score = m['score']
        bar = score_bar_cell(score)
        a2 = m.get('_a2', 0) or 0
        a2_color = '#1E6B45' if a2 > 0.1 else ('#9B2335' if a2 < -0.1 else '#666')
        stage_raw = m.get('stage', '')
        stage_disp = stage_short.get(stage_raw, stage_raw)

        rows.append([
            Paragraph(f'<b>{rank}</b>', style('RN2', fontSize=9, textColor=TEXT_MED, alignment=1)),
            Paragraph(f'<b>{m["ticker"]}</b>', S_TABLE_TICKER),
            Paragraph(f'<font face="Courier" size="8" color="#2D4D22">{bar}</font>',
                      style('Bar2', fontSize=8, fontName='Courier', leading=11)),
            Paragraph(f'<b>{score}</b>', style('Sc2', fontSize=10, fontName='Helvetica-Bold',
                                                textColor=DARK_NAVY, alignment=1, leading=13)),
            Paragraph(f'{m["growth"]*100:.1f}%',
                      style('Num3', fontSize=9, alignment=2, leading=12,
                            textColor=colors.HexColor('#1E6B45') if m['growth'] > 0.35 else TEXT)),
            Paragraph(f'<font color="{a2_color}">{a2:+.2f}</font>',
                      style('A2', fontSize=9, alignment=2, leading=12)),
            Paragraph(f'{m["gm"]*100:.1f}%',
                      style('GM', fontSize=9, alignment=2, leading=12, textColor=TEXT)),
            Paragraph(f'<font size="8" color="#4A5568">{stage_disp}</font>',
                      style('Stg', fontSize=8, leading=11, textColor=TEXT_MED)),
        ])

    tbl = Table(rows, colWidths=COL_W, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), SAAS_COLOR),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, GRAY_ROW]),
        ('LINEBELOW', (0, 0), (-1, 0), 1.5, colors.HexColor('#1A3C1A')),
        ('LINEBELOW', (0, 1), (-1, -1), 0.3, GRAY_LINE),
        ('TOPPADDING',    (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]
    tbl.setStyle(TableStyle(style_cmds))
    return tbl

# ── Main ─────────────────────────────────────────────────────────────────────
import json, os

OUTPUT = r"C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data\screener-report-2026-06-18.pdf"
DATA   = r"C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data\outputs\court-results.json"

with open(DATA, encoding='utf-8') as f:
    results = json.load(f)

fabless = results['fabless_semi']['members']
saas    = results['system_app_software']['members']

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=1.8*cm, rightMargin=1.8*cm,
    topMargin=1.5*cm, bottomMargin=1.8*cm,
)
W = doc.width
story = []

# ── Cover ────────────────────────────────────────────────────────────────────
cover_data = [[
    Paragraph('Growth Screener', S_COVER_TITLE),
], [
    Paragraph('Fabless AI/Connectivity Semis v5.2  ·  System &amp; Application SaaS v1.1', S_COVER_SUB),
], [
    Paragraph('Top-Ergebnisse  ·  Stand 18. Juni 2026', S_COVER_DATE),
]]
cover_tbl = Table(cover_data, colWidths=[W])
cover_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), DARK_NAVY),
    ('TOPPADDING',    (0, 0), (-1, -1), 18),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 18),
    ('LEFTPADDING',   (0, 0), (-1, -1), 20),
    ('RIGHTPADDING',  (0, 0), (-1, -1), 20),
    ('LINEABOVE', (0, 0), (-1, 0), 4, GOLD),
    ('LINEBELOW', (0, -1), (-1, -1), 1, GRAY_LINE),
]))
story.append(cover_tbl)
story.append(Spacer(1, 14))

# ── Disclaimer ───────────────────────────────────────────────────────────────
story.append(Paragraph(
    '<b>Zweck:</b> Dieser Report ist ein Qualitätsfilter für Chart-Analyse-Aufmerksamkeit, '
    'kein Kauf-Signal. Timing bleibt 100% beim Menschen am Chart. '
    'Status: verified-DESIGN, noch nicht verified-by-forward-fitness (28d-Gate: ~14. Juli 2026).',
    S_FOOTNOTE))
story.append(Spacer(1, 18))

# ════════════════════════════════════════════════════════════════════════════
# ABSCHNITT 1 — FABLESS SEMI v5.2
# ════════════════════════════════════════════════════════════════════════════
story.append(section_header(W, SEMI_COLOR,
    'FORMEL 1  ·  HALBLEITER',
    'Fabless AI/Connectivity Semis  v5.2',
    f'{len(fabless)} Member im Universum'))
story.append(Spacer(1, 10))

# Formel-Erläuterung
story.append(formula_box(W, [
    '<b>Formel-Idee:</b> Qualitätsfilter für fabless AI/Connectivity-Chips (keine IDMs, keine reinen Memory). '
    'Vier gleichgewichtete Achsen, normiert via tanh-z-Score auf den Cohort-Median.',
    '',
    '<b>Vier Achsen (je 25 % Gewicht):</b>',
    '  Growth   — Umsatz-Wachstum YoY (primär: Quartals-SEC-XBRL, Fallback: Annual)',
    '  GM       — Bruttomarge (level, analog der Pricing-Power)',
    '  Accel    — Wachstums-Beschleunigung (Delta-Growth QoQ)',
    '  Durability — recency-gewichtete Downside-Drawdown-Ratio (W=12 Quartale, rho=0.9)',
    '',
    '<b>Score</b> = max(0, 100 · Sigma w_i · (s_i + 1) / 2)    |    s_i = tanh(z/k),  k_Dur=1.0',
    '<b>Durability v3:</b>  durRaw = (med - lambda·dd) / (|med| + floor),  lambda=1.0, floor=0.10',
    '<b>Collapse-Guard:</b> wenn rho_dom > 0.90, Durability-Gewicht automatisch reduziert.',
    '',
    '<b>Datenquelle:</b> Yahoo Finance Fundamentals + SEC-XBRL EDGAR companyfacts.zip  '
    '(kein Paid-Data). Court of Claude PASS 5/5 (Iteration 10).',
]))
story.append(Spacer(1, 10))

story.append(make_fabless_table(fabless, W))
story.append(Spacer(1, 8))

# Lesehilfe Fabless
story.append(Paragraph(
    '<b>Spalten:</b> Score = 0-100 Gesamt-Score. '
    'Durability: positiv = stabile Wachstumskurve; negativ = erhebliche Einbrüche in der Quartals-History. '
    'Accel.: positiv = Wachstum beschleunigt sich. '
    '<b>Farben:</b> Grün = stark, Rot = schwach im Cohort-Vergleich.',
    S_FOOTNOTE))

story.append(Spacer(1, 24))
story.append(HRFlowable(width=W, thickness=0.5, color=GRAY_LINE))
story.append(Spacer(1, 18))

# ════════════════════════════════════════════════════════════════════════════
# ABSCHNITT 2 — SAAS v1.1
# ════════════════════════════════════════════════════════════════════════════
story.append(section_header(W, SAAS_COLOR,
    'FORMEL 2  ·  SOFTWARE / SaaS',
    'System &amp; Application SaaS  v1.1',
    f'Top 20 von {len(saas)} Member'))
story.append(Spacer(1, 10))

story.append(formula_box(W, [
    '<b>Formel-Idee:</b> Qualitätsfilter für Enterprise-/Consumer-SaaS. Kernfrage: Wächst das '
    'Forward-Book organisch? Löst die Flat-Book-Anker-Inversion (GEN-Case). Fünf Achsen.',
    '',
    '<b>Fünf Achsen (Gewichte v1.1):</b>',
    '  A1 Growth   (w=0.429) — Umsatz-Wachstum YoY',
    '  A2 Forward  (w=0.350) — RPO/Deferred-Revenue-Wachstum (SEC-XBRL, 43/44 Coverage)',
    '  A3 GM       (w=0.072) — Bruttomarge',
    '  A3 OpMargin (w=0.072) — Operative Marge',
    '  A4 ROIC-WACC(w=0.078) — ROIC minus WACC (Kapitaleffizienz)',
    '',
    '<b>Score</b> = max(0, 100 · Sigma w_i · (s_i+1)/2 - pDil - pAuth)',
    '<b>A2-Forward:</b>  sA2 = cg·0.65·tanh(rpoGrowthYoY-z/2.5) + cl·0.35·tanh(rpoToRev-z/2.5)',
    '  Base-Credibility: cg=0 bei RPO-Basis &lt;50M; cg=1 ab 300M (kein Cliff, stetig).',
    '',
    '<b>Stages:</b> S3 Cash-Compounder | S2 FCF-positiv | S1 Approaching | S0 Pre-FCF',
    '<b>Datenquelle:</b> Yahoo Finance + SEC-XBRL RPO/Deferred-Rev. Court of Claude PASS 5/5.',
]))
story.append(Spacer(1, 10))

story.append(make_saas_table(saas, W))
story.append(Spacer(1, 8))

# Lesehilfe SaaS
story.append(Paragraph(
    '<b>Spalten:</b> Score = 0-100 Gesamt-Score. '
    'A2-Forward: positiv = wachsendes Forward-Book (RPO/Deferred-Rev.), '
    'negativ = schrumpfendes oder inorganisches Buch. '
    'Stage: S3=bestes Profil (Cash-Compounder). '
    '<b>Achtung:</b> A2-Formel wurde am 2026-06-16 aktiviert (vorher 0%-Coverage). '
    'Forward-Fitness-Gate erst ab ~14. Juli 2026 (28d) messbar.',
    S_FOOTNOTE))

story.append(Spacer(1, 24))
story.append(HRFlowable(width=W, thickness=0.5, color=GRAY_LINE))
story.append(Spacer(1, 8))

# ── Footer ────────────────────────────────────────────────────────────────────
story.append(Paragraph(
    'Generiert: 2026-06-18  ·  Code: screener-data/court-score.js (branch loop/formel-haertung)  ·  '
    'Vault: Jarvis/Knowledge/Trading/growth-screener/screener-formel-ledger.md  ·  '
    'Kein Paid-Data (Yahoo Finance / SEC EDGAR XBRL only).  ·  '
    'KEIN Kauf-Signal — ausschliesslich Fundamental-Qualitaetsfilter.',
    S_FOOTNOTE))

doc.build(story)
print(f"PDF erstellt: {OUTPUT}")
