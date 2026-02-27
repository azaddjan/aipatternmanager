"""
Health Analysis HTML Export Service.
Generates a self-contained HTML file with inline dark-theme CSS for a single health analysis.
"""
import html
import re
from datetime import datetime


# The 9 analysis areas produced by the AI deep analysis prompt
ANALYSIS_AREAS = [
    ("architecture_coherence", "Architecture Coherence"),
    ("abb_sbb_alignment", "ABB\u2013SBB Alignment"),
    ("interface_consistency", "Interface Consistency"),
    ("business_capability_gaps", "Business Capability Gaps"),
    ("vendor_technology_risk", "Vendor & Technology Risk"),
    ("content_quality", "Content Quality"),
    ("cross_pattern_overlap", "Cross-Pattern Overlap"),
    ("pbc_composition", "PBC Composition"),
]

# Keys that contain recommendation-like lists
_RECOMMENDATION_KEYS = {"recommendations", "consolidation_suggestions"}


class HealthAnalysisHtmlExportService:
    """Generates a self-contained HTML health analysis file with inline dark-theme CSS."""

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def generate_html(self, analysis: dict) -> str:
        """Return a complete HTML document string for the given health analysis dict."""
        analysis_json = analysis.get("analysis_json", {})
        raw_text = analysis_json.get("raw_text") if isinstance(analysis_json, dict) else None

        parts = [
            self._html_head(analysis),
            "<body>",
            '<div class="container">',
            self._header(analysis),
        ]

        if raw_text:
            parts.append(self._raw_text_section(raw_text))
        else:
            parts.append(self._overview_section(analysis_json))
            parts.append(self._score_cards_section(analysis_json))
            parts.append(self._detailed_assessments_section(analysis_json))
            parts.append(self._maturity_roadmap_section(analysis_json))

        parts.extend([
            self._footer(analysis),
            "</div>",
            "</body></html>",
        ])
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # <head> with inline CSS
    # ------------------------------------------------------------------

    def _html_head(self, analysis: dict) -> str:
        title = self._escape(analysis.get("title", "Health Analysis"))
        return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
:root {{
    --bg: #1a1a2e;
    --bg-card: #16213e;
    --bg-card-hover: #1a2744;
    --border: #2a3a5c;
    --text: #e0e6ed;
    --text-muted: #8892a4;
    --text-heading: #f0f4f8;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --orange: #e8873a;
    --red: #f85149;
    --purple: #bc8cff;
    --cyan: #39d2c0;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
}}
.container {{
    max-width: 960px;
    margin: 0 auto;
    padding: 40px 32px 64px;
}}

/* ---- Header ---- */
.report-header {{
    margin-bottom: 40px;
    padding-bottom: 32px;
    border-bottom: 1px solid var(--border);
}}
.header-top {{
    display: flex;
    align-items: flex-start;
    gap: 28px;
    flex-wrap: wrap;
}}
.header-info {{
    flex: 1 1 auto;
    min-width: 0;
}}
.header-info .top-row {{
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
}}
.header-info h1 {{
    font-size: 24px;
    color: var(--text-heading);
    font-weight: 700;
    letter-spacing: -0.4px;
    flex: 1 1 auto;
    min-width: 0;
}}
.badge {{
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 12px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
}}
.badge-id {{
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent);
    font-family: 'SF Mono', Menlo, monospace;
}}
.meta-row {{
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 10px;
}}
.meta-row .sep {{ color: var(--border); }}

/* ---- Health Score Ring ---- */
.score-ring {{
    flex-shrink: 0;
    width: 130px;
    height: 130px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}}
.score-ring svg {{
    width: 130px;
    height: 130px;
    transform: rotate(-90deg);
}}
.score-ring .track {{
    fill: none;
    stroke: var(--border);
    stroke-width: 8;
}}
.score-ring .fill {{
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.6s ease;
}}
.score-ring .score-value {{
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
}}
.score-ring .score-number {{
    font-size: 36px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -1px;
}}
.score-ring .score-label {{
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
}}
.score-green  {{ color: var(--green); }}
.score-yellow {{ color: var(--yellow); }}
.score-red    {{ color: var(--red); }}
.stroke-green  {{ stroke: var(--green); }}
.stroke-yellow {{ stroke: var(--yellow); }}
.stroke-red    {{ stroke: var(--red); }}

