"""
HTML Export Service.
Generates a self-contained HTML file with all patterns, technologies, and PBCs.
"""
import base64
import html
import os
import re
from datetime import datetime
from collections import defaultdict

from services.neo4j_service import Neo4jService, BUILTIN_CATEGORIES

# Category overview descriptions shown under each category header in Pattern Inventory
CATEGORY_OVERVIEWS = {
    "blueprint": (
        "Foundational structural patterns that define the overarching platform topology "
        "\u2014 planes, boundaries, and invariants. These are Level 4 (Enterprise) patterns "
        "that establish the segmentation model and boundary rules all building blocks must "
        "conform to. An Architecture Topology is not a composable block; it is the structure itself."
    ),
    "core": (
        "The central prompt engineering and LLM interaction capabilities. This category "
        "covers how the platform constructs, versions, and executes prompts across different "
        "runtimes and invocation paths \u2014 whether calling a model provider directly or "
        "routing through a multi-provider gateway."
    ),
    "intg": (
        "The connectivity layer that bridges the platform to AI model providers, tool "
        "ecosystems, and ML serving infrastructure. This includes model gateways for "
        "multi-provider routing and failover, tool gateways for tool access, embedding "
        "services, and self-hosted model endpoints."
    ),
    "agt": (
        "Autonomous and semi-autonomous AI capabilities that combine reasoning, tool use, "
        "and memory to accomplish multi-step tasks. This spans managed agent runtimes, custom "
        "orchestration frameworks, and third-party platforms that operate with their own trust boundaries."
    ),
    "kr": (
        "How the platform ingests, indexes, and retrieves enterprise knowledge to ground LLM "
        "responses in factual context. This covers the full RAG pipeline \u2014 from document "
        "chunking and embedding through vector search and reranking."
    ),
    "xcut": (
        "Governance and safety concerns that span every category and invocation path. This "
        "focuses on AI guardrails \u2014 content filtering, PII detection, topic blocking, and "
        "contextual grounding checks \u2014 delivered through both integrated and standalone "
        "enforcement modes."
    ),
    "pip": (
        "The vendor portability mechanism derived from the Platform Integration Pattern. Socket "
        "contracts define the integration interface, adapters translate between platform conventions "
        "and vendor-specific APIs, and service API contracts expose stable endpoints to consumers."
    ),
}


