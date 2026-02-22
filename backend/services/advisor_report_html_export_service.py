"""
Advisor Report HTML Export Service.
Generates a self-contained HTML file with inline dark-theme CSS for a single advisor report.
"""
import html
import re
from datetime import datetime


# ---------------------------------------------------------------------------
# Category labels (keep in sync with neo4j_service.BUILTIN_CATEGORIES)
# ---------------------------------------------------------------------------
CATEGORY_LABELS = {
    "blueprint": "Architecture Topology",
    "core": "Core Prompt & LLM",
    "intg": "Integration & Connectivity",
    "agt": "Agents & Autonomy",
    "kr": "Knowledge & Retrieval",
    "xcut": "Cross-Cutting / Governance",
    "pip": "Platform Integration",
}


class AdvisorReportHtmlExportService:
    """Generates a self-contained HTML report file with inline dark-theme CSS."""

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def generate_html(self, report: dict) -> str:
        """Return a complete HTML document string for the given report dict."""
        result = report.get("result_json", {})
        analysis = result.get("analysis", {})
        parts = [
            self._html_head(report),
            "<body>",
            '<div class="container">',
            self._report_header(report, analysis),
            self._summary_section(analysis),
            self._patterns_section(analysis),
            self._comparisons_section(analysis),
            self._architecture_section(analysis),
            self._gaps_section(analysis),
            self._vector_matches_section(result),
            self._reasoning_section(analysis),
            self._footer(report, result),
            "</div>",
            "</body></html>",
        ]
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # <head> with inline CSS
    # ------------------------------------------------------------------

    def _html_head(self, report: dict) -> str:
        title = self._escape(report.get("title", "Advisor Report"))
        return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} &mdash; Advisor Report</title>
<style>
:root {{
    --bg: #0d1117;
    --bg-card: #161b22;
    --bg-card-hover: #1c2129;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-heading: #f0f6fc;
    --accent: #58a6ff;
    --green: #3fb950;
    --orange: #d29922;
    --purple: #bc8cff;
    --red: #f85149;
    --cyan: #39d2c0;
}}
*  {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
}}
.container {{
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 32px 64px;
}}

/* ---- Header ---- */
.report-header {{
    margin-bottom: 40px;
    padding-bottom: 32px;
    border-bottom: 1px solid var(--border);
}}
.report-header .top-row {{
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
}}
.report-header h1 {{
    font-size: 26px;
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
.badge-conf-high   {{ background: rgba(63, 185, 80, 0.15);  color: var(--green); }}
.badge-conf-medium {{ background: rgba(210, 153, 34, 0.15); color: var(--orange); }}
.badge-conf-low    {{ background: rgba(248, 81, 73, 0.15);  color: var(--red); }}
.badge-starred {{
    background: rgba(210, 153, 34, 0.15);
    color: var(--orange);
    font-size: 13px;
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
.problem-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-top: 20px;
}}
.problem-card .label {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 6px;
}}
.problem-card .body {{
    font-size: 14px;
    color: var(--text);
    line-height: 1.65;
}}
.tags-row {{
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
}}
.tag {{
    display: inline-block;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 12px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--bg-card);
}}
.tag-category {{
    border-color: rgba(188, 140, 255, 0.3);
    color: var(--purple);
    background: rgba(188, 140, 255, 0.06);
}}
.tag-tech {{
    border-color: rgba(57, 210, 192, 0.3);
    color: var(--cyan);
    background: rgba(57, 210, 192, 0.06);
}}

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
.section-subtitle {{
    font-size: 15px;
    color: var(--text-heading);
    font-weight: 600;
    margin: 20px 0 10px;
}}
.rendered-text {{
    font-size: 14px;
    color: var(--text);
    line-height: 1.65;
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
.table-themed-purple th {{ background: rgba(188, 140, 255, 0.08); color: var(--purple); }}
.table-themed-blue   th {{ background: rgba(88, 166, 255, 0.08);  color: var(--accent); }}
.table-themed-green  th {{ background: rgba(63, 185, 80, 0.08);   color: var(--green); }}

/* ---- Comparison cards ---- */
.comparison-group {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
}}
.comparison-group .context {{
    font-size: 14px;
    color: var(--text);
    margin-bottom: 12px;
    line-height: 1.6;
}}
.comparison-group .recommendation {{
    font-size: 13px;
    color: var(--green);
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
}}
.comparison-group .recommendation strong {{
    color: var(--green);
}}
.strengths {{ color: var(--green); }}
.weaknesses {{ color: var(--orange); }}

/* ---- Gap cards ---- */
.gap-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
}}
.gap-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
}}
.gap-card .gap-title {{
    font-size: 14px;
    font-weight: 600;
    color: var(--text-heading);
    margin-bottom: 6px;
}}
.gap-card .gap-desc {{
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 8px;
}}
.gap-card .gap-meta {{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}}
.badge-pri-high   {{ background: rgba(248, 81, 73, 0.15);  color: var(--red); }}
.badge-pri-medium {{ background: rgba(210, 153, 34, 0.15); color: var(--orange); }}
.badge-pri-low    {{ background: rgba(63, 185, 80, 0.15);  color: var(--green); }}

