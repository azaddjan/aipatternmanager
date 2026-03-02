#!/usr/bin/env python3
"""
Migration: Enrich missing pattern information.

Fixes:
1. SBB-CORE-004 — fix markdown header (SBB-INTG-007 → SBB-CORE-004), add relationships
2. All SBBs — ensure complete USES/COMPATIBLE_WITH technology coverage
3. Regenerate markdown sections for Depending Technology and Compatible Technologies
"""
import os
import re
import requests

API = os.getenv("API_URL", "http://localhost:8000/api")

# ---------------------------------------------------------------------------
# Complete desired state for ALL SBB technology relationships
# ---------------------------------------------------------------------------
DESIRED_STATE = {
    "SBB-AGT-001": {
        "uses": ["aws-bedrock"],
        "compat": ["aws-api-gateway", "aws-eks", "aws-lambda", "aws-s3", "aws-step-functions"],
    },
    "SBB-AGT-002": {
        "uses": ["aws-eks"],
        "compat": ["aws-bedrock", "aws-lambda", "azure-openai", "crewai", "dynamodb",
                   "langgraph", "litellm", "redis"],
    },
    "SBB-AGT-003": {
        "uses": ["salesforce-agentforce"],
        "compat": [],
    },
    "SBB-AGT-004": {
        "uses": ["ms-copilot-studio"],
        "compat": ["azure-openai"],
    },
    "SBB-CORE-001": {
        "uses": ["aws-bedrock", "aws-eks"],
        "compat": ["aws-s3", "opentelemetry"],
    },
    "SBB-CORE-002": {
        "uses": ["litellm", "aws-eks"],
        "compat": ["aws-bedrock", "aws-lambda", "azure-openai"],
    },
    "SBB-CORE-003": {
        "uses": ["aws-bedrock", "aws-lambda"],
        "compat": ["aws-api-gateway", "aws-eventbridge", "aws-s3", "aws-sqs", "aws-step-functions"],
    },
    "SBB-CORE-004": {
        "uses": ["aws-ec2"],
        "compat": ["vllm", "tgi", "onnx-runtime"],
        "implements": "ABB-INTG-001",
    },
    "SBB-INTG-001": {
        "uses": ["aws-bedrock"],
        "compat": ["aws-cloudtrail"],
    },
    "SBB-INTG-002": {
        "uses": ["aws-bedrock", "aws-eks"],
        "compat": ["litellm", "opentelemetry"],
    },
    "SBB-INTG-003": {
        "uses": ["litellm", "aws-eks"],
        "compat": ["aws-bedrock", "azure-openai", "tgi", "vllm"],
    },
    "SBB-INTG-004": {
        "uses": ["aws-eks", "vllm"],
        "compat": ["tgi", "aws-ec2"],
    },
    "SBB-INTG-005": {
        "uses": ["aws-eks"],
        "compat": ["aws-aurora-pg", "aws-bedrock", "aws-opensearch", "onnx-runtime"],
    },
    "SBB-INTG-006": {
        "uses": ["aws-eks"],
        "compat": ["aws-s3", "onnx-runtime", "aws-ec2"],
    },
    "SBB-INTG-007": {
        "uses": ["aws-bedrock"],
        "compat": ["aws-api-gateway", "aws-cloudtrail", "aws-lambda"],
    },
    "SBB-INTG-008": {
        "uses": ["aws-eks"],
        "compat": ["aws-bedrock"],
    },
    "SBB-KR-001": {
        "uses": ["aws-eks"],
        "compat": ["aws-aurora-pg", "aws-bedrock", "aws-lambda", "aws-opensearch", "aws-s3", "litellm"],
    },
    "SBB-KR-002": {
        "uses": ["aws-bedrock"],
        "compat": ["aws-aurora-pg", "aws-opensearch", "aws-s3", "redis"],
    },
    "SBB-KR-003": {
        "uses": ["aws-kendra"],
        "compat": ["aws-bedrock", "aws-lambda", "aws-s3"],
    },
    "SBB-KR-004": {
        "uses": ["aws-opensearch", "aws-s3"],
        "compat": ["aws-aurora-pg", "aws-lambda", "aws-bedrock", "redis"],
    },
    "SBB-XCUT-001": {
        "uses": ["aws-bedrock"],
        "compat": [],
    },
    "SBB-XCUT-002": {
        "uses": ["aws-bedrock"],
        "compat": ["aws-lambda", "azure-openai", "tgi", "vllm"],
    },
}