class HtmlExportService:
    """Builds a single-file HTML export of the full pattern library."""

    def __init__(self, db: Neo4jService):
        self.db = db
        self._pattern_ids: set[str] = set()
        self._tech_ids: set[str] = set()
        self._pbc_ids: set[str] = set()
        self._name_map: dict[str, str] = {}

    def generate_html(self) -> str:
        data = self._fetch_all_data()
        return self._build_html(data)

    # ------------------------------------------------------------------
    # Data fetching
    # ------------------------------------------------------------------

    def _fetch_all_data(self) -> dict:
        patterns, _ = self.db.list_patterns(limit=500)
        full_patterns = []
        for p in patterns:
            full = self.db.get_pattern_with_relationships(p["id"])
            if full:
                full_patterns.append(full)

        technologies, _ = self.db.list_technologies(limit=500)
        full_techs = []
        for t in technologies:
            full_t = self.db.get_technology_with_patterns(t["id"])
            if full_t:
                full_techs.append(full_t)

        pbcs = self.db.list_pbcs()
        categories = self.db.list_categories()

        # Build lookup maps
        self._pattern_ids = {p["id"] for p in full_patterns}
        self._tech_ids = {t["id"] for t in full_techs}
        self._pbc_ids = {p["id"] for p in pbcs}
        self._name_map = {}
        for p in full_patterns:
            self._name_map[p["id"]] = p.get("name", "")
        for t in full_techs:
            self._name_map[t["id"]] = t.get("name", "")
        for p in pbcs:
            self._name_map[p["id"]] = p.get("name", "")

        return {
            "patterns": full_patterns,
            "technologies": full_techs,
            "pbcs": pbcs,
            "categories": categories,
        }

    # ------------------------------------------------------------------
    # HTML assembly
    # ------------------------------------------------------------------

    def _build_html(self, data: dict) -> str:
        parts = [
            self._html_head(),
            self._sidebar(data),
            '<main class="main">',
            self._index_section(data),
        ]
        for p in data["patterns"]:
            parts.append(self._pattern_section(p))
        for t in data["technologies"]:
            parts.append(self._technology_section(t))
        for pbc in data["pbcs"]:
            parts.append(self._pbc_section(pbc))
        parts.append("</main></div>")
        parts.append(self._javascript())
        parts.append("</body></html>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Head / CSS
    # ------------------------------------------------------------------

    def _html_head(self) -> str:
        timestamp = datetime.now().strftime("%d/%m/%Y %H:%M")
        return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Architecture Patterns</title>
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
    --accent-hover: #79c0ff;
    --green: #3fb950;
    --orange: #d29922;
    --purple: #bc8cff;
    --red: #f85149;
    --cyan: #39d2c0;
    --blueprint: #f97316;
    --abb: #58a6ff;
    --sbb: #3fb950;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
}}
.layout {{ display: flex; min-height: 100vh; }}
.sidebar {{
    width: 280px;
    background: var(--bg-card);
    border-right: 1px solid var(--border);
    padding: 24px 0;
    position: fixed;
    top: 0; left: 0;
    height: 100vh;
    overflow-y: auto;
    z-index: 10;
}}
.sidebar-header {{
    padding: 0 20px 20px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
}}
.sidebar-header h2 {{
    font-size: 15px;
    color: var(--text-heading);
    font-weight: 600;
    letter-spacing: -0.3px;
}}
.sidebar-header .export-date {{
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
}}
.nav-section {{
    padding: 8px 20px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    user-select: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
}}
.nav-section::after {{
    content: '\u25BE';
    font-size: 10px;
    transition: transform 0.2s;
}}
.nav-section.collapsed::after {{
    transform: rotate(-90deg);
}}
.nav-group {{
    overflow: hidden;
    transition: max-height 0.3s ease;
}}
.nav-group.collapsed {{
    max-height: 0 !important;
    overflow: hidden;
}}
.nav-link {{
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 20px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 13px;
    transition: all 0.15s;
    cursor: pointer;
}}
.nav-link:hover {{ color: var(--text); background: var(--bg-card-hover); }}
.nav-link.active {{ color: var(--accent); background: rgba(88, 166, 255, 0.08); border-right: 2px solid var(--accent); }}
.nav-badge {{
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 600;
    margin-left: auto;
}}
.nav-badge.ab {{ background: rgba(249, 115, 22, 0.15); color: var(--blueprint); }}
.nav-badge.abb {{ background: rgba(88, 166, 255, 0.15); color: var(--abb); }}
.nav-badge.sbb {{ background: rgba(63, 185, 80, 0.15); color: var(--sbb); }}
.nav-badge.tech {{ background: rgba(57, 210, 192, 0.15); color: var(--cyan); }}
.nav-badge.pbc {{ background: rgba(188, 140, 255, 0.15); color: var(--purple); }}
.main {{ margin-left: 280px; flex: 1; padding: 32px 48px; max-width: 960px; }}
.content-section {{ display: none; }}
.content-section.active {{ display: block; }}
.hero {{
    margin-bottom: 48px;
    padding-bottom: 32px;
    border-bottom: 1px solid var(--border);
}}
.hero h1 {{
    font-size: 28px;
    color: var(--text-heading);
    font-weight: 700;
    letter-spacing: -0.5px;
    margin-bottom: 12px;
}}
.hero p {{ color: var(--text-muted); font-size: 15px; max-width: 640px; }}
.stats-grid {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin: 24px 0 40px;
}}
.stat-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    text-align: center;
}}
.stat-card .stat-num {{
    font-size: 28px;
    font-weight: 700;
    color: var(--text-heading);
}}
.stat-card .stat-label {{
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
}}
.concept-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin: 24px 0 40px;
}}
.concept-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
}}
.concept-card .label {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
}}
.concept-card .label.abb-label {{ color: var(--abb); }}
.concept-card .label.sbb-label {{ color: var(--sbb); }}
.concept-card .label.pbc-label {{ color: var(--purple); }}
.concept-card h3 {{ font-size: 16px; color: var(--text-heading); margin-bottom: 8px; }}
.concept-card p {{ font-size: 13px; color: var(--text-muted); line-height: 1.5; }}
.section-title {{
    font-size: 18px;
    color: var(--text-heading);
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
}}
.category-section {{ margin-bottom: 32px; }}
.category-header {{
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    padding-left: 4px;
}}
.pattern-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
}}
.pattern-card {{
    display: block;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    text-decoration: none;
    transition: all 0.15s;
    cursor: pointer;
}}
.pattern-card:hover {{
    border-color: var(--accent);
    background: var(--bg-card-hover);
    transform: translateY(-1px);
}}
.pattern-card .card-id {{
    font-size: 11px;
    font-weight: 700;
    font-family: 'SF Mono', Menlo, monospace;
    margin-bottom: 4px;
}}
.pattern-card .card-id.ab-type {{ color: var(--blueprint); }}
.pattern-card .card-id.abb-type {{ color: var(--abb); }}
.pattern-card .card-id.sbb-type {{ color: var(--sbb); }}
.pattern-card .card-id.tech-type {{ color: var(--cyan); }}
.pattern-card .card-id.pbc-type {{ color: var(--purple); }}
.pattern-card .card-name {{ font-size: 14px; color: var(--text-heading); font-weight: 500; }}
.pattern-card .card-status {{ font-size: 11px; color: var(--text-muted); margin-top: 6px; }}
.breadcrumb {{
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 16px;
}}
.breadcrumb a {{ color: var(--accent); text-decoration: none; cursor: pointer; }}
.breadcrumb a:hover {{ text-decoration: underline; }}
.detail h1 {{
    font-size: 24px;
    color: var(--text-heading);
    font-weight: 700;
    margin-bottom: 4px;
}}
.detail .subtitle {{
    font-size: 15px;
    color: var(--text-muted);
    margin-bottom: 24px;
}}
.detail h2 {{
    font-size: 16px;
    color: var(--text-heading);
    font-weight: 600;
    margin: 24px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
}}
.detail h3 {{ font-size: 14px; color: var(--text-heading); margin: 16px 0 8px; }}
.detail p {{ font-size: 14px; color: var(--text); margin-bottom: 12px; line-height: 1.65; }}
.detail ul {{
    margin: 8px 0 16px 20px;
    font-size: 14px;
}}
.detail li {{ margin-bottom: 6px; color: var(--text); line-height: 1.55; }}
.detail hr {{
    border: none;
    border-top: 1px solid var(--border);
    margin: 20px 0;
}}
.table-wrapper {{ overflow-x: auto; margin: 12px 0 16px; }}
.detail table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}}
.detail th {{
    background: var(--bg-card);
    text-align: left;
    padding: 10px 14px;
    border: 1px solid var(--border);
    color: var(--text-heading);
    font-weight: 600;
    font-size: 12px;
}}
.detail td {{
    padding: 10px 14px;
    border: 1px solid var(--border);
    color: var(--text);
    vertical-align: top;
}}
.detail tr:hover td {{ background: var(--bg-card-hover); }}
.ref-link {{
    color: var(--accent);
    text-decoration: none;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 0.92em;
    background: rgba(88, 166, 255, 0.08);
    padding: 1px 5px;
    border-radius: 3px;
    cursor: pointer;
}}
.ref-link:hover {{ text-decoration: underline; color: var(--accent-hover); }}
.blueprint-banner {{
    background: rgba(249, 115, 22, 0.08);
    border: 1px solid rgba(249, 115, 22, 0.25);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 13px;
    color: var(--blueprint);
}}
.tech-banner {{
    background: rgba(57, 210, 192, 0.08);
    border: 1px solid rgba(57, 210, 192, 0.25);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 13px;
    color: var(--cyan);
}}
.pbc-banner {{
    background: rgba(188, 140, 255, 0.08);
    border: 1px solid rgba(188, 140, 255, 0.25);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 13px;
    color: var(--purple);
}}
.template-version {{
    font-size: 12px;
    color: var(--text-muted);
    padding: 8px 12px;
    background: var(--bg-card);
    border-radius: 6px;
    display: inline-block;
    margin-bottom: 20px;
}}
code {{
    background: var(--bg-card);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.9em;
    font-family: 'SF Mono', Menlo, monospace;
}}
.cap-pill {{
    display: inline-block;
    background: rgba(88, 166, 255, 0.1);
    color: var(--accent);
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 12px;
    margin: 3px 4px 3px 0;
    border: 1px solid rgba(88, 166, 255, 0.2);
}}
.flow-diagram {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    text-align: center;
    margin: 24px 0;
    font-size: 15px;
    color: var(--text);
}}
.flow-arrow {{ color: var(--text-muted); margin: 0 12px; }}
.framework-img {{
    display: block;
    max-width: 100%;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin: 24px auto 32px;
    background: #fff;
    padding: 16px;
}}
.framework-img-caption {{
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
    margin-top: -20px;
    margin-bottom: 32px;
}}
.composable-section {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    margin: 24px 0 40px;
}}
.composable-section h3 {{ font-size: 15px; color: var(--text-heading); margin-bottom: 12px; }}
.composable-section p {{ font-size: 13px; color: var(--text-muted); line-height: 1.6; margin-bottom: 10px; }}
.composable-section p:last-child {{ margin-bottom: 0; }}
.composable-pillars {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 16px;
}}
.composable-pillar {{
    border-left: 2px solid var(--cyan);
    padding: 8px 12px;
}}
.composable-pillar strong {{ display: block; font-size: 12px; color: var(--text-heading); margin-bottom: 4px; }}
.composable-pillar span {{ font-size: 12px; color: var(--text-muted); }}
.level-grid {{
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin: 20px 0 40px;
}}
.level-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
}}
.level-card .level-num {{
    font-size: 11px;
    font-weight: 700;
    color: var(--cyan);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}}