/* ---- Vector matches (appendix) ---- */
.vector-table td.score {{
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 12px;
    text-align: right;
    color: var(--cyan);
}}

/* ---- Collapsible ---- */
.collapsible {{
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 16px;
}}
.collapsible-toggle {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: var(--bg-card);
    border: none;
    color: var(--text-heading);
    font-size: 15px;
    font-weight: 600;
    padding: 14px 20px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
}}
.collapsible-toggle:hover {{
    background: var(--bg-card-hover);
}}
.collapsible-toggle::after {{
    content: '\\25BE';
    font-size: 12px;
    color: var(--text-muted);
    transition: transform 0.2s;
}}
.collapsible-toggle.open::after {{
    transform: rotate(180deg);
}}
.collapsible-body {{
    display: none;
    padding: 16px 20px;
    background: var(--bg);
}}
.collapsible-body.open {{
    display: block;
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
.inline-id {{
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 0.92em;
    background: rgba(88, 166, 255, 0.08);
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--accent);
}}
@media (max-width: 640px) {{
    .container {{ padding: 20px 16px 40px; }}
    .gap-grid {{ grid-template-columns: 1fr; }}
    .report-header h1 {{ font-size: 20px; }}
}}
</style>
</head>'''

    # ------------------------------------------------------------------
    # Report header
    # ------------------------------------------------------------------

    def _report_header(self, report: dict, analysis: dict) -> str:
        title = self._escape(report.get("title", "Untitled Report"))
        report_id = self._escape(report.get("id", ""))
        confidence = (analysis.get("confidence") or report.get("confidence") or "MEDIUM").upper()
        conf_cls = self._confidence_badge_class(confidence)
        starred = report.get("starred", False)
        provider = self._escape(report.get("provider", ""))
        model = self._escape(report.get("model", ""))
        category_focus = report.get("category_focus", "")
        tech_prefs = report.get("technology_preferences", []) or []

        # Date formatting
        created_at = report.get("created_at", "")
        date_display = self._format_date(created_at)

        parts = ['<div class="report-header">']

        # Top row: title + badges
        parts.append('<div class="top-row">')
        parts.append(f'<h1>{title}</h1>')
        if report_id:
            parts.append(f'<span class="badge badge-id">{report_id}</span>')
        parts.append(f'<span class="badge {conf_cls}">{self._escape(confidence)}</span>')
        if starred:
            parts.append('<span class="badge badge-starred">&#9733;</span>')
        parts.append("</div>")

        # Meta row
        meta_items = []
        if date_display:
            meta_items.append(date_display)
        if provider:
            provider_display = provider
            if model:
                provider_display += f" / {model}"
            meta_items.append(provider_display)

        if meta_items:
            parts.append('<div class="meta-row">')
            parts.append(('<span class="sep">&middot;</span>').join(
                f"<span>{item}</span>" for item in meta_items
            ))
            parts.append("</div>")

        # Problem card
        problem_text = report.get("problem", "")
        if problem_text:
            parts.append('<div class="problem-card">')
            parts.append('<div class="label">Problem Statement</div>')
            parts.append(f'<div class="body">{self._render_text(problem_text)}</div>')
            parts.append("</div>")

        # Tags: category focus + technology preferences
        if category_focus or tech_prefs:
            parts.append('<div class="tags-row">')
            if category_focus:
                cat_label = CATEGORY_LABELS.get(category_focus, category_focus)
                parts.append(f'<span class="tag tag-category">{self._escape(cat_label)}</span>')
            for tech in tech_prefs:
                parts.append(f'<span class="tag tag-tech">{self._escape(tech)}</span>')
            parts.append("</div>")

        parts.append("</div>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def _summary_section(self, analysis: dict) -> str:
        summary = analysis.get("summary", "")
        if not summary:
            return ""
        parts = [
            '<div class="section">',
            '<h2 class="section-title">Summary</h2>',
            f'<div class="rendered-text">{self._render_text(summary)}</div>',
            "</div>",
        ]
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Recommended Patterns (PBCs / ABBs / SBBs)
    # ------------------------------------------------------------------

    def _patterns_section(self, analysis: dict) -> str:
        pbcs = analysis.get("recommended_pbcs", [])
        abbs = analysis.get("recommended_abbs", [])
        sbbs = analysis.get("recommended_sbbs", [])

        if not pbcs and not abbs and not sbbs:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">Recommended Patterns</h2>',
        ]

        # --- PBCs ---
        if pbcs:
            parts.append('<h3 class="section-subtitle">Packaged Business Capabilities (PBCs)</h3>')
            parts.append('<div class="table-wrapper"><table class="table-themed-purple">')
            parts.append(
                "<thead><tr>"
                "<th>ID</th>"
                "<th>Name</th>"
                "<th>Confidence</th>"
                "<th>Relevance</th>"
                "</tr></thead>"
            )
            parts.append("<tbody>")
            for pbc in pbcs:
                conf = (pbc.get("confidence") or "").upper()
                parts.append(
                    "<tr>"
                    f'<td><span class="inline-id">{self._escape(pbc.get("id", ""))}</span></td>'
                    f'<td>{self._escape(pbc.get("name", ""))}</td>'
                    f'<td><span class="badge {self._confidence_badge_class(conf)}">{self._escape(conf)}</span></td>'
                    f'<td>{self._escape(pbc.get("relevance", ""))}</td>'
                    "</tr>"
                )
            parts.append("</tbody></table></div>")

        # --- ABBs ---
        if abbs:
            parts.append('<h3 class="section-subtitle">Architecture Building Blocks (ABBs)</h3>')
            parts.append('<div class="table-wrapper"><table class="table-themed-blue">')
            parts.append(
                "<thead><tr>"
                "<th>ID</th>"
                "<th>Name</th>"
                "<th>Confidence</th>"
                "<th>Role</th>"
                "</tr></thead>"
            )
            parts.append("<tbody>")
            for abb in abbs:
                conf = (abb.get("confidence") or "").upper()
                parts.append(
                    "<tr>"
                    f'<td><span class="inline-id">{self._escape(abb.get("id", ""))}</span></td>'
                    f'<td>{self._escape(abb.get("name", ""))}</td>'
                    f'<td><span class="badge {self._confidence_badge_class(conf)}">{self._escape(conf)}</span></td>'
                    f'<td>{self._escape(abb.get("role", ""))}</td>'
                    "</tr>"
                )
            parts.append("</tbody></table></div>")

        # --- SBBs ---
        if sbbs:
            parts.append('<h3 class="section-subtitle">Solution Building Blocks (SBBs)</h3>')
            parts.append('<div class="table-wrapper"><table class="table-themed-green">')
            parts.append(
                "<thead><tr>"
                "<th>ID</th>"
                "<th>Name</th>"
                "<th>Confidence</th>"
                "<th>Justification</th>"
                "<th>Technologies</th>"
                "</tr></thead>"
            )
            parts.append("<tbody>")
            for sbb in sbbs:
                conf = (sbb.get("confidence") or "").upper()
                techs = sbb.get("technologies", []) or []
                techs_html = ", ".join(self._escape(t) for t in techs) if techs else '<span class="empty-note">--</span>'
                justification = self._escape(sbb.get("justification", ""))
                restrictions_note = sbb.get("restrictions_note", "")
                if restrictions_note:
                    justification += f' <span style="color:var(--orange);font-size:12px;">[{self._escape(restrictions_note)}]</span>'
                parts.append(
                    "<tr>"
                    f'<td><span class="inline-id">{self._escape(sbb.get("id", ""))}</span></td>'
                    f'<td>{self._escape(sbb.get("name", ""))}</td>'
                    f'<td><span class="badge {self._confidence_badge_class(conf)}">{self._escape(conf)}</span></td>'
                    f"<td>{justification}</td>"
                    f"<td>{techs_html}</td>"
                    "</tr>"
                )
            parts.append("</tbody></table></div>")

        parts.append("</div>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # SBB Comparisons
    # ------------------------------------------------------------------

    def _comparisons_section(self, analysis: dict) -> str:
        comparisons = analysis.get("sbb_comparisons", [])
        if not comparisons:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">SBB Comparisons</h2>',
        ]

        for idx, group in enumerate(comparisons):
            parts.append('<div class="comparison-group">')

            context = group.get("context", "")
            if context:
                parts.append(f'<div class="context">{self._render_text(context)}</div>')

            sbbs = group.get("sbbs", [])
            if sbbs:
                parts.append('<div class="table-wrapper"><table>')
                parts.append(
                    "<thead><tr>"
                    "<th>ID</th>"
                    "<th>Name</th>"
                    "<th>Strengths</th>"
                    "<th>Weaknesses</th>"
                    "<th>Best For</th>"
                    "</tr></thead>"
                )
                parts.append("<tbody>")
                for sbb in sbbs:
                    strengths = sbb.get("strengths", []) or []
                    weaknesses = sbb.get("weaknesses", []) or []
                    strengths_html = self._render_bullet_list(strengths, css_class="strengths")
                    weaknesses_html = self._render_bullet_list(weaknesses, css_class="weaknesses")
                    parts.append(
                        "<tr>"
                        f'<td><span class="inline-id">{self._escape(sbb.get("id", ""))}</span></td>'
                        f'<td>{self._escape(sbb.get("name", ""))}</td>'
                        f"<td>{strengths_html}</td>"
                        f"<td>{weaknesses_html}</td>"
                        f'<td>{self._escape(sbb.get("best_for", ""))}</td>'
                        "</tr>"
                    )
                parts.append("</tbody></table></div>")

            recommendation = group.get("recommendation", "")
            if recommendation:
                parts.append(
                    f'<div class="recommendation"><strong>Recommendation:</strong> '
                    f"{self._escape(recommendation)}</div>"
                )

            parts.append("</div>")

        parts.append("</div>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Architecture Composition & Data Flow
    # ------------------------------------------------------------------

    def _architecture_section(self, analysis: dict) -> str:
        composition = analysis.get("architecture_composition", "")
        data_flow = analysis.get("data_flow", "")

        if not composition and not data_flow:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">Architecture</h2>',
        ]

        if composition:
            parts.append('<h3 class="section-subtitle">Architecture Composition</h3>')
            parts.append(f'<div class="rendered-text">{self._render_text(composition)}</div>')

        if data_flow:
            parts.append('<h3 class="section-subtitle">Data Flow</h3>')
            parts.append(f'<div class="rendered-text">{self._render_text(data_flow)}</div>')

        parts.append("</div>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Platform Gaps
    # ------------------------------------------------------------------

    def _gaps_section(self, analysis: dict) -> str:
        gaps = analysis.get("platform_gaps", [])
        if not gaps:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">Platform Gaps</h2>',
            '<div class="gap-grid">',
        ]

        for gap in gaps:
            priority = (gap.get("priority") or "").upper()
            pri_cls = self._priority_badge_class(priority)
            category = gap.get("category", "")
            parts.append('<div class="gap-card">')
            parts.append(f'<div class="gap-title">{self._escape(gap.get("capability", ""))}</div>')
            desc = gap.get("description", "")
            if desc:
                parts.append(f'<div class="gap-desc">{self._escape(desc)}</div>')
            rationale = gap.get("rationale", "")
            if rationale:
                parts.append(f'<div class="gap-desc" style="color:var(--text);font-style:italic;">{self._escape(rationale)}</div>')
            parts.append('<div class="gap-meta">')
            if priority:
                parts.append(f'<span class="badge {pri_cls}">{self._escape(priority)}</span>')
            if category:
                parts.append(f'<span class="tag">{self._escape(category)}</span>')
            parts.append("</div>")
            parts.append("</div>")

        parts.append("</div>")
        parts.append("</div>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Vector Matches (Appendix)
    # ------------------------------------------------------------------

    def _vector_matches_section(self, result: dict) -> str:
        vm = result.get("vector_matches", {})
        patterns = vm.get("patterns", [])
        technologies = vm.get("technologies", [])
        pbcs = vm.get("pbcs", [])

        if not patterns and not technologies and not pbcs:
            return ""

        parts = [
            '<div class="section">',
            '<h2 class="section-title">Appendix: Vector Search Matches</h2>',
        ]

        graph_stats = result.get("graph_stats", {})
        if graph_stats:
            stats_items = []
            for key, label in [("pbcs", "PBCs"), ("abbs", "ABBs"), ("sbbs", "SBBs"), ("technologies", "Technologies")]:
                val = graph_stats.get(key, 0)
                if val:
                    stats_items.append(f"{val} {label}")
            if stats_items:
                parts.append(
                    f'<p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">'
                    f'Graph searched: {", ".join(stats_items)}</p>'
                )

        if patterns:
            parts.append('<h3 class="section-subtitle">Patterns</h3>')
            parts.append('<div class="table-wrapper"><table class="vector-table">')
            parts.append(
                "<thead><tr>"
                "<th>ID</th><th>Name</th><th>Type</th><th>Category</th><th>Score</th>"
                "</tr></thead><tbody>"
            )
            for m in patterns:
                score = m.get("score", 0)
                parts.append(
                    "<tr>"
                    f'<td><span class="inline-id">{self._escape(m.get("id", ""))}</span></td>'
                    f'<td>{self._escape(m.get("name", ""))}</td>'
                    f'<td>{self._escape(m.get("type", ""))}</td>'
                    f'<td>{self._escape(m.get("category", ""))}</td>'
                    f'<td class="score">{score:.3f}</td>'
                    "</tr>"
                )
            parts.append("</tbody></table></div>")

        if technologies:
            parts.append('<h3 class="section-subtitle">Technologies</h3>')
            parts.append('<div class="table-wrapper"><table class="vector-table">')
            parts.append(
                "<thead><tr>"
                "<th>ID</th><th>Name</th><th>Vendor</th><th>Score</th>"
                "</tr></thead><tbody>"
            )
            for m in technologies:
                score = m.get("score", 0)
                parts.append(
                    "<tr>"
                    f'<td><span class="inline-id">{self._escape(m.get("id", ""))}</span></td>'
                    f'<td>{self._escape(m.get("name", ""))}</td>'
                    f'<td>{self._escape(m.get("vendor", ""))}</td>'
                    f'<td class="score">{score:.3f}</td>'
                    "</tr>"
                )
            parts.append("</tbody></table></div>")

        if pbcs:
            parts.append('<h3 class="section-subtitle">Business Capabilities</h3>')
            parts.append('<div class="table-wrapper"><table class="vector-table">')
            parts.append(
                "<thead><tr>"
                "<th>ID</th><th>Name</th><th>Score</th>"
                "</tr></thead><tbody>"
            )
            for m in pbcs:
                score = m.get("score", 0)
                parts.append(
                    "<tr>"
                    f'<td><span class="inline-id">{self._escape(m.get("id", ""))}</span></td>'
                    f'<td>{self._escape(m.get("name", ""))}</td>'
                    f'<td class="score">{score:.3f}</td>'
                    "</tr>"
                )
            parts.append("</tbody></table></div>")

        parts.append("</div>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Reasoning (collapsible)
    # ------------------------------------------------------------------

    def _reasoning_section(self, analysis: dict) -> str:
        reasoning = analysis.get("reasoning", "")
        if not reasoning:
            return ""

        section_id = "reasoning-collapse"
        parts = [
            '<div class="section">',
            '<div class="collapsible">',
            f'<button class="collapsible-toggle" onclick="toggleCollapsible(\'{section_id}\')" '
            f'id="toggle-{section_id}">Reasoning &amp; Confidence Notes</button>',
            f'<div class="collapsible-body" id="{section_id}">',
            f'<div class="rendered-text">{self._render_text(reasoning)}</div>',
            "</div>",
            "</div>",
            "</div>",
            "<script>",
            "function toggleCollapsible(id) {",
            "  var body = document.getElementById(id);",
            "  var toggle = document.getElementById('toggle-' + id);",
            "  if (body.classList.contains('open')) {",
            "    body.classList.remove('open');",
            "    toggle.classList.remove('open');",
            "  } else {",
            "    body.classList.add('open');",
            "    toggle.classList.add('open');",
            "  }",
            "}",
            "</script>",
        ]
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Footer
    # ------------------------------------------------------------------

    def _footer(self, report: dict, result: dict) -> str:
        provider = self._escape(result.get("provider", report.get("provider", "")))
        model = self._escape(result.get("model", report.get("model", "")))
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        parts = [
            '<div class="report-footer">',
            f"Generated {self._escape(now)}",
        ]
        if provider:
            parts.append(f" &middot; Provider: {provider}")
        if model:
            parts.append(f" &middot; Model: {model}")
        parts.append("<br>AI Pattern Advisor &mdash; Architecture Report</div>")
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
        """Convert basic markdown (bold, bullets, numbered lists, headings, line breaks) to HTML."""
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
                # Map markdown heading levels to h3-h6 to stay subordinate to section titles
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

    def _render_bullet_list(self, items: list, css_class: str = "") -> str:
        """Render a list of strings as a compact inline bullet list."""
        if not items:
            return '<span class="empty-note">--</span>'
        cls_attr = f' class="{css_class}"' if css_class else ""
        parts = [f"<ul{cls_attr} style=\"margin:0 0 0 16px;padding:0;font-size:12px;\">"]
        for item in items:
            parts.append(f"<li>{self._escape(item)}</li>")
        parts.append("</ul>")
        return "\n".join(parts)

    @staticmethod
    def _confidence_badge_class(confidence: str) -> str:
        """Return the CSS class for a confidence badge."""
        c = (confidence or "").upper()
        if c == "HIGH":
            return "badge-conf-high"
        if c == "MEDIUM":
            return "badge-conf-medium"
        return "badge-conf-low"

    @staticmethod
    def _priority_badge_class(priority: str) -> str:
        """Return the CSS class for a priority badge."""
        p = (priority or "").upper()
        if p == "HIGH":
            return "badge-pri-high"
        if p == "MEDIUM":
            return "badge-pri-medium"
        return "badge-pri-low"

    @staticmethod
    def _format_date(date_str) -> str:
        """Best-effort formatting of an ISO date string to a readable display."""
        if not date_str:
            return ""
        try:
            if isinstance(date_str, datetime):
                return date_str.strftime("%d %b %Y, %H:%M")
            dt = datetime.fromisoformat(str(date_str))
            return dt.strftime("%d %b %Y, %H:%M")
        except (ValueError, TypeError):
            return str(date_str)