# ---------------------------------------------------------------------------
# SBB-CORE-004 replacement markdown (header was wrong — said SBB-INTG-007)
# ---------------------------------------------------------------------------
SBB_CORE_004_MARKDOWN = """# SBB-CORE-004

| Field       | Value                                   |
|-------------|-----------------------------------------|
| **ID**      | SBB-CORE-004                            |
| **Name**    | EC2 GPU LLM Server                      |
| **Version** | 1.0.0                                   |
| **Status**  | DRAFT                                   |
| **ABB Ref** | ABB-INTG-001 (Model Gateway)            |
| **Owner**   | Enterprise AI Architect                 |

---

## Specific Functionality

Self-hosted LLM serving on EC2 GPU instances for workloads that require bare-metal GPU access, custom CUDA configurations, or dedicated instance capacity outside of Kubernetes. Targets teams that need GPU-accelerated inference without EKS cluster overhead:

- **Bare-metal GPU access** — direct access to NVIDIA A100, H100, L4 GPUs on p4d, p5, g5, g6 instance types without Kubernetes abstraction layer
- **LLM inference serving** — deploy open-weight models (LLaMA, Mistral, Falcon, Phi) via vLLM or Text Generation Inference (TGI) with OpenAI-compatible API
- **Custom CUDA/driver configuration** — full control over CUDA toolkit versions, GPU driver versions, and runtime settings for specialized workloads
- **Instance-level scaling** — Auto Scaling Groups with GPU-aware launch templates for horizontal scaling based on GPU utilization or request queue depth
- **Cost optimization** — Reserved Instances or Savings Plans for predictable GPU workloads at 40-60% lower cost than on-demand; Spot Instances for fault-tolerant batch inference

---

## Interfaces

- **Inbound:** OpenAI-compatible REST API (served by vLLM or TGI on port 8000/8080)
- **Outbound:** None — this is the model execution layer

---

## Interoperability

| Relationship    | References                                                          |
|-----------------|---------------------------------------------------------------------|
| **Consumed by** | LLM Gateway (SBB-INTG-003), Prompt Engineering (SBB-CORE-002)     |
| **Works with**  | ApplyGuardrail API (SBB-XCUT-002)                                  |

---

## Depending Technology

- AWS EC2

---

## Compatible Technologies

- vLLM
- Text Generation Inference
- ONNX Runtime

---

## Dependent Building Blocks

None

---

## SBB Mapping

- Runtime: Amazon EC2 (GPU instances — p4d, p5, g5, g6)
- Inference Engine: vLLM or Text Generation Inference (TGI)
- Model Source: Hugging Face Hub, Amazon S3, internal model registry
- API: OpenAI-compatible chat/completions endpoint
- Scaling: EC2 Auto Scaling Groups with GPU utilization metrics
"""


# ---------------------------------------------------------------------------
# Helpers (reused from migrate_markdown.py)
# ---------------------------------------------------------------------------
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
    while re.search(r'\n---\s*$', header):
        header = re.sub(r'\n---\s*$', '', header).rstrip()
    header = re.sub(r'\n> \*\*(?:SBB|ABB) Template Version:\*\*[^\n]*\n?', '\n', header).rstrip()
    sections = []
    for i in range(1, len(parts)):
        newline_idx = parts[i].find("\n")
        if newline_idx < 0:
            continue
        name = parts[i][:newline_idx].strip()
        body = parts[i][newline_idx + 1:].rstrip()
        body = re.sub(r'\n---\s*$', '', body).rstrip()
        sections.append((name, body))
    return header, sections


def build_depending_tech_section(pattern, tech_map):
    rels = pattern.get("relationships", [])
    uses_rels = [r for r in rels if r["type"] == "USES" and r.get("target_label") == "Technology"]
    if uses_rels:
        return "\n".join(f"- {tech_map.get(r['target_id'], r['target_id'])}" for r in uses_rels)
    return "None"


def build_compatible_tech_section(pattern, tech_map):
    rels = pattern.get("relationships", [])
    compat_rels = [r for r in rels if r["type"] == "COMPATIBLE_WITH" and r.get("target_label") == "Technology"]
    if compat_rels:
        return "\n".join(f"- {tech_map.get(r['target_id'], r['target_id'])}" for r in compat_rels)
    return "None"


def build_deps_section(pattern, pattern_map, section_name):
    rels = pattern.get("relationships", [])
    deps = [r for r in rels if r["type"] == "DEPENDS_ON" and r.get("target_label") == "Pattern"]
    if deps:
        lines = []
        for r in deps:
            name = pattern_map.get(r["target_id"], "")
            lines.append(f"- {r['target_id']} ({name})" if name else f"- {r['target_id']}")
        return "\n".join(lines)
    return "None"