.level-card h4 {{ font-size: 14px; color: var(--text-heading); margin: 4px 0; }}
.level-card p {{ font-size: 12px; color: var(--text-muted); }}
.level-card .audience {{ font-size: 11px; color: var(--accent); margin-top: 6px; }}
.category-overview {{
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.6;
    margin-bottom: 16px;
    padding-left: 4px;
    max-width: 720px;
}}
@media (max-width: 768px) {{
    .sidebar {{ display: none; }}
    .main {{ margin-left: 0; padding: 20px; }}
    .concept-grid, .stats-grid, .level-grid, .composable-pillars {{ grid-template-columns: 1fr; }}
}}
</style>
</head>
<body>
<div class="layout">'''

    # ------------------------------------------------------------------
    # Sidebar
    # ------------------------------------------------------------------

    def _sidebar(self, data: dict) -> str:
        timestamp = datetime.now().strftime("%d/%m/%Y %H:%M")
        parts = [
            '<nav class="sidebar" id="sidebar">',
            '<div class="sidebar-header">',
            '<h2>AI Architecture Patterns</h2>',
            f'<div class="export-date">Exported {self._escape(timestamp)}</div>',
            '</div>',
            '<a class="nav-link active" href="#" onclick="showIndex();return false;" id="nav-index">Overview</a>',
        ]

        # Group patterns by category
        cat_map = {c["code"]: c["label"] for c in data["categories"]}
        grouped = defaultdict(list)
        for p in data["patterns"]:
            grouped[p.get("category", "other")].append(p)

        # Order categories: blueprint first, then alphabetical
        cat_order = ["blueprint", "core", "intg", "agt", "kr", "xcut", "pip"]
        seen = set()
        ordered_cats = []
        for c in cat_order:
            if c in grouped:
                ordered_cats.append(c)
                seen.add(c)
        for c in sorted(grouped.keys()):
            if c not in seen:
                ordered_cats.append(c)

        for cat_code in ordered_cats:
            cat_label = cat_map.get(cat_code, BUILTIN_CATEGORIES.get(cat_code, cat_code))
            pats = sorted(grouped[cat_code], key=lambda p: p["id"])
            safe_cat = re.sub(r'[^a-zA-Z0-9]', '', cat_code)
            parts.append(f'<div class="nav-section" onclick="toggleGroup(\'{safe_cat}\')">{self._escape(cat_label)}</div>')
            parts.append(f'<div class="nav-group" id="group-{safe_cat}">')
            for p in pats:
                pid = self._escape(p["id"])
                ptype = p.get("type", "").lower()
                badge_cls = "ab" if ptype == "ab" else "abb" if ptype == "abb" else "sbb"
                badge_text = ptype.upper()
                parts.append(
                    f'<a class="nav-link" href="#" onclick="showPattern(\'{pid}\');return false;" id="nav-{pid}">'
                    f'{pid}'
                    f'<span class="nav-badge {badge_cls}">{badge_text}</span>'
                    f'</a>'
                )
            parts.append('</div>')

        # Technologies
        if data["technologies"]:
            parts.append('<div class="nav-section" onclick="toggleGroup(\'tech\')">Technologies</div>')
            parts.append('<div class="nav-group" id="group-tech">')
            for t in sorted(data["technologies"], key=lambda x: x.get("name", "")):
                safe_id = self._safe_tech_id(t["id"])
                name = self._escape(t.get("name", t["id"]))
                parts.append(
                    f'<a class="nav-link" href="#" onclick="showPattern(\'{safe_id}\');return false;" id="nav-{safe_id}">'
                    f'{name}'
                    f'<span class="nav-badge tech">Tech</span>'
                    f'</a>'
                )
            parts.append('</div>')

        # PBCs
        if data["pbcs"]:
            parts.append('<div class="nav-section" onclick="toggleGroup(\'pbc\')">Business Capabilities</div>')
            parts.append('<div class="nav-group" id="group-pbc">')
            for pbc in sorted(data["pbcs"], key=lambda x: x.get("id", "")):
                pid = self._escape(pbc["id"])
                parts.append(
                    f'<a class="nav-link" href="#" onclick="showPattern(\'{pid}\');return false;" id="nav-{pid}">'
                    f'{pid}'
                    f'<span class="nav-badge pbc">PBC</span>'
                    f'</a>'
                )
            parts.append('</div>')

        parts.append("</nav>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Index / Overview
    # ------------------------------------------------------------------

    def _index_section(self, data: dict) -> str:
        patterns = data["patterns"]
        ab_count = sum(1 for p in patterns if p.get("type") == "AB")
        abb_count = sum(1 for p in patterns if p.get("type") == "ABB")
        sbb_count = sum(1 for p in patterns if p.get("type") == "SBB")
        tech_count = len(data["technologies"])
        pbc_count = len(data["pbcs"])

        parts = ['<div class="content-section active" id="content-index">']

        # Hero
        parts.append('<div class="hero">')
        parts.append('<h1>AI Architecture Patterns</h1>')
        parts.append('<p>A unified framework combining TOGAF Architecture Building Blocks, '
                     'Solution Building Blocks, and Packaged Business Capabilities for '
                     'enterprise AI architecture.</p>')
        parts.append('</div>')

        # Stats
        parts.append('<div class="stats-grid">')
        for num, label, color in [
            (ab_count, "Blueprints (AB)", "--blueprint"),
            (abb_count, "Building Blocks (ABB)", "--abb"),
            (sbb_count, "Solution Blocks (SBB)", "--sbb"),
            (tech_count, "Technologies", "--cyan"),
        ]:
            parts.append(
                f'<div class="stat-card">'
                f'<div class="stat-num" style="color:var({color})">{num}</div>'
                f'<div class="stat-label">{label}</div>'
                f'</div>'
            )
        parts.append('</div>')

        # --- The ABB / SBB / PBC Framework ---
        parts.append('<h2 class="section-title">The ABB / SBB / PBC Framework</h2>')

        # Framework image (base64 inline if available)
        img_path = os.path.join(os.path.dirname(__file__), '..', 'static', 'framework_diagram.png')
        if os.path.exists(img_path):
            with open(img_path, 'rb') as f:
                img_b64 = base64.b64encode(f.read()).decode()
            parts.append(f'<img class="framework-img" src="data:image/png;base64,{img_b64}" alt="ABB/SBB/PBC Framework Diagram">')
            parts.append('<div class="framework-img-caption">The Unified Framework: PBCs package business capabilities, ABBs define vendor-neutral contracts, SBBs provide concrete implementations</div>')

        # Progression text
        parts.append('<p style="color:var(--text-muted);font-size:14px;margin-bottom:20px;max-width:640px;">'
                     'The framework establishes a clear progression from logical specification '
                     'to physical implementation to business consumption:</p>')

        # Concept cards
        parts.append('<div class="concept-grid">')
        parts.append(
            '<div class="concept-card"><div class="label abb-label">ABB &mdash; Logical / What</div>'
            '<h3>Architecture Building Block</h3>'
            '<p>Vendor-neutral specifications defining required capabilities, interfaces, and constraints. '
            'ABBs define <em>what</em> an architecture requires without mandating <em>how</em> '
            'those requirements are fulfilled.</p></div>'
        )
        parts.append(
            '<div class="concept-card"><div class="label sbb-label">SBB &mdash; Physical / How</div>'
            '<h3>Solution Building Block</h3>'
            '<p>Concrete implementations fulfilling ABB contracts. SBBs are product-aware and '
            'vendor-specific. Multiple SBBs can satisfy the same ABB contract, enabling technology portability.</p></div>'
        )
        parts.append(
            '<div class="concept-card"><div class="label pbc-label">PBC &mdash; Business / Why</div>'
            '<h3>Packaged Business Capability</h3>'
            '<p>Business-consumable services exposed via APIs, bundling one or more ABB/SBB '
            'combinations into a reusable capability recognizable by business users.</p></div>'
        )
        parts.append('</div>')

        # Flow diagram
        parts.append('<div class="flow-diagram">')
        parts.append('<strong style="color:var(--abb)">ABB</strong> defines the contract')
        parts.append('<span class="flow-arrow">&rarr;</span>')
        parts.append('<strong style="color:var(--sbb)">SBB</strong> fulfills it')
        parts.append('<span class="flow-arrow">&rarr;</span>')
        parts.append('<strong style="color:var(--purple)">PBC</strong> packages it for business consumption')
        parts.append('</div>')

        # Composable Architecture section
        parts.append('<div class="composable-section">')
        parts.append('<h3>Composable Architecture</h3>')
        parts.append('<p>The AI landscape evolves too rapidly for static blueprints. The composable approach '
                     'shifts architecture from static design to dynamic assembly. ABB contracts define stable '
                     'interfaces while allowing SBB implementations to evolve. PBCs can be composed into new '
                     'solutions without requiring architectural redesign.</p>')
        parts.append('<p>When a new LLM provider offers superior performance, when a new guardrails framework '
                     'addresses emerging risks, or when a new vector database offers better cost-performance '
                     '&mdash; the enterprise adapts by swapping SBBs rather than redesigning systems.</p>')
        parts.append('<div class="composable-pillars">')
        parts.append('<div class="composable-pillar"><strong>Technology Portability</strong>'
                     '<span>Well-defined ABB contracts enable swapping between self-hosted and SaaS '
                     'implementations without architectural disruption.</span></div>')
        parts.append('<div class="composable-pillar"><strong>Governance Without Rigidity</strong>'
                     '<span>Governance policies attach to ABBs, not SBBs &mdash; consistent controls '
                     'without constraining implementation choices.</span></div>')
        parts.append('<div class="composable-pillar"><strong>Incremental Adoption</strong>'
                     '<span>Teams implement one building block at a time while maintaining architectural '
                     'coherence across the enterprise.</span></div>')
        parts.append('</div></div>')

        # Architecture Topology paragraph
        parts.append('<p style="color:var(--text-muted);font-size:14px;margin-bottom:20px;max-width:640px;">'
                     'Above these building blocks sit <strong style="color:var(--blueprint)">'
                     'Architecture Topology (AB)</strong> &mdash; foundational structural patterns that define '
                     'the platform\'s shape itself. A topology pattern is not a composable block; it is the '
                     'structure that all blocks operate within. Topologies define partitions, boundary rules, '
                     'and invariants.</p>')

        # Pattern Level Taxonomy
        parts.append('<h2 class="section-title">Pattern Level Taxonomy</h2>')
        parts.append('<p style="color:var(--text-muted);font-size:14px;margin-bottom:20px;max-width:640px;">'
                     'Patterns are organized across four levels of abstraction, each addressing different '
                     'architectural concerns and serving different stakeholders. This catalogue focuses on '
                     'Level 3 (Architectural) and Level 4 (Enterprise) patterns &mdash; the levels that define '
                     'system-wide structural decisions and enterprise integration strategies.</p>')
        parts.append('<div class="level-grid">')
        parts.append('<div class="level-card"><div class="level-num">Level 1</div>'
                     '<h4>Implementation Patterns</h4>'
                     '<p>Code &amp; algorithm level &mdash; prompt templates, chunking strategies, '
                     'embedding techniques, few-shot approaches.</p>'
                     '<div class="audience">Developers</div></div>')
        parts.append('<div class="level-card"><div class="level-num">Level 2</div>'
                     '<h4>Design Patterns</h4>'
                     '<p>Component level &mdash; ReAct Loop, Router Agent, Chain of Thought, Basic RAG. '
                     'Stable and technology-agnostic.</p>'
                     '<div class="audience">Technical Leads</div></div>')
        parts.append('<div class="level-card"><div class="level-num">Level 3</div>'
                     '<h4>Architectural Patterns</h4>'
                     '<p>System level &mdash; RAG Architecture, Agent Deployment, Human-in-the-Loop, '
                     'Model Gateway. Defines internal platform structure and component interactions.</p>'
                     '<div class="audience">Solution Architects</div></div>')
        parts.append('<div class="level-card"><div class="level-num">Level 4</div>'
                     '<h4>Enterprise Patterns &amp; Topology</h4>'
                     '<p>Architecture Topology, Segmented Platform, Multi-Account Deployment, '
                     'Capability Packaging. Shapes the overarching structure within which all system-level '
                     'patterns are deployed and governed.</p>'
                     '<div class="audience">Enterprise Architects</div></div>')
        parts.append('</div>')

        # Pattern inventory by category
        parts.append('<h2 class="section-title">Pattern Inventory</h2>')

        cat_map = {c["code"]: c["label"] for c in data["categories"]}
        grouped = defaultdict(list)
        for p in patterns:
            grouped[p.get("category", "other")].append(p)

        cat_order = ["blueprint", "core", "intg", "agt", "kr", "xcut", "pip"]
        seen = set()
        ordered_cats = []
        for c in cat_order:
            if c in grouped:
                ordered_cats.append(c)
                seen.add(c)
        for c in sorted(grouped.keys()):
            if c not in seen:
                ordered_cats.append(c)

        for cat_code in ordered_cats:
            cat_label = cat_map.get(cat_code, BUILTIN_CATEGORIES.get(cat_code, cat_code))
            pats = sorted(grouped[cat_code], key=lambda p: p["id"])
            parts.append('<div class="category-section">')
            parts.append(f'<div class="category-header">{self._escape(cat_label)}</div>')
            # Category overview description
            overview_text = CATEGORY_OVERVIEWS.get(cat_code, "")
            if overview_text:
                parts.append(f'<p class="category-overview">{self._escape(overview_text)}</p>')
            parts.append('<div class="pattern-grid">')
            for p in pats:
                pid = self._escape(p["id"])
                ptype = p.get("type", "").lower()
                type_cls = f"{ptype}-type" if ptype in ("ab", "abb", "sbb") else ""
                parts.append(
                    f'<a class="pattern-card" href="#" onclick="showPattern(\'{pid}\');return false;">'
                    f'<div class="card-id {type_cls}">{pid}</div>'
                    f'<div class="card-name">{self._escape(p.get("name", ""))}</div>'
                    f'<div class="card-status">{ptype.upper()} &middot; {self._escape(p.get("status", ""))}</div>'
                    f'</a>'
                )
            parts.append('</div></div>')

        # Technology inventory
        if data["technologies"]:
            parts.append('<h2 class="section-title">Technology Registry</h2>')
            parts.append('<div class="pattern-grid">')
            for t in sorted(data["technologies"], key=lambda x: x.get("name", "")):
                safe_id = self._safe_tech_id(t["id"])
                parts.append(
                    f'<a class="pattern-card" href="#" onclick="showPattern(\'{safe_id}\');return false;">'
                    f'<div class="card-id tech-type">{self._escape(t.get("name", t["id"]))}</div>'
                    f'<div class="card-name">{self._escape(t.get("vendor", ""))}</div>'
                    f'<div class="card-status">{self._escape(t.get("category", ""))} &middot; {self._escape(t.get("status", ""))}</div>'
                    f'</a>'
                )
            parts.append('</div>')

        # PBC inventory
        if data["pbcs"]:
            parts.append('<h2 class="section-title">Business Capabilities</h2>')
            parts.append('<div class="pattern-grid">')
            for pbc in sorted(data["pbcs"], key=lambda x: x.get("id", "")):
                pid = self._escape(pbc["id"])
                abb_count_pbc = len(pbc.get("abb_ids", []))
                parts.append(
                    f'<a class="pattern-card" href="#" onclick="showPattern(\'{pid}\');return false;">'
                    f'<div class="card-id pbc-type">{pid}</div>'
                    f'<div class="card-name">{self._escape(pbc.get("name", ""))}</div>'
                    f'<div class="card-status">PBC &middot; {abb_count_pbc} ABBs composed</div>'
                    f'</a>'
                )
            parts.append('</div>')

        parts.append('</div>')  # close content-index
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Pattern detail sections
    # ------------------------------------------------------------------

    def _pattern_section(self, pattern: dict) -> str:
        pid = pattern["id"]
        ptype = pattern.get("type", "")

        parts = [f'<div class="content-section" id="content-{self._escape(pid)}">']
        parts.append(f'<div class="breadcrumb"><a href="#" onclick="showIndex();return false;">Overview</a> / {self._escape(pid)}</div>')
        parts.append('<div class="detail">')
        parts.append(f'<h1>{self._escape(pid)}</h1>')
        parts.append(f'<div class="subtitle">{self._escape(pattern.get("name", ""))}</div>')

        # Metadata table
        parts.append(self._metadata_table(pattern))
        parts.append('<hr>')

        if ptype == "AB":
            parts.append(self._ab_detail(pattern))
        elif ptype == "ABB":
            parts.append(self._abb_detail(pattern))
        elif ptype == "SBB":
            parts.append(self._sbb_detail(pattern))

        parts.append('</div></div>')
        return "\n".join(parts)

    def _metadata_table(self, pattern: dict) -> str:
        pid = pattern["id"]
        ptype = pattern.get("type", "")
        rows = [
            ("ID", self._make_ref_link(pid)),
            ("Name", self._escape(pattern.get("name", ""))),
            ("Version", self._escape(pattern.get("version", ""))),
            ("Status", self._escape(pattern.get("status", ""))),
        ]

        # For SBBs, show the parent ABB
        if ptype == "SBB":
            rels = pattern.get("relationships", [])
            impl = [r for r in rels if r.get("type") == "IMPLEMENTS"]
            if impl:
                abb_id = impl[0]["target_id"]
                abb_name = impl[0].get("target_name", "")
                rows.append(("ABB Ref", f'{self._make_ref_link(abb_id)} ({self._escape(abb_name)})'))

        parts = ['<div class="table-wrapper"><table>']
        parts.append('<thead><tr><th>Field</th><th>Value</th></tr></thead>')
        parts.append('<tbody>')
        for label, value in rows:
            parts.append(f'<tr><td><strong>{label}</strong></td><td>{value}</td></tr>')
        parts.append('</tbody></table></div>')
        return "\n".join(parts)

    def _ab_detail(self, p: dict) -> str:
        sections = [
            ("Intent", p.get("intent")),
            ("Problem", p.get("problem")),
            ("Solution", p.get("solution")),
            ("Structural Elements", p.get("structural_elements")),
            ("Invariants", p.get("invariants")),
            ("Inter-Element Contracts", p.get("inter_element_contracts")),
            ("Related Patterns", p.get("related_patterns_text")),
            ("Related ADRs", p.get("related_adrs")),
            ("Building Blocks Note", p.get("building_blocks_note")),
        ]
        parts = ['<div class="blueprint-banner">Architecture Blueprint (AB) &mdash; structural foundation pattern</div>']
        for title, content in sections:
            if content:
                parts.append(f'<h2>{self._escape(title)}</h2>')
                parts.append(self._render_text(content))
                parts.append('<hr>')
        return "\n".join(parts)

    def _abb_detail(self, p: dict) -> str:
        parts = []

        # Functionality
        func = p.get("functionality")
        if func:
            parts.append('<h2>Functionality</h2>')
            parts.append(self._render_text(func))
            parts.append('<hr>')

        # Interfaces
        inbound = p.get("inbound_interfaces")
        outbound = p.get("outbound_interfaces")
        if inbound or outbound:
            parts.append('<h2>Interfaces</h2>')
            parts.append('<ul>')
            if inbound:
                parts.append(f'<li><strong>Inbound:</strong> {self._render_inline(inbound)}</li>')
            if outbound:
                parts.append(f'<li><strong>Outbound:</strong> {self._render_inline(outbound)}</li>')
            parts.append('</ul>')
            parts.append('<hr>')

        # Interoperability
        consumed = p.get("consumed_by_ids", [])
        works_with = p.get("works_with_ids", [])
        if consumed or works_with:
            parts.append('<h2>Interoperability</h2>')
            parts.append('<div class="table-wrapper"><table>')
            parts.append('<thead><tr><th>Relationship</th><th>References</th></tr></thead>')
            parts.append('<tbody>')
            if consumed:
                refs = ", ".join(
                    f'{self._make_ref_link(rid)} ({self._escape(self._name_map.get(rid, ""))})' for rid in consumed
                )
                parts.append(f'<tr><td><strong>Consumed by</strong></td><td>{refs}</td></tr>')
            if works_with:
                refs = ", ".join(
                    f'{self._make_ref_link(rid)} ({self._escape(self._name_map.get(rid, ""))})' for rid in works_with
                )
                parts.append(f'<tr><td><strong>Works with</strong></td><td>{refs}</td></tr>')
            parts.append('</tbody></table></div>')
            parts.append('<hr>')

        # Dependencies (from relationships)
        rels = p.get("relationships", [])
        deps = [r for r in rels if r.get("type") in ("DEPENDS_ON", "REFERENCES")]
        if deps:
            parts.append('<h2>Dependencies</h2>')
            parts.append('<ul>')
            for r in deps:
                parts.append(
                    f'<li>{self._make_ref_link(r["target_id"])} ({self._escape(r.get("target_name", ""))})</li>'
                )
            parts.append('</ul>')
            parts.append('<hr>')

        # Business Capabilities
        caps = p.get("business_capabilities", [])
        if caps:
            parts.append('<h2>Business Capabilities</h2>')
            parts.append('<div>')
            for cap in caps:
                parts.append(f'<span class="cap-pill">{self._escape(cap)}</span>')
            parts.append('</div>')

        return "\n".join(parts)

    def _sbb_detail(self, p: dict) -> str:
        parts = []

        # Specific Functionality
        func = p.get("specific_functionality")
        if func:
            parts.append('<h2>Specific Functionality</h2>')
            parts.append(self._render_text(func))
            parts.append('<hr>')

        # Interfaces
        inbound = p.get("inbound_interfaces")
        outbound = p.get("outbound_interfaces")
        if inbound or outbound:
            parts.append('<h2>Interfaces</h2>')
            parts.append('<ul>')
            if inbound:
                parts.append(f'<li><strong>Inbound:</strong> {self._render_inline(inbound)}</li>')
            if outbound:
                parts.append(f'<li><strong>Outbound:</strong> {self._render_inline(outbound)}</li>')
            parts.append('</ul>')
            parts.append('<hr>')

        # Interoperability
        consumed = p.get("consumed_by_ids", [])
        works_with = p.get("works_with_ids", [])
        if consumed or works_with:
            parts.append('<h2>Interoperability</h2>')
            parts.append('<div class="table-wrapper"><table>')
            parts.append('<thead><tr><th>Relationship</th><th>References</th></tr></thead>')
            parts.append('<tbody>')
            if consumed:
                refs = ", ".join(
                    f'{self._make_ref_link(rid)} ({self._escape(self._name_map.get(rid, ""))})' for rid in consumed
                )
                parts.append(f'<tr><td><strong>Consumed by</strong></td><td>{refs}</td></tr>')
            if works_with:
                refs = ", ".join(
                    f'{self._make_ref_link(rid)} ({self._escape(self._name_map.get(rid, ""))})' for rid in works_with
                )
                parts.append(f'<tr><td><strong>Works with</strong></td><td>{refs}</td></tr>')
            parts.append('</tbody></table></div>')
            parts.append('<hr>')

        # Dependent Building Blocks (USES technologies + DEPENDS_ON patterns)
        rels = p.get("relationships", [])
        deps = [r for r in rels if r.get("type") in ("DEPENDS_ON", "USES", "REFERENCES")]
        if deps:
            parts.append('<h2>Dependent Building Blocks</h2>')
            parts.append('<ul>')
            for r in deps:
                target_id = r["target_id"]
                target_name = r.get("target_name", "")
                target_label = r.get("target_label", "")
                if target_label == "Technology":
                    link = self._make_tech_ref_link(target_id, target_name)
                else:
                    link = self._make_ref_link(target_id)
                parts.append(f'<li>{link} ({self._escape(target_name)}) &mdash; {self._escape(r.get("type", ""))}</li>')
            parts.append('</ul>')
            parts.append('<hr>')

        # SBB Mapping
        mapping = p.get("sbb_mapping", [])
        if mapping and isinstance(mapping, list):
            parts.append('<h2>SBB Mapping</h2>')
            parts.append('<ul>')
            for row in mapping:
                if isinstance(row, dict):
                    key = self._escape(row.get("key", ""))
                    val = self._escape(row.get("value", ""))
                    parts.append(f'<li>{key}: {val}</li>')
            parts.append('</ul>')

        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Technology detail
    # ------------------------------------------------------------------

    def _technology_section(self, tech: dict) -> str:
        tid = tech["id"]
        safe_id = self._safe_tech_id(tid)

        parts = [f'<div class="content-section" id="content-{safe_id}">']
        parts.append(f'<div class="breadcrumb"><a href="#" onclick="showIndex();return false;">Overview</a> / {self._escape(tid)}</div>')
        parts.append('<div class="detail">')
        parts.append(f'<h1>{self._escape(tech.get("name", tid))}</h1>')
        parts.append(f'<div class="subtitle">{self._escape(tech.get("vendor", ""))} &middot; Technology</div>')
        parts.append('<div class="tech-banner">Technology Registry Entry</div>')

        # Metadata table
        rows = [
            ("ID", f'<code>{self._escape(tid)}</code>'),
            ("Name", self._escape(tech.get("name", ""))),
            ("Vendor", self._escape(tech.get("vendor", ""))),
            ("Category", self._escape(tech.get("category", ""))),
            ("Status", self._escape(tech.get("status", ""))),
            ("Cost Tier", self._escape(tech.get("cost_tier", ""))),
        ]
        parts.append('<div class="table-wrapper"><table>')
        parts.append('<thead><tr><th>Field</th><th>Value</th></tr></thead>')
        parts.append('<tbody>')
        for label, value in rows:
            if value:
                parts.append(f'<tr><td><strong>{label}</strong></td><td>{value}</td></tr>')
        parts.append('</tbody></table></div>')

        # Description
        desc = tech.get("description")
        if desc:
            parts.append('<hr>')
            parts.append('<h2>Description</h2>')
            parts.append(self._render_text(desc))

        # Notes
        notes = tech.get("notes")
        if notes:
            parts.append('<hr>')
            parts.append('<h2>Notes</h2>')
            parts.append(self._render_text(notes))

        # Used by patterns
        used_by = tech.get("used_by_patterns", [])
        if used_by:
            parts.append('<hr>')
            parts.append('<h2>Used By Patterns</h2>')
            parts.append('<ul>')
            for p in used_by:
                if isinstance(p, dict):
                    ref_id = p.get("id", "")
                    ref_name = p.get("name", "")
                    parts.append(f'<li>{self._make_ref_link(ref_id)} ({self._escape(ref_name)})</li>')
                elif isinstance(p, str):
                    parts.append(f'<li>{self._make_ref_link(p)}</li>')
            parts.append('</ul>')

        # External links
        doc_url = tech.get("doc_url")
        website = tech.get("website")
        if doc_url or website:
            parts.append('<hr>')
            parts.append('<h2>Links</h2>')
            parts.append('<ul>')
            if doc_url:
                parts.append(f'<li><strong>Documentation:</strong> <a href="{self._escape(doc_url)}" target="_blank" style="color:var(--accent)">{self._escape(doc_url)}</a></li>')
            if website:
                parts.append(f'<li><strong>Website:</strong> <a href="{self._escape(website)}" target="_blank" style="color:var(--accent)">{self._escape(website)}</a></li>')
            parts.append('</ul>')

        parts.append('</div></div>')
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # PBC detail
    # ------------------------------------------------------------------

    def _pbc_section(self, pbc: dict) -> str:
        pid = pbc["id"]

        parts = [f'<div class="content-section" id="content-{self._escape(pid)}">']
        parts.append(f'<div class="breadcrumb"><a href="#" onclick="showIndex();return false;">Overview</a> / {self._escape(pid)}</div>')
        parts.append('<div class="detail">')
        parts.append(f'<h1>{self._escape(pbc.get("name", pid))}</h1>')
        parts.append(f'<div class="subtitle">{self._escape(pid)} &middot; Packaged Business Capability</div>')
        parts.append('<div class="pbc-banner">Packaged Business Capability (PBC)</div>')

        # Metadata table
        rows = [
            ("ID", f'<code>{self._escape(pid)}</code>'),
            ("Name", self._escape(pbc.get("name", ""))),
            ("Status", self._escape(pbc.get("status", ""))),
        ]
        api_ep = pbc.get("api_endpoint")
        if api_ep:
            rows.append(("API Endpoint", f'<code>{self._escape(api_ep)}</code>'))

        parts.append('<div class="table-wrapper"><table>')
        parts.append('<thead><tr><th>Field</th><th>Value</th></tr></thead>')
        parts.append('<tbody>')
        for label, value in rows:
            parts.append(f'<tr><td><strong>{label}</strong></td><td>{value}</td></tr>')
        parts.append('</tbody></table></div>')

        # Description
        desc = pbc.get("description")
        if desc:
            parts.append('<hr>')
            parts.append('<h2>Description</h2>')
            parts.append(self._render_text(desc))

        # Composed ABBs
        abb_ids = pbc.get("abb_ids", [])
        if abb_ids:
            parts.append('<hr>')
            parts.append('<h2>Composed ABBs</h2>')
            parts.append('<ul>')
            for abb_id in abb_ids:
                abb_name = self._name_map.get(abb_id, "")
                parts.append(f'<li>{self._make_ref_link(abb_id)} ({self._escape(abb_name)})</li>')
            parts.append('</ul>')

        parts.append('</div></div>')
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # JavaScript
    # ------------------------------------------------------------------

    def _javascript(self) -> str:
        return '''<script>
