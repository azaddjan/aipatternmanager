"""
One-time migration: parse markdown_content into structured fields for all existing patterns.

Run inside Docker container:
    docker exec pattern-api python migrate_to_structured.py

Idempotent — skips patterns that already have structured fields populated.
"""
import json
import os
import re

from neo4j import GraphDatabase


def get_driver():
    uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "patternmanager2026")
    return GraphDatabase.driver(uri, auth=(user, password))


# ---------- Markdown parsing (mirrors PatternEditor.jsx logic) ----------

def parse_sections(markdown: str) -> dict:
    """Split markdown by ## headers into {header: body} dict."""
    if not markdown:
        return {}
    result = {}
    parts = markdown.split("\n## ")
    for i in range(1, len(parts)):
        newline_idx = parts[i].find("\n")
        if newline_idx < 0:
            continue
        header = parts[i][:newline_idx].strip()
        body = parts[i][newline_idx + 1:]
        body = re.sub(r'\n---\s*$', '', body).strip()
        result[header] = body
    return result


def parse_interfaces(content: str) -> dict:
    if not content:
        return {"inbound": "", "outbound": ""}
    inbound = ""
    outbound = ""
    for line in content.split("\n"):
        in_match = re.search(r'\*\*Inbound:\*\*\s*(.+)', line)
        out_match = re.search(r'\*\*Outbound[^*]*\*\*\s*(.+)', line)
        if in_match:
            inbound = in_match.group(1).strip()
        if out_match:
            outbound = (outbound + "\n" + out_match.group(1).strip()).strip()
    return {"inbound": inbound, "outbound": outbound}


def parse_interoperability(content: str) -> dict:
    if not content:
        return {"consumed_by": [], "works_with": []}
    consumed_by = []
    works_with = []
    pattern_id_re = re.compile(r'\b((?:ABB|SBB|AB)-[\w]+-\d+)\b')
    for line in content.split("\n"):
        ids = pattern_id_re.findall(line)
        if "consumed by" in line.lower():
            consumed_by.extend(ids)
        elif "works with" in line.lower():
            works_with.extend(ids)
    return {"consumed_by": consumed_by, "works_with": works_with}


def parse_business_capabilities(content: str) -> list:
    if not content:
        return []
    caps = []
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("- "):
            cap = line[2:].strip()
            # Strip trailing description after em-dash
            dash_idx = cap.find(" \u2014 ")
            if dash_idx > 0:
                cap = cap[:dash_idx].strip()
            if cap:
                caps.append(cap)
    return caps


def parse_sbb_mapping(content: str) -> list:
    if not content:
        return []
    mappings = []
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("- "):
            text = line[2:]
            colon_idx = text.find(":")
            if colon_idx > 0:
                mappings.append({
                    "key": text[:colon_idx].strip(),
                    "value": text[colon_idx + 1:].strip(),
                })
            else:
                mappings.append({"key": text.strip(), "value": ""})
    return mappings


# ---------- Migration logic ----------

def migrate_pattern(tx, pattern: dict) -> bool:
    """Parse markdown_content and write structured fields. Returns True if migrated."""
    pid = pattern["id"]
    ptype = pattern.get("type", "")
    md = pattern.get("markdown_content", "")

    # Skip if already has structured fields
    if pattern.get("functionality") or pattern.get("specific_functionality") or pattern.get("intent"):
        print(f"  SKIP {pid} — already has structured fields")
        return False

    if not md:
        print(f"  SKIP {pid} — no markdown_content")
        return False

    sections = parse_sections(md)
    updates = {}

    if ptype == "AB":
        updates["intent"] = sections.get("Intent", "")
        updates["problem"] = sections.get("Problem", "")
        updates["solution"] = sections.get("Solution", "")
        updates["structural_elements"] = sections.get("Structural Elements", "")
        updates["invariants"] = sections.get("Invariants", "")
        updates["inter_element_contracts"] = sections.get("Inter-Element Contracts", "")
        updates["related_patterns_text"] = sections.get("Related Patterns", "")
        updates["related_adrs"] = sections.get("Related ADRs", "")
        updates["building_blocks_note"] = sections.get("Note on Building Blocks", "")

    elif ptype == "ABB":
        updates["functionality"] = sections.get("Functionality", "")
        ifaces = parse_interfaces(sections.get("Interfaces", ""))
        updates["inbound_interfaces"] = ifaces["inbound"]
        updates["outbound_interfaces"] = ifaces["outbound"]
        interop = parse_interoperability(sections.get("Interoperability", ""))
        updates["consumed_by_ids"] = interop["consumed_by"]
        updates["works_with_ids"] = interop["works_with"]
        updates["business_capabilities"] = parse_business_capabilities(
            sections.get("Business Capabilities", "")
        )

    elif ptype == "SBB":
        updates["specific_functionality"] = sections.get("Specific Functionality", "")
        ifaces = parse_interfaces(sections.get("Interfaces", ""))
        updates["inbound_interfaces"] = ifaces["inbound"]
        updates["outbound_interfaces"] = ifaces["outbound"]
        interop = parse_interoperability(sections.get("Interoperability", ""))
        updates["consumed_by_ids"] = interop["consumed_by"]
        updates["works_with_ids"] = interop["works_with"]
        updates["sbb_mapping"] = json.dumps(
            parse_sbb_mapping(sections.get("SBB Mapping", ""))
        )

    else:
        print(f"  SKIP {pid} — unknown type '{ptype}'")
        return False

    # Remove empty string values — don't store blank properties
    updates = {k: v for k, v in updates.items() if v}

    if not updates:
        print(f"  SKIP {pid} — no sections parsed from markdown")
        return False

    # Build SET clause
    set_parts = ", ".join(f"p.{k} = ${k}" for k in updates.keys())
    query = f"MATCH (p:Pattern {{id: $pid}}) SET {set_parts}"
    updates["pid"] = pid
    tx.run(query, **updates)
    print(f"  MIGRATED {pid} ({ptype}) — {len(updates) - 1} fields set")
    return True


def main():
    driver = get_driver()
    print("Connecting to Neo4j...")
    driver.verify_connectivity()
    print("Connected. Starting migration...\n")

    with driver.session() as session:
        records = session.run("MATCH (p:Pattern) RETURN p ORDER BY p.id")
        patterns = [dict(r["p"]) for r in records]

    print(f"Found {len(patterns)} patterns to process.\n")
    migrated = 0

    with driver.session() as session:
        for p in patterns:
            with session.begin_transaction() as tx:
                if migrate_pattern(tx, p):
                    migrated += 1
                tx.commit()

    print(f"\nDone. Migrated {migrated} of {len(patterns)} patterns.")
    driver.close()


if __name__ == "__main__":
    main()