def reconstruct_abb_markdown(pattern, header, sections_list, tech_map, pattern_map):
    sections = dict(sections_list)
    md = header.rstrip() + "\n\n---\n\n"
    func = sections.get("Functionality", "").strip()
    if func:
        md += f"## Functionality\n\n{func}\n\n---\n\n"
    iface = sections.get("Interfaces", "").strip()
    if iface:
        md += f"## Interfaces\n\n{iface}\n\n---\n\n"
    interop = sections.get("Interoperability", "").strip()
    if interop:
        md += f"## Interoperability\n\n{interop}\n\n---\n\n"
    md += f"## Depending Technology\n\n{build_depending_tech_section(pattern, tech_map)}\n\n---\n\n"
    md += f"## Compatible Technologies\n\n{build_compatible_tech_section(pattern, tech_map)}\n\n---\n\n"
    md += f"## Dependencies\n\n{build_deps_section(pattern, pattern_map, 'Dependencies')}\n\n---\n\n"
    biz = sections.get("Business Capabilities", "").strip()
    if biz:
        md += f"## Business Capabilities\n\n{biz}\n"
    return md.rstrip() + "\n"


def reconstruct_sbb_markdown(pattern, header, sections_list, tech_map, pattern_map):
    sections = dict(sections_list)
    md = header.rstrip() + "\n\n---\n\n"
    func = sections.get("Specific Functionality", "").strip()
    if func:
        md += f"## Specific Functionality\n\n{func}\n\n---\n\n"
    iface = sections.get("Interfaces", "").strip()
    if iface:
        md += f"## Interfaces\n\n{iface}\n\n---\n\n"
    interop = sections.get("Interoperability", "").strip()
    if interop:
        md += f"## Interoperability\n\n{interop}\n\n---\n\n"
    md += f"## Depending Technology\n\n{build_depending_tech_section(pattern, tech_map)}\n\n---\n\n"
    md += f"## Compatible Technologies\n\n{build_compatible_tech_section(pattern, tech_map)}\n\n---\n\n"
    md += f"## Dependent Building Blocks\n\n{build_deps_section(pattern, pattern_map, 'Dependent Building Blocks')}\n\n---\n\n"
    sbb_map = sections.get("SBB Mapping", "").strip()
    if sbb_map:
        md += f"## SBB Mapping\n\n{sbb_map}\n"
    return md.rstrip() + "\n"


def update_pattern(pid, payload):
    """PUT updated pattern data."""
    res = requests.put(
        f"{API}/patterns/{pid}?version_bump=none",
        json=payload,
        headers={"Content-Type": "application/json"},
    )
    res.raise_for_status()
    return res.json()


# ---------------------------------------------------------------------------
# Phase 1: Fix SBB-CORE-004
# ---------------------------------------------------------------------------
def fix_sbb_core_004():
    print("\n=== Phase 1: Fix SBB-CORE-004 ===")
    pid = "SBB-CORE-004"
    state = DESIRED_STATE[pid]

    payload = {
        "markdown_content": SBB_CORE_004_MARKDOWN.strip() + "\n",
        "implements_abb": state["implements"],
        "technology_ids": state["uses"],
        "compatible_tech_ids": state["compat"],
    }
    update_pattern(pid, payload)
    print(f"  Fixed {pid}: markdown, IMPLEMENTS→ABB-INTG-001, USES→{state['uses']}, COMPAT→{state['compat']}")


