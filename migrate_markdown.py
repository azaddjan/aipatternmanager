#!/usr/bin/env python3
"""
Migration script: Regenerate pattern markdown with new section format.
- Adds "## Depending Technology" section for ABBs and SBBs
- Ensures consistent section ordering
"""
import json
import os
import re
import requests

API = os.getenv("API_URL", "http://localhost:8000/api")


def get_all_patterns():
    res = requests.get(f"{API}/patterns?limit=500")
    res.raise_for_status()
    return res.json()["patterns"]


def get_pattern(pid):
    res = requests.get(f"{API}/patterns/{pid}")
    res.raise_for_status()
    return res.json()


def get_technologies():
    res = requests.get(f"{API}/technologies")
    res.raise_for_status()
    return {t["id"]: t["name"] for t in res.json()["technologies"]}


def get_all_patterns_map():
    patterns = get_all_patterns()
    return {p["id"]: p["name"] for p in patterns}


def parse_sections(markdown):
    """Split markdown into header + ordered sections."""
    if not markdown:
        return "", []

    parts = markdown.split("\n## ")
    header = parts[0].rstrip()
    # Strip ALL trailing --- separators from header (handles repeated runs)
    while re.search(r'\n---\s*$', header):
        header = re.sub(r'\n---\s*$', '', header).rstrip()
    # Remove Template Version line (e.g. > **SBB Template Version:** ...)
    header = re.sub(r'\n> \*\*(?:SBB|ABB) Template Version:\*\*[^\n]*\n?', '\n', header).rstrip()
    sections = []
    for i in range(1, len(parts)):
        newline_idx = parts[i].find("\n")
        if newline_idx < 0:
            continue
        name = parts[i][:newline_idx].strip()
        body = parts[i][newline_idx + 1:].rstrip()
        # Remove trailing --- separator
        body = re.sub(r'\n---\s*$', '', body).rstrip()
        sections.append((name, body))
    return header, sections


def build_depending_tech_section(pattern, tech_map):
    """Build Depending Technology section from USES relationships."""
    rels = pattern.get("relationships", [])
    uses_rels = [r for r in rels if r["type"] == "USES" and r.get("target_label") == "Technology"]

    if uses_rels:
        lines = []
        for r in uses_rels:
            name = tech_map.get(r["target_id"], r["target_id"])
            lines.append(f"- {name}")
        return "\n".join(lines)
    else:
        return "None"


def build_compatible_tech_section(pattern, tech_map):
    """Build Compatible Technologies section from COMPATIBLE_WITH relationships."""
    rels = pattern.get("relationships", [])
    compat_rels = [r for r in rels if r["type"] == "COMPATIBLE_WITH" and r.get("target_label") == "Technology"]

    if compat_rels:
        lines = []
        for r in compat_rels:
            name = tech_map.get(r["target_id"], r["target_id"])
            lines.append(f"- {name}")
        return "\n".join(lines)
    else:
        return "None"


def build_deps_section(pattern, pattern_map, section_name):
    """Build Dependencies/Dependent Building Blocks from DEPENDS_ON relationships."""
    rels = pattern.get("relationships", [])
    deps = [r for r in rels if r["type"] == "DEPENDS_ON" and r.get("target_label") == "Pattern"]

    if deps:
        lines = []
        for r in deps:
            name = pattern_map.get(r["target_id"], "")
            if name:
                lines.append(f"- {r['target_id']} ({name})")
            else:
                lines.append(f"- {r['target_id']}")
        return "\n".join(lines)
    else:
        return "None"