/* ---- Score Breakdown Bars ---- */
.breakdown-bars {{
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 20px;
}}
.breakdown-item {{
    flex: 1 1 140px;
    min-width: 120px;
}}
.breakdown-item .bar-label {{
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
    text-transform: capitalize;
}}
.breakdown-item .bar-label .bar-value {{
    font-weight: 600;
    color: var(--text);
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 11px;
}}
.bar-track {{
    width: 100%;
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
}}
.bar-fill {{
    height: 100%;
    border-radius: 3px;
    transition: width 0.4s ease;
}}
.bar-fill-green  {{ background: var(--green); }}
.bar-fill-yellow {{ background: var(--yellow); }}
.bar-fill-red    {{ background: var(--red); }}

/* ---- Sections ---- */
.section {{
    margin-bottom: 36px;
}}
.section-title {{
    font-size: 18px;
    color: var(--text-heading);
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
}}
.rendered-text {{
    font-size: 14px;
    color: var(--text);
    line-height: 1.7;
}}
.rendered-text p {{
    margin-bottom: 10px;
}}
.rendered-text ul {{
    margin: 8px 0 12px 22px;
}}
.rendered-text li {{
    margin-bottom: 5px;
    line-height: 1.55;
}}
.rendered-text strong {{
    color: var(--text-heading);
}}

/* ---- Score Cards Grid ---- */
.score-cards {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
}}
.score-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
    transition: border-color 0.2s, background 0.2s;
}}
.score-card:hover {{
    background: var(--bg-card-hover);
    border-color: #3a4a6c;
}}
.score-card .card-title {{
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 10px;
}}
.score-card .card-badge {{
    display: inline-block;
    font-size: 13px;
    font-weight: 800;
    padding: 4px 14px;
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}}
.badge-good {{
    background: rgba(63, 185, 80, 0.15);
    color: var(--green);
}}
.badge-fair {{
    background: rgba(210, 153, 34, 0.15);
    color: var(--yellow);
}}
.badge-poor {{
    background: rgba(248, 81, 73, 0.15);
    color: var(--red);
}}

/* ---- Detail Assessment Cards ---- */
.assessment-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 22px 24px;
    margin-bottom: 16px;
}}
.assessment-card .card-header {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
}}
.assessment-card .card-header h3 {{
    font-size: 16px;
    font-weight: 600;
    color: var(--text-heading);
}}
.findings-list, .recommendations-list {{
    margin: 0 0 0 18px;
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
}}
.findings-list li {{
    color: var(--orange);
    margin-bottom: 4px;
}}
.findings-list li span {{
    color: var(--text);
}}
.recommendations-list li {{
    color: var(--cyan);
    margin-bottom: 4px;
}}
.recommendations-list li span {{
    color: var(--text);
}}
.detail-label {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 12px 0 6px;
}}
.detail-label-findings {{ color: var(--orange); }}
.detail-label-recommendations {{ color: var(--cyan); }}
.finding-sublabel {{
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
    margin: 8px 0 4px;
}}

/* ---- Maturity ---- */
.maturity-badge {{
    display: inline-block;
    font-size: 16px;
    font-weight: 800;
    padding: 6px 18px;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 16px;
}}
.maturity-managed, .maturity-optimizing {{
    background: rgba(63, 185, 80, 0.15);
    color: var(--green);
}}
.maturity-defined, .maturity-developing {{
    background: rgba(210, 153, 34, 0.15);
    color: var(--yellow);
}}
.maturity-initial {{
    background: rgba(248, 81, 73, 0.15);
    color: var(--red);
}}

/* ---- Tables ---- */
.table-wrapper {{
    overflow-x: auto;
    margin: 12px 0 16px;
}}
table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}}
th {{
    background: var(--bg-card);
    text-align: left;
    padding: 10px 14px;
    border: 1px solid var(--border);
    color: var(--text-heading);
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
}}
td {{
    padding: 10px 14px;
    border: 1px solid var(--border);
    color: var(--text);
    vertical-align: top;
}}
tr:hover td {{
    background: var(--bg-card-hover);
}}

/* ---- Recommendations / Actions ---- */
.rec-list {{
    list-style: none;
    margin: 0;
    padding: 0;
}}
.rec-item {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 12px;
    display: flex;
    gap: 16px;
    align-items: flex-start;
    transition: border-color 0.2s, background 0.2s;
}}
.rec-item:hover {{
    background: var(--bg-card-hover);
    border-color: #3a4a6c;
}}
.rec-number {{
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent);
    font-weight: 800;
    font-size: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
}}
.rec-body {{
    flex: 1 1 auto;
    min-width: 0;
}}
.rec-title {{
    font-size: 15px;
    font-weight: 600;
    color: var(--text-heading);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}}
