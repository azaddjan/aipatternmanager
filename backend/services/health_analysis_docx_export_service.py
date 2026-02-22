"""Health Analysis DOCX Export Service — generates a Word document for a single health analysis."""
import io
import re
from datetime import datetime

from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml


class HealthAnalysisDocxExportService:
    """Generates a Word document for a single health analysis."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_docx(self, analysis: dict) -> bytes:
        """Generate a DOCX file for a single health analysis and return raw bytes."""
        analysis_json = analysis.get("analysis_json", {})

        doc = Document()
        self._set_styles(doc)
        self._add_cover_page(doc, analysis)

        # If analysis_json is a dict with structured data, render sections
        if isinstance(analysis_json, dict) and "raw_text" not in analysis_json:
            self._add_executive_summary(doc, analysis, analysis_json)
            self._add_assessment_scores(doc, analysis_json)
            self._add_detailed_assessments(doc, analysis_json)
            self._add_gap_analysis(doc, analysis_json)
            self._add_top_recommendations(doc, analysis_json)
        else:
            # Fallback: raw_text key present or analysis_json is a string
            self._add_raw_text_fallback(doc, analysis_json)

        self._add_page_numbers(doc)

        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    # ------------------------------------------------------------------
    # Styles
    # ------------------------------------------------------------------

    def _set_styles(self, doc: Document) -> None:
        """Set Normal style to Calibri 11pt, heading styles with brand colours."""
        style = doc.styles["Normal"]
        font = style.font
        font.name = "Calibri"
        font.size = Pt(11)
        font.color.rgb = RGBColor(0x33, 0x33, 0x33)

        for level in range(1, 4):
            h_style = doc.styles[f"Heading {level}"]
            h_style.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)
            h_style.font.name = "Calibri"

    # ------------------------------------------------------------------
    # Cover page
    # ------------------------------------------------------------------

    def _add_cover_page(self, doc: Document, analysis: dict) -> None:
        """Add a styled cover page with analysis metadata."""
        # Spacer
        for _ in range(6):
            doc.add_paragraph("")

        # Title
        title_para = doc.add_paragraph()
        title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = title_para.add_run("Health Analysis")
        run.bold = True
        run.font.size = Pt(36)
        run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)

        # Subtitle — analysis ID and health score
        subtitle_para = doc.add_paragraph()
        subtitle_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        analysis_id = analysis.get("id", "")
        health_score = analysis.get("health_score")
        subtitle_text = analysis_id
        if health_score is not None:
            subtitle_text += f"  |  Health Score: {health_score}"
        run = subtitle_para.add_run(subtitle_text)
        run.font.size = Pt(18)
        run.font.color.rgb = RGBColor(0x58, 0xA6, 0xFF)

        # Analysis title
        if analysis.get("title"):
            title_name = doc.add_paragraph()
            title_name.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = title_name.add_run(analysis["title"])
            run.font.size = Pt(14)
            run.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

        doc.add_paragraph("")

        # Date
        date_para = doc.add_paragraph()
        date_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        created_at = analysis.get("created_at", "")
        if created_at:
            try:
                dt = datetime.fromisoformat(created_at)
                date_str = dt.strftime("%B %d, %Y")
            except (ValueError, TypeError):
                date_str = datetime.now().strftime("%B %d, %Y")
        else:
            date_str = datetime.now().strftime("%B %d, %Y")
        run = date_para.add_run(date_str)
        run.font.size = Pt(12)
        run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

        doc.add_paragraph("")

        # Provider / model / pattern count info
        provider = analysis.get("provider", "")
        model = analysis.get("model", "")
        pattern_count = analysis.get("pattern_count")

        info_parts = []
        if provider:
            info_parts.append(f"Provider: {provider}")
        if model:
            info_parts.append(f"Model: {model}")
        if pattern_count is not None:
            info_parts.append(f"Patterns Analysed: {pattern_count}")

        if info_parts:
            info_para = doc.add_paragraph()
            info_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = info_para.add_run("  |  ".join(info_parts))
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

        doc.add_page_break()

    # ------------------------------------------------------------------
    # Executive Summary
    # ------------------------------------------------------------------

    def _add_executive_summary(self, doc: Document, analysis: dict, analysis_json: dict) -> None:
        """Add the Executive Summary section with health score, breakdown table, and overview."""
        doc.add_heading("Executive Summary", level=1)

        # Health score prominent display
        health_score = analysis.get("health_score")
        if health_score is not None:
            score_para = doc.add_paragraph()
            run = score_para.add_run("Overall Health Score: ")
            run.bold = True
            run.font.size = Pt(14)
            run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)

            score_run = score_para.add_run(f"{health_score}")
            score_run.bold = True
            score_run.font.size = Pt(14)
            score_color = self._score_color(health_score)
            score_run.font.color.rgb = score_color

            suffix_run = score_para.add_run(" / 100")
            suffix_run.font.size = Pt(14)
            suffix_run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

        # Score breakdown table
        breakdown = analysis.get("score_breakdown_json", {})
        if isinstance(breakdown, dict) and breakdown:
            doc.add_paragraph("")  # spacer

            breakdown_heading = doc.add_paragraph()
            run = breakdown_heading.add_run("Score Breakdown")
            run.bold = True
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)

            table = doc.add_table(rows=1, cols=2)
            table.style = "Light Shading Accent 1"
            table.alignment = WD_TABLE_ALIGNMENT.LEFT

            hdr = table.rows[0].cells
            for i, label in enumerate(["Metric", "Score"]):
                hdr[i].text = label
                for paragraph in hdr[i].paragraphs:
                    for r in paragraph.runs:
                        r.bold = True

            for key, value in breakdown.items():
                row = table.add_row()
                row.cells[0].text = key.replace("_", " ").title()
                row.cells[1].text = f"{value}" if value is not None else "N/A"

            doc.add_paragraph("")  # spacer

        # Overview text
        overview = analysis_json.get("overview", "")
        if overview:
            overview_heading = doc.add_paragraph()
            run = overview_heading.add_run("Overview")
            run.bold = True
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)

            self._add_structured_text(doc, overview)

    # ------------------------------------------------------------------
    # Assessment Scores (summary table)
    # ------------------------------------------------------------------

    def _add_assessment_scores(self, doc: Document, analysis_json: dict) -> None:
        """Add a summary table of all assessment area scores, issues, and suggestions."""
        assessment_areas = [
            ("Naming Consistency", "naming_consistency"),
            ("Category Assessment", "category_assessment"),
            ("Relationship Quality", "relationship_quality"),
            ("Design Quality", "design_quality"),
        ]

        # Only add section if at least one area exists
        has_any = any(analysis_json.get(key) for _, key in assessment_areas)
        if not has_any:
            return

        doc.add_heading("Assessment Scores", level=1)

        table = doc.add_table(rows=1, cols=4)
        table.style = "Light Shading Accent 1"
        table.alignment = WD_TABLE_ALIGNMENT.LEFT

        hdr = table.rows[0].cells
        for i, label in enumerate(["Area", "Score", "Issues", "Suggestions"]):
            hdr[i].text = label
            for paragraph in hdr[i].paragraphs:
                for r in paragraph.runs:
                    r.bold = True

        for area_name, area_key in assessment_areas:
            area_data = analysis_json.get(area_key, {})
            if not isinstance(area_data, dict):
                continue

            row = table.add_row()
            row.cells[0].text = area_name
            row.cells[1].text = area_data.get("score", "N/A")

            issues = area_data.get("issues", [])
            if isinstance(issues, list):
                row.cells[2].text = str(len(issues))
            else:
                row.cells[2].text = "0"

            suggestions = area_data.get("suggestions", [])
            if isinstance(suggestions, list):
                row.cells[3].text = str(len(suggestions))
            else:
                row.cells[3].text = "0"

        doc.add_paragraph("")  # spacer

    # ------------------------------------------------------------------
    # Detailed Assessments
    # ------------------------------------------------------------------

    def _add_detailed_assessments(self, doc: Document, analysis_json: dict) -> None:
        """Add detailed breakdown for each assessment area with issues and suggestions bullets."""
        assessment_areas = [
            ("Naming Consistency", "naming_consistency"),
            ("Category Assessment", "category_assessment"),
            ("Relationship Quality", "relationship_quality"),
            ("Design Quality", "design_quality"),
        ]

        has_any = any(analysis_json.get(key) for _, key in assessment_areas)
        if not has_any:
            return

        doc.add_heading("Detailed Assessments", level=1)

        for area_name, area_key in assessment_areas:
            area_data = analysis_json.get(area_key, {})
            if not isinstance(area_data, dict):
                continue

            doc.add_heading(area_name, level=2)

            # Score line
            score = area_data.get("score", "")
            if score:
                score_para = doc.add_paragraph()
                run = score_para.add_run("Score: ")
                run.bold = True
                run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)

                score_run = score_para.add_run(score)
                score_run.bold = True
                score_run.font.color.rgb = self._assessment_score_color(score)

            # Balanced flag (specific to category_assessment)
            if area_key == "category_assessment" and "balanced" in area_data:
                balanced = area_data["balanced"]
                balanced_para = doc.add_paragraph()
                run = balanced_para.add_run("Balanced: ")
                run.bold = True
                balanced_para.add_run("Yes" if balanced else "No")

            # Issues
            issues = area_data.get("issues", [])
            if isinstance(issues, list) and issues:
                issues_heading = doc.add_paragraph()
                run = issues_heading.add_run("Issues")
                run.bold = True
                run.font.size = Pt(11)
                run.font.color.rgb = RGBColor(0xCC, 0x33, 0x33)

                for issue in issues:
                    doc.add_paragraph(str(issue), style="List Bullet")

            # Suggestions
            suggestions = area_data.get("suggestions", [])
            if isinstance(suggestions, list) and suggestions:
                suggestions_heading = doc.add_paragraph()
                run = suggestions_heading.add_run("Suggestions")
                run.bold = True
                run.font.size = Pt(11)
                run.font.color.rgb = RGBColor(0x22, 0x88, 0x22)

                for suggestion in suggestions:
                    doc.add_paragraph(str(suggestion), style="List Bullet")

            doc.add_paragraph("")  # spacer between areas

    # ------------------------------------------------------------------
    # Gap Analysis
    # ------------------------------------------------------------------

    def _add_gap_analysis(self, doc: Document, analysis_json: dict) -> None:
        """Add Gap Analysis section with table of suggested patterns."""
        gap_data = analysis_json.get("gap_analysis", {})
        if not isinstance(gap_data, dict):
            return

        missing_patterns = gap_data.get("missing_patterns", [])
        if not isinstance(missing_patterns, list) or not missing_patterns:
            return

        doc.add_heading("Gap Analysis", level=1)

        table = doc.add_table(rows=1, cols=4)
        table.style = "Light Shading Accent 1"
        table.alignment = WD_TABLE_ALIGNMENT.LEFT

        hdr = table.rows[0].cells
        for i, label in enumerate(["Suggested Pattern", "Type", "Category", "Rationale"]):
            hdr[i].text = label
            for paragraph in hdr[i].paragraphs:
                for r in paragraph.runs:
                    r.bold = True

        for pattern in missing_patterns:
            if not isinstance(pattern, dict):
                continue
            row = table.add_row()
            row.cells[0].text = pattern.get("name", "")
            row.cells[1].text = pattern.get("type", "")
            row.cells[2].text = pattern.get("category", "")
            row.cells[3].text = pattern.get("why", "")

        doc.add_paragraph("")  # spacer

    # ------------------------------------------------------------------
    # Top Recommendations
    # ------------------------------------------------------------------

    def _add_top_recommendations(self, doc: Document, analysis_json: dict) -> None:
        """Add Top Recommendations as a numbered list with priority, title, description, and effort."""
        recommendations = analysis_json.get("top_recommendations", [])
        if not isinstance(recommendations, list) or not recommendations:
            return

        doc.add_heading("Top Recommendations", level=1)

        for rec in recommendations:
            if not isinstance(rec, dict):
                continue

            priority = rec.get("priority", "")
            title = rec.get("title", "")
            description = rec.get("description", "")
            effort = rec.get("effort", "")

            # Numbered heading line: "1. Title"
            rec_para = doc.add_paragraph()
            header_run = rec_para.add_run(f"{priority}. {title}")
            header_run.bold = True
            header_run.font.size = Pt(12)
            header_run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)

            # Description
            if description:
                doc.add_paragraph(description)

            # Effort level
            if effort:
                effort_para = doc.add_paragraph()
                run = effort_para.add_run("Effort: ")
                run.bold = True
                run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)

                effort_run = effort_para.add_run(effort)
                effort_run.bold = True
                effort_run.font.color.rgb = self._effort_color(effort)

            doc.add_paragraph("")  # spacer between recommendations

    # ------------------------------------------------------------------
    # Raw text fallback
    # ------------------------------------------------------------------

    def _add_raw_text_fallback(self, doc: Document, analysis_json) -> None:
        """Fallback when analysis_json contains raw_text instead of structured data."""
        doc.add_heading("Analysis", level=1)

        if isinstance(analysis_json, dict):
            raw_text = analysis_json.get("raw_text", "")
        elif isinstance(analysis_json, str):
            raw_text = analysis_json
        else:
            raw_text = str(analysis_json)

        if raw_text:
            self._add_structured_text(doc, raw_text)
        else:
            doc.add_paragraph("No analysis data available.")

    # ------------------------------------------------------------------
    # Page numbers
    # ------------------------------------------------------------------

    def _add_page_numbers(self, doc: Document) -> None:
        """Add centered page numbers to the footer."""
        section = doc.sections[0]
        footer = section.footer
        footer.is_linked_to_previous = False
        paragraph = footer.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

        run = paragraph.add_run()
        fldChar1 = parse_xml(
            r'<w:fldChar {} w:fldCharType="begin"/>'.format(nsdecls('w'))
        )
        run._r.append(fldChar1)

        run2 = paragraph.add_run()
        instrText = parse_xml(
            r'<w:instrText {} xml:space="preserve"> PAGE </w:instrText>'.format(nsdecls('w'))
        )
        run2._r.append(instrText)

        run3 = paragraph.add_run()
        fldChar2 = parse_xml(
            r'<w:fldChar {} w:fldCharType="end"/>'.format(nsdecls('w'))
        )
        run3._r.append(fldChar2)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _add_structured_text(self, doc: Document, text: str) -> None:
        """Add text to the document, handling markdown lists, bold, and tables."""
        if not text:
            return

        lines = text.split("\n")
        in_table = False
        table_rows = []

        for line in lines:
            stripped = line.strip()
            is_table_row = stripped.startswith("|") and stripped.endswith("|") and len(stripped) > 2

            if is_table_row:
                # Skip separator rows (lines like |---|---|)
                cleaned = stripped.replace("|", "").replace("-", "").replace(":", "").replace(" ", "")
                if cleaned:
                    table_rows.append(stripped)
                in_table = True
            else:
                if in_table and table_rows:
                    self._flush_table_to_doc(doc, table_rows)
                    table_rows = []
                    in_table = False

                if stripped.startswith("- ") or stripped.startswith("* "):
                    item_text = stripped[2:]
                    self._apply_bold_runs_to_paragraph(doc, item_text, style="List Bullet")
                elif stripped.startswith("### "):
                    doc.add_heading(stripped[4:], level=3)
                elif stripped.startswith("## "):
                    doc.add_heading(stripped[3:], level=2)
                elif stripped.startswith("# "):
                    doc.add_heading(stripped[2:], level=1)
                elif stripped:
                    self._apply_bold_runs_to_paragraph(doc, stripped)

        # Flush remaining table
        if table_rows:
            self._flush_table_to_doc(doc, table_rows)

    def _apply_bold_runs_to_paragraph(self, doc: Document, text: str, style: str = None) -> None:
        """Create a paragraph with bold runs for **text** segments."""
        if style:
            para = doc.add_paragraph(style=style)
        else:
            para = doc.add_paragraph()

        # Split on bold markers: **bold text**
        parts = re.split(r'(\*\*.+?\*\*)', text)
        for part in parts:
            if part.startswith("**") and part.endswith("**"):
                run = para.add_run(part[2:-2])
                run.bold = True
            else:
                para.add_run(part)

    def _flush_table_to_doc(self, doc: Document, rows: list) -> None:
        """Convert markdown table rows into a Word table."""
        if not rows:
            return

        def parse_cells(row_str: str) -> list:
            cells = row_str.split("|")
            if cells and not cells[0].strip():
                cells = cells[1:]
            if cells and not cells[-1].strip():
                cells = cells[:-1]
            return [c.strip() for c in cells]

        header_cells = parse_cells(rows[0])
        col_count = len(header_cells)
        if col_count == 0:
            return

        table = doc.add_table(rows=1, cols=col_count)
        table.style = "Light Shading Accent 1"

        # Header row
        hdr = table.rows[0].cells
        for i, cell in enumerate(header_cells):
            if i < col_count:
                clean = re.sub(r'\*\*(.+?)\*\*', r'\1', cell)
                hdr[i].text = clean
                for paragraph in hdr[i].paragraphs:
                    for run in paragraph.runs:
                        run.bold = True

        # Data rows
        for row_str in rows[1:]:
            row_cells = parse_cells(row_str)
            row = table.add_row()
            for i, cell in enumerate(row_cells):
                if i < col_count:
                    clean = re.sub(r'\*\*(.+?)\*\*', r'\1', cell)
                    row.cells[i].text = clean

        doc.add_paragraph("")  # spacer after table

    def _score_color(self, score) -> RGBColor:
        """Return a colour based on the numeric health score (0-100)."""
        try:
            score = float(score)
        except (ValueError, TypeError):
            return RGBColor(0x88, 0x88, 0x88)

        if score >= 75:
            return RGBColor(0x22, 0x88, 0x22)  # green
        elif score >= 50:
            return RGBColor(0xDD, 0x99, 0x00)  # amber
        else:
            return RGBColor(0xCC, 0x33, 0x33)  # red

    def _assessment_score_color(self, score_label: str) -> RGBColor:
        """Return a colour based on a GOOD/FAIR/POOR label."""
        label = str(score_label).upper()
        if label == "GOOD":
            return RGBColor(0x22, 0x88, 0x22)  # green
        elif label == "FAIR":
            return RGBColor(0xDD, 0x99, 0x00)  # amber
        elif label == "POOR":
            return RGBColor(0xCC, 0x33, 0x33)  # red
        else:
            return RGBColor(0x88, 0x88, 0x88)  # grey

    def _effort_color(self, effort_label: str) -> RGBColor:
        """Return a colour based on a LOW/MEDIUM/HIGH effort label."""
        label = str(effort_label).upper()
        if label == "LOW":
            return RGBColor(0x22, 0x88, 0x22)  # green
        elif label == "MEDIUM":
            return RGBColor(0xDD, 0x99, 0x00)  # amber
        elif label == "HIGH":
            return RGBColor(0xCC, 0x33, 0x33)  # red
        else:
            return RGBColor(0x88, 0x88, 0x88)  # grey