def reconstruct_abb_markdown(pattern, header, sections_list, tech_map, pattern_map):
    """Reconstruct ABB markdown with new section order."""
    sections = dict(sections_list)

    md = header.rstrip() + "\n\n---\n\n"

    # ABB section order: Functionality, Interfaces, Interoperability, Depending Technology, Dependencies, Business Capabilities

    # Functionality
    func = sections.get("Functionality", "").strip()
    if func:
        md += f"## Functionality\n\n{func}\n\n---\n\n"

    # Interfaces
    iface = sections.get("Interfaces", "").strip()
    if iface:
        md += f"## Interfaces\n\n{iface}\n\n---\n\n"

    # Interoperability
    interop = sections.get("Interoperability", "").strip()
    if interop:
        md += f"## Interoperability\n\n{interop}\n\n---\n\n"

    # Depending Technology (core)
    tech_content = build_depending_tech_section(pattern, tech_map)
    md += f"## Depending Technology\n\n{tech_content}\n\n---\n\n"

    # Compatible Technologies
    compat_content = build_compatible_tech_section(pattern, tech_map)
    md += f"## Compatible Technologies\n\n{compat_content}\n\n---\n\n"

    # Dependencies
    deps_content = build_deps_section(pattern, pattern_map, "Dependencies")
    md += f"## Dependencies\n\n{deps_content}\n\n---\n\n"

    # Business Capabilities
    biz = sections.get("Business Capabilities", "").strip()
    if biz:
        md += f"## Business Capabilities\n\n{biz}\n"

    return md.rstrip() + "\n"


def reconstruct_sbb_markdown(pattern, header, sections_list, tech_map, pattern_map):
    """Reconstruct SBB markdown with new section order."""
    sections = dict(sections_list)

    md = header.rstrip() + "\n\n---\n\n"

    # SBB section order: Specific Functionality, Interfaces, Interoperability, Depending Technology, Dependent Building Blocks, SBB Mapping

    # Specific Functionality
    func = sections.get("Specific Functionality", "").strip()
    if func:
        md += f"## Specific Functionality\n\n{func}\n\n---\n\n"

    # Interfaces
    iface = sections.get("Interfaces", "").strip()
    if iface:
        md += f"## Interfaces\n\n{iface}\n\n---\n\n"

    # Interoperability
    interop = sections.get("Interoperability", "").strip()
    if interop:
        md += f"## Interoperability\n\n{interop}\n\n---\n\n"

    # Depending Technology (core)
    tech_content = build_depending_tech_section(pattern, tech_map)
    md += f"## Depending Technology\n\n{tech_content}\n\n---\n\n"

    # Compatible Technologies
    compat_content = build_compatible_tech_section(pattern, tech_map)
    md += f"## Compatible Technologies\n\n{compat_content}\n\n---\n\n"

    # Dependent Building Blocks
    deps_content = build_deps_section(pattern, pattern_map, "Dependent Building Blocks")
    md += f"## Dependent Building Blocks\n\n{deps_content}\n\n---\n\n"

    # SBB Mapping
    sbb_map = sections.get("SBB Mapping", "").strip()
    if sbb_map:
        md += f"## SBB Mapping\n\n{sbb_map}\n"

    return md.rstrip() + "\n"


def update_pattern(pid, markdown):
    """PUT updated markdown back to API."""
    res = requests.put(
        f"{API}/patterns/{pid}?version_bump=none",
        json={"markdown_content": markdown},
        headers={"Content-Type": "application/json"},
    )
    res.raise_for_status()
    return res.json()


def main():
    print("Loading technologies...")
    tech_map = get_technologies()
    print(f"  Found {len(tech_map)} technologies")

    print("Loading all patterns...")
    pattern_map = get_all_patterns_map()
    print(f"  Found {len(pattern_map)} patterns")

    patterns = get_all_patterns()

    updated = 0
    skipped = 0

    for p_summary in patterns:
        pid = p_summary["id"]
        ptype = p_summary["type"]

        # Skip AB type — different structure
        if ptype == "AB":
            print(f"  SKIP {pid} (AB type)")
            skipped += 1
            continue

        print(f"  Processing {pid} ({ptype})...")
        pattern = get_pattern(pid)

        header, sections_list = parse_sections(pattern.get("markdown_content", ""))

        if ptype == "ABB":
            new_md = reconstruct_abb_markdown(pattern, header, sections_list, tech_map, pattern_map)
        else:  # SBB
            new_md = reconstruct_sbb_markdown(pattern, header, sections_list, tech_map, pattern_map)

        # Update via API
        update_pattern(pid, new_md)
        print(f"    Updated {pid}")
        updated += 1

    print(f"\nDone! Updated: {updated}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