function toggleGroup(cat) {
    var group = document.getElementById('group-' + cat);
    if (!group) return;
    var header = group.previousElementSibling;
    group.classList.toggle('collapsed');
    if (header) header.classList.toggle('collapsed');
}

function showPattern(id) {
    document.querySelectorAll('.content-section').forEach(function(s) { s.classList.remove('active'); });
    var el = document.getElementById('content-' + id);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-link').forEach(function(l) { l.classList.remove('active'); });
    var navEl = document.getElementById('nav-' + id);
    if (navEl) {
        navEl.classList.add('active');
        navEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    window.scrollTo(0, 0);
    history.pushState(null, '', '#' + id);
}

function showIndex() {
    document.querySelectorAll('.content-section').forEach(function(s) { s.classList.remove('active'); });
    document.getElementById('content-index').classList.add('active');
    document.querySelectorAll('.nav-link').forEach(function(l) { l.classList.remove('active'); });
    document.getElementById('nav-index').classList.add('active');
    window.scrollTo(0, 0);
    history.pushState(null, '', '#');
}

window.addEventListener('popstate', function() {
    var hash = location.hash.replace('#', '');
    if (hash) { showPattern(hash); } else { showIndex(); }
});

window.addEventListener('DOMContentLoaded', function() {
    var hash = location.hash.replace('#', '');
    if (hash) { showPattern(hash); }
});
</script>'''

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _escape(self, text) -> str:
        if text is None:
            return ""
        return html.escape(str(text))

    def _safe_tech_id(self, tech_id: str) -> str:
        return "tech-" + re.sub(r"[^a-zA-Z0-9_-]", "-", str(tech_id))

    def _make_ref_link(self, target_id: str, display_text: str = None) -> str:
        text = display_text or target_id
        escaped_text = self._escape(text)
        escaped_id = self._escape(target_id)
        if target_id in self._pattern_ids or target_id in self._pbc_ids:
            return (
                f'<a href="#" onclick="showPattern(\'{escaped_id}\');return false;" '
                f'class="ref-link">{escaped_text}</a>'
            )
        elif target_id in self._tech_ids:
            safe_id = self._safe_tech_id(target_id)
            return (
                f'<a href="#" onclick="showPattern(\'{safe_id}\');return false;" '
                f'class="ref-link">{escaped_text}</a>'
            )
        return f"<code>{escaped_text}</code>"

    def _make_tech_ref_link(self, tech_id: str, display_text: str = None) -> str:
        text = display_text or tech_id
        safe_id = self._safe_tech_id(tech_id)
        return (
            f'<a href="#" onclick="showPattern(\'{safe_id}\');return false;" '
            f'class="ref-link">{self._escape(text)}</a>'
        )

    def _render_text(self, text: str) -> str:
        """Convert a plain text field to HTML with auto-linked pattern IDs and markdown formatting."""
        if not text:
            return ""
        escaped = self._escape(text)

        # Replace pattern/PBC ID references with clickable links
        def replace_ref(match):
            ref_id = match.group(0)
            if ref_id in self._pattern_ids or ref_id in self._pbc_ids:
                return self._make_ref_link(ref_id)
            return ref_id

        result = re.sub(r"\b(?:ABB|SBB|AB|PBC)-[A-Z]+-\d{3}\b", replace_ref, escaped)

        # Convert **bold** to <strong>bold</strong>
        result = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", result)

        # Parse lines into blocks: tables, lists, paragraphs
        lines = result.split("\n")
        html_parts = []
        in_list = False
        in_table = False
        table_rows = []

        def _flush_table():
            """Convert accumulated table_rows into an HTML table."""
            if not table_rows:
                return ""
            # Find header row (first row) and data rows (skip separator)
            header = table_rows[0]
            data = []
            for row in table_rows[1:]:
                # Skip separator rows (all dashes/pipes/spaces/colons)
                cleaned = row.replace("|", "").replace("-", "").replace(":", "").replace(" ", "")
                if not cleaned:
                    continue
                data.append(row)
            # Parse cells from pipe-delimited rows
            def parse_cells(row_str):
                cells = row_str.split("|")
                # Strip leading/trailing empty cells from outer pipes
                if cells and not cells[0].strip():
                    cells = cells[1:]
                if cells and not cells[-1].strip():
                    cells = cells[:-1]
                return [c.strip() for c in cells]

            header_cells = parse_cells(header)
            parts = ['<div class="table-wrapper"><table>']
            parts.append("<thead><tr>")
            for cell in header_cells:
                parts.append(f"<th>{cell}</th>")
            parts.append("</tr></thead>")
            parts.append("<tbody>")
            for row in data:
                row_cells = parse_cells(row)
                parts.append("<tr>")
                for cell in row_cells:
                    parts.append(f"<td>{cell}</td>")
                parts.append("</tr>")
            parts.append("</tbody></table></div>")
            return "\n".join(parts)

        for line in lines:
            stripped = line.strip()
            is_table_row = stripped.startswith("|") and stripped.endswith("|") and len(stripped) > 2

            if is_table_row:
                # Close any open list first
                if in_list:
                    html_parts.append("</ul>")
                    in_list = False
                in_table = True
                table_rows.append(stripped)
            else:
                # Flush accumulated table rows
                if in_table:
                    html_parts.append(_flush_table())
                    table_rows = []
                    in_table = False

                if stripped.startswith("- ") or stripped.startswith("* "):
                    if not in_list:
                        html_parts.append("<ul>")
                        in_list = True
                    item_text = stripped[2:]
                    html_parts.append(f"<li>{item_text}</li>")
                else:
                    if in_list:
                        html_parts.append("</ul>")
                        in_list = False
                    if stripped:
                        html_parts.append(f"<p>{stripped}</p>")

        # Flush remaining state
        if in_table:
            html_parts.append(_flush_table())
        if in_list:
            html_parts.append("</ul>")

        return "\n".join(html_parts)

    def _render_inline(self, text: str) -> str:
        """Render text inline (no <p> wrapping), with auto-linked refs."""
        if not text:
            return ""
        escaped = self._escape(text)

        def replace_ref(match):
            ref_id = match.group(0)
            if ref_id in self._pattern_ids or ref_id in self._pbc_ids:
                return self._make_ref_link(ref_id)
            return ref_id

        return re.sub(r"\b(?:ABB|SBB|AB|PBC)-[A-Z]+-\d{3}\b", replace_ref, escaped)