.rec-desc {{
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.55;
}}
.badge-impact-high, .badge-effort-high {{
    background: rgba(248, 81, 73, 0.12);
    color: var(--red);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 12px;
}}
.badge-impact-medium, .badge-effort-medium {{
    background: rgba(210, 153, 34, 0.12);
    color: var(--yellow);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 12px;
}}
.badge-impact-low, .badge-effort-low {{
    background: rgba(63, 185, 80, 0.12);
    color: var(--green);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 12px;
}}

/* ---- Raw text fallback ---- */
.raw-text-block {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 24px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 13px;
    color: var(--text);
    line-height: 1.65;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-x: auto;
}}

/* ---- Footer ---- */
.report-footer {{
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
}}

/* ---- Misc ---- */
code {{
    background: var(--bg-card);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.9em;
    font-family: 'SF Mono', Menlo, monospace;
}}
.empty-note {{
    font-size: 13px;
    color: var(--text-muted);
    font-style: italic;
    padding: 8px 0;
}}

@media (max-width: 640px) {{
    .container {{ padding: 20px 16px 40px; }}
    .header-top {{ flex-direction: column; align-items: center; text-align: center; }}
    .score-cards {{ grid-template-columns: 1fr 1fr; }}
    .header-info h1 {{ font-size: 20px; }}
    .rec-item {{ flex-direction: column; align-items: center; text-align: center; }}
    .breakdown-bars {{ flex-direction: column; }}
}}
</style>
</head>'''

    # ------------------------------------------------------------------
    # Header with score ring + breakdown bars
    # ------------------------------------------------------------------

    def _header(self, analysis: dict) -> str:
        title = self._escape(analysis.get("title", "Health Analysis"))
        analysis_id = self._escape(analysis.get("id", ""))
        health_score = analysis.get("health_score", 0)
        if health_score is None:
            health_score = 0
        score_breakdown = analysis.get("score_breakdown_json", {}) or {}
        provider = self._escape(analysis.get("provider", ""))
        model = self._escape(analysis.get("model", ""))
        pattern_count = analysis.get("pattern_count", 0)
        created_at = analysis.get("created_at", "")
        date_display = self._format_date(created_at)

        # Score color
        score_color_class = self._score_color_class(health_score)
        stroke_class = self._score_stroke_class(health_score)

        # SVG ring calculation (radius 52, circumference = 2*pi*52 ~ 326.73)
        circumference = 326.73
        score_clamped = max(0, min(100, health_score))
        dash_offset = circumference - (circumference * score_clamped / 100)

        parts = ['<div class="report-header">']
        parts.append('<div class="header-top">')

        # Left: info
        parts.append('<div class="header-info">')
        parts.append('<div class="top-row">')
        parts.append(f'<h1>{title}</h1>')
        if analysis_id:
            parts.append(f'<span class="badge badge-id">{analysis_id}</span>')
        parts.append('</div>')

        # Meta row
        meta_items = []
        if date_display:
            meta_items.append(date_display)
        if provider:
            provider_display = provider
            if model:
                provider_display += f" / {model}"
            meta_items.append(provider_display)
        if pattern_count:
            meta_items.append(f"{pattern_count} patterns analyzed")

        if meta_items:
            parts.append('<div class="meta-row">')
            parts.append(
                ('<span class="sep">&middot;</span>').join(
                    f"<span>{item}</span>" for item in meta_items
                )
            )
            parts.append('</div>')

        parts.append('</div>')  # .header-info

        # Right: score ring
        parts.append('<div class="score-ring">')
        parts.append(
            f'<svg viewBox="0 0 120 120">'
            f'<circle class="track" cx="60" cy="60" r="52"/>'
            f'<circle class="fill {stroke_class}" cx="60" cy="60" r="52" '
            f'stroke-dasharray="{circumference}" stroke-dashoffset="{dash_offset:.2f}"/>'
            f'</svg>'
        )
        parts.append(
            f'<div class="score-value">'
            f'<div class="score-number {score_color_class}">{health_score:.1f}</div>'
            f'<div class="score-label">Health</div>'
            f'</div>'
        )
        parts.append('</div>')  # .score-ring

        parts.append('</div>')  # .header-top

        # Score breakdown bars
        if score_breakdown:
            parts.append('<div class="breakdown-bars">')
            for key, value in score_breakdown.items():
                if value is None:
                    value = 0
                bar_color = self._bar_fill_class(value)
                width_pct = max(0, min(100, value))
                display_name = self._escape(key.replace("_", " "))
                parts.append(
                    f'<div class="breakdown-item">'
                    f'<div class="bar-label"><span>{display_name}</span>'
                    f'<span class="bar-value">{value:.1f}</span></div>'
                    f'<div class="bar-track"><div class="bar-fill {bar_color}" '
                    f'style="width:{width_pct:.1f}%"></div></div>'
                    f'</div>'
                )
            parts.append('</div>')

        parts.append('</div>')  # .report-header
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Raw text fallback
    # ------------------------------------------------------------------

    def _raw_text_section(self, raw_text: str) -> str:
        parts = [
            '<div class="section">',
            '<h2 class="section-title">Analysis Output</h2>',
            '<p class="empty-note">JSON parsing failed for this analysis. '
            'Displaying raw AI output below.</p>',
            f'<pre class="raw-text-block">{self._escape(raw_text)}</pre>',
            '</div>',
        ]
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Executive Summary / Overview
    # ------------------------------------------------------------------

    def _overview_section(self, analysis_json: dict) -> str:
        summary = analysis_json.get("executive_summary", "") or analysis_json.get("overview", "")
        if not summary:
            return ""
        parts = [
            '<div class="section">',
            '<h2 class="section-title">Executive Summary</h2>',
            f'<div class="rendered-text">{self._render_text(summary)}</div>',
            '</div>',
        ]
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Assessment Score Cards (grid of 8 areas)
    # ------------------------------------------------------------------

    def _score_cards_section(self, analysis_json: dict) -> str:
        has_any = any(analysis_json.get(key) for key, _ in ANALYSIS_AREAS)
        if not has_any:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">Assessment Ratings</h2>',
            '<div class="score-cards">',
        ]

        for key, label in ANALYSIS_AREAS:
            section_data = analysis_json.get(key, {}) or {}
            rating = (section_data.get("rating") or "N/A").upper()
            badge_cls = self._rating_badge_class(rating)
            parts.append(
                f'<div class="score-card">'
                f'<div class="card-title">{self._escape(label)}</div>'
                f'<span class="card-badge {badge_cls}">{self._escape(rating)}</span>'
                f'</div>'
            )

        parts.append('</div>')
        parts.append('</div>')
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Detailed Assessment Sections (9 areas)
    # ------------------------------------------------------------------

    def _detailed_assessments_section(self, analysis_json: dict) -> str:
        rendered_sections = []
        for key, label in ANALYSIS_AREAS:
            section_html = self._single_assessment(analysis_json.get(key, {}), label)
            if section_html:
                rendered_sections.append(section_html)

        if not rendered_sections:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">Detailed Assessments</h2>',
        ]
        parts.extend(rendered_sections)
        parts.append('</div>')
        return "\n".join(parts)

    def _single_assessment(self, section_data: dict, label: str) -> str:
        if not section_data:
            return ""

        rating = (section_data.get("rating") or "N/A").upper()
        badge_cls = self._rating_badge_class(rating)

        parts = ['<div class="assessment-card">']

        # Card header
        parts.append('<div class="card-header">')
        parts.append(f'<h3>{self._escape(label)}</h3>')
        parts.append(f'<span class="card-badge {badge_cls}">{self._escape(rating)}</span>')
        parts.append('</div>')

        # Findings — all list fields except recommendations
        has_findings = False
        for fkey, fval in section_data.items():
            if fkey in ("rating",) or fkey in _RECOMMENDATION_KEYS:
                continue
            if isinstance(fval, list) and fval:
                if not has_findings:
                    parts.append('<div class="detail-label detail-label-findings">Findings</div>')
                    has_findings = True

                sublabel = fkey.replace("_", " ").title()
                parts.append(f'<div class="finding-sublabel">{self._escape(sublabel)}</div>')
                parts.append('<ul class="findings-list">')
                for item in fval:
                    if isinstance(item, dict):
                        item_parts = []
                        for dk, dv in item.items():
                            if isinstance(dv, list):
                                item_parts.append(f"<strong>{self._escape(dk)}</strong>: {self._escape(', '.join(str(x) for x in dv))}")
                            else:
                                item_parts.append(f"<strong>{self._escape(dk)}</strong>: {self._escape(str(dv))}")
                        parts.append(f'<li><span>{" &middot; ".join(item_parts)}</span></li>')
                    else:
                        parts.append(f'<li><span>{self._escape(str(item))}</span></li>')
                parts.append('</ul>')

        # Recommendations
        recs = section_data.get("recommendations", []) or section_data.get("consolidation_suggestions", [])
        if isinstance(recs, list) and recs:
            parts.append('<div class="detail-label detail-label-recommendations">Recommendations</div>')
            parts.append('<ul class="recommendations-list">')
            for rec in recs:
                parts.append(f'<li><span>{self._escape(str(rec))}</span></li>')
            parts.append('</ul>')

        if not has_findings and not recs:
            parts.append('</div>')
            return ""

        parts.append('</div>')
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Maturity Roadmap Section
    # ------------------------------------------------------------------

    def _maturity_roadmap_section(self, analysis_json: dict) -> str:
        roadmap = analysis_json.get("maturity_roadmap", {})
        if not isinstance(roadmap, dict) or not roadmap:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">Maturity &amp; Roadmap</h2>',
        ]

        # Overall maturity badge
        overall = roadmap.get("overall_maturity", "")
        if overall:
            maturity_cls = self._maturity_badge_class(overall)
            parts.append(f'<span class="maturity-badge {maturity_cls}">{self._escape(overall)}</span>')

        # Area maturity table
        area_maturity = roadmap.get("area_maturity", {})
        if isinstance(area_maturity, dict) and area_maturity:
            parts.append('<div class="table-wrapper">')
            parts.append('<table><thead><tr><th>Area</th><th>Maturity</th></tr></thead><tbody>')
            for area, level in area_maturity.items():
                display_name = self._escape(area.replace("_", " ").title())
                parts.append(f'<tr><td>{display_name}</td><td>{self._escape(str(level))}</td></tr>')
            parts.append('</tbody></table></div>')

        # Prioritized actions
        actions = roadmap.get("prioritized_actions", [])
        if isinstance(actions, list) and actions:
            parts.append('<h3 style="font-size:16px;color:var(--text-heading);margin:20px 0 12px;">Prioritized Actions</h3>')
            parts.append('<ol class="rec-list">')

            for act in actions:
                if not isinstance(act, dict):
                    continue
                priority = act.get("priority", "")
                action_text = self._escape(act.get("action", ""))
                impact = (act.get("impact") or "").upper()
                effort = (act.get("effort") or "").upper()
                affected = act.get("affected_patterns", [])

                parts.append('<li class="rec-item">')
                parts.append(f'<div class="rec-number">{self._escape(str(priority))}</div>')
                parts.append('<div class="rec-body">')

                # Title + badges
                parts.append('<div class="rec-title">')
                parts.append(f'<span>{action_text}</span>')
                if impact:
                    impact_cls = f"badge-impact-{impact.lower()}" if impact in ("HIGH", "MEDIUM", "LOW") else "badge-impact-medium"
                    parts.append(f'<span class="badge {impact_cls}">{self._escape(impact)} impact</span>')
                if effort:
                    effort_cls = f"badge-effort-{effort.lower()}" if effort in ("HIGH", "MEDIUM", "LOW") else "badge-effort-medium"
                    parts.append(f'<span class="badge {effort_cls}">{self._escape(effort)} effort</span>')
                parts.append('</div>')

                # Affected patterns
                if isinstance(affected, list) and affected:
                    parts.append(f'<div class="rec-desc">Affected: {self._escape(", ".join(str(p) for p in affected))}</div>')

                parts.append('</div>')  # .rec-body
                parts.append('</li>')

            parts.append('</ol>')

        parts.append('</div>')
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Footer
    # ------------------------------------------------------------------

    def _footer(self, analysis: dict) -> str:
        provider = self._escape(analysis.get("provider", ""))
        model = self._escape(analysis.get("model", ""))
        pattern_count = analysis.get("pattern_count", 0)
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        parts = [
            '<div class="report-footer">',
            f"Generated {self._escape(now)}",
        ]
        if provider:
            parts.append(f" &middot; Provider: {provider}")
        if model:
            parts.append(f" &middot; Model: {model}")
        if pattern_count:
            parts.append(f" &middot; {pattern_count} patterns")
        parts.append(
            "<br>AI Pattern Manager &mdash; Health Analysis Report</div>"
        )
        return "\n".join(parts)

    # ==================================================================
    # Helpers
    # ==================================================================

    @staticmethod
    def _escape(text) -> str:
        """HTML-escape a value, returning empty string for None."""
        if text is None:
            return ""
        return html.escape(str(text))

    def _render_text(self, text: str) -> str:
        """Convert basic markdown (bold, bullets, numbered lists, line breaks) to HTML."""
        if not text:
            return ""
        escaped = self._escape(text)

        # Convert **bold** to <strong>
        result = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)

        # Convert `code` to <code>
        result = re.sub(r"`([^`]+)`", r"<code>\1</code>", result)

        # Parse lines into paragraphs and lists
        lines = result.split("\n")
        html_parts: list[str] = []
        in_ul = False
        in_ol = False

        for line in lines:
            stripped = line.strip()

            # Unordered list items
            if re.match(r"^[-*]\s+", stripped):
                if in_ol:
                    html_parts.append("</ol>")
                    in_ol = False
                if not in_ul:
                    html_parts.append("<ul>")
                    in_ul = True
                item_text = re.sub(r"^[-*]\s+", "", stripped)
                html_parts.append(f"<li>{item_text}</li>")
                continue

            # Ordered list items
            ol_match = re.match(r"^(\d+)[.)]\s+", stripped)
            if ol_match:
                if in_ul:
                    html_parts.append("</ul>")
                    in_ul = False
                if not in_ol:
                    html_parts.append("<ol>")
                    in_ol = True
                item_text = re.sub(r"^\d+[.)]\s+", "", stripped)
                html_parts.append(f"<li>{item_text}</li>")
                continue

            # Close any open list
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False
            if in_ol:
                html_parts.append("</ol>")
                in_ol = False

            # Headings
            heading_match = re.match(r"^(#{1,4})\s+(.+)$", stripped)
            if heading_match:
                level = len(heading_match.group(1))
                h_level = min(level + 2, 6)
                html_parts.append(f"<h{h_level}>{heading_match.group(2)}</h{h_level}>")
                continue

            # Non-empty line becomes a paragraph
            if stripped:
                html_parts.append(f"<p>{stripped}</p>")

        # Close any dangling lists
        if in_ul:
            html_parts.append("</ul>")
        if in_ol:
            html_parts.append("</ol>")

        return "\n".join(html_parts)

    @staticmethod
    def _score_color_class(score: float) -> str:
        if score >= 80:
            return "score-green"
        if score >= 60:
            return "score-yellow"
        return "score-red"

    @staticmethod
    def _score_stroke_class(score: float) -> str:
        if score >= 80:
            return "stroke-green"
        if score >= 60:
            return "stroke-yellow"
        return "stroke-red"

    @staticmethod
    def _bar_fill_class(value: float) -> str:
        if value >= 70:
            return "bar-fill-green"
        if value >= 40:
            return "bar-fill-yellow"
        return "bar-fill-red"

    @staticmethod
    def _rating_badge_class(rating: str) -> str:
        """Return CSS class for rating badges (maps various rating scales to good/fair/poor)."""
        s = (rating or "").upper()
        if s in ("STRONG", "LOW_RISK", "CLEAN"):
            return "badge-good"
        if s in ("ADEQUATE", "MODERATE_RISK", "SOME_OVERLAP"):
            return "badge-fair"
        if s in ("WEAK", "HIGH_RISK", "SIGNIFICANT_OVERLAP"):
            return "badge-poor"
        return "badge-fair"

    @staticmethod
    def _maturity_badge_class(maturity: str) -> str:
        label = (maturity or "").lower().replace(" ", "-")
        if label in ("managed", "optimizing"):
            return f"maturity-{label}"
        if label in ("defined", "developing"):
            return f"maturity-{label}"
        if label == "initial":
            return "maturity-initial"
        return "maturity-initial"

    @staticmethod
    def _format_date(date_str) -> str:
        if not date_str:
            return ""
        try:
            if isinstance(date_str, datetime):
                return date_str.strftime("%d %b %Y, %H:%M")
            dt = datetime.fromisoformat(str(date_str))
            return dt.strftime("%d %b %Y, %H:%M")
        except (ValueError, TypeError):
            return str(date_str)