# ---------------------------------------------------------------------------
# Phase 2: Update ALL SBB technology relationships
# ---------------------------------------------------------------------------
def update_all_tech_relationships():
    print("\n=== Phase 2: Update SBB technology relationships ===")

    changed = 0
    unchanged = 0

    for pid, desired in sorted(DESIRED_STATE.items()):
        if pid == "SBB-CORE-004":
            continue  # already handled in Phase 1

        # Get current state
        pattern = get_pattern(pid)
        rels = pattern.get("relationships", [])
        current_uses = sorted([r["target_id"] for r in rels if r["type"] == "USES" and r.get("target_label") == "Technology"])
        current_compat = sorted([r["target_id"] for r in rels if r["type"] == "COMPATIBLE_WITH" and r.get("target_label") == "Technology"])

        desired_uses = sorted(desired["uses"])
        desired_compat = sorted(desired["compat"])

        if current_uses == desired_uses and current_compat == desired_compat:
            print(f"  {pid}: no changes needed")
            unchanged += 1
            continue

        # Build update payload
        payload = {
            "technology_ids": desired["uses"],
            "compatible_tech_ids": desired["compat"],
        }
        update_pattern(pid, payload)

        # Report changes
        added_uses = set(desired["uses"]) - set(current_uses)
        removed_uses = set(current_uses) - set(desired["uses"])
        added_compat = set(desired["compat"]) - set(current_compat)
        removed_compat = set(current_compat) - set(desired["compat"])

        changes = []
        if added_uses:
            changes.append(f"+USES: {', '.join(sorted(added_uses))}")
        if removed_uses:
            changes.append(f"-USES: {', '.join(sorted(removed_uses))}")
        if added_compat:
            changes.append(f"+COMPAT: {', '.join(sorted(added_compat))}")
        if removed_compat:
            changes.append(f"-COMPAT: {', '.join(sorted(removed_compat))}")

        print(f"  {pid}: {'; '.join(changes)}")
        changed += 1

    print(f"\n  Summary: {changed} updated, {unchanged} unchanged")


# ---------------------------------------------------------------------------
# Phase 3: Regenerate markdown sections
# ---------------------------------------------------------------------------
def regenerate_markdown():
    print("\n=== Phase 3: Regenerate markdown sections ===")

    tech_map = get_technologies()
    pattern_map = get_all_patterns_map()
    patterns = get_all_patterns()

    updated = 0
    for p_summary in sorted(patterns, key=lambda x: x["id"]):
        pid = p_summary["id"]
        ptype = p_summary["type"]

        if ptype == "AB":
            continue

        # Fetch fresh pattern data (with updated relationships)
        pattern = get_pattern(pid)
        header, sections_list = parse_sections(pattern.get("markdown_content", ""))

        if ptype == "ABB":
            new_md = reconstruct_abb_markdown(pattern, header, sections_list, tech_map, pattern_map)
        else:
            new_md = reconstruct_sbb_markdown(pattern, header, sections_list, tech_map, pattern_map)

        update_pattern(pid, {"markdown_content": new_md})
        print(f"  {pid}: markdown regenerated")
        updated += 1

    print(f"\n  Regenerated {updated} patterns")


# ---------------------------------------------------------------------------
# Phase 4: Verify & report
# ---------------------------------------------------------------------------
def verify():
    print("\n=== Phase 4: Verification ===")

    # Check all techs have at least one link
    tech_map = get_technologies()
    patterns = get_all_patterns()
    used_techs = set()

    for p_summary in patterns:
        if p_summary["type"] == "AB":
            continue
        pattern = get_pattern(p_summary["id"])
        for r in pattern.get("relationships", []):
            if r["type"] in ("USES", "COMPATIBLE_WITH") and r.get("target_label") == "Technology":
                used_techs.add(r["target_id"])

    orphaned = set(tech_map.keys()) - used_techs
    if orphaned:
        print(f"  WARNING: {len(orphaned)} orphaned technologies: {', '.join(sorted(orphaned))}")
    else:
        print(f"  All {len(tech_map)} technologies have at least one relationship")

    # Check SBB-CORE-004
    p = get_pattern("SBB-CORE-004")
    rels = p.get("relationships", [])
    impl = [r for r in rels if r["type"] == "IMPLEMENTS"]
    uses = [r for r in rels if r["type"] == "USES"]
    compat = [r for r in rels if r["type"] == "COMPATIBLE_WITH"]
    print(f"  SBB-CORE-004: IMPLEMENTS={len(impl)}, USES={len(uses)}, COMPATIBLE_WITH={len(compat)}")

    has_correct_header = "SBB-CORE-004" in (p.get("markdown_content", "")[:200])
    print(f"  SBB-CORE-004 markdown header correct: {has_correct_header}")

    # Thin content check
    print("\n  Thin content check:")
    for p_summary in sorted(patterns, key=lambda x: x["id"]):
        if p_summary["type"] == "AB":
            continue
        pattern = get_pattern(p_summary["id"])
        _, sections = parse_sections(pattern.get("markdown_content", ""))
        for name, body in sections:
            if name in ("Depending Technology", "Compatible Technologies", "Dependencies", "Dependent Building Blocks"):
                continue  # these are auto-generated
            if len(body.strip()) < 30 and body.strip() not in ("None",):
                print(f"    {p_summary['id']} / {name}: only {len(body.strip())} chars")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("Pattern Enrichment Migration")
    print("=" * 60)

    fix_sbb_core_004()
    update_all_tech_relationships()
    regenerate_markdown()
    verify()

    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
