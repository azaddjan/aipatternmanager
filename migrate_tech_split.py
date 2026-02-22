#!/usr/bin/env python3
"""
Migration: Split USES relationships into core (USES) vs compatible (COMPATIBLE_WITH).

Logic:
- For each SBB, identify the PRIMARY/CORE technology (the main service it runs on)
- Move everything else to COMPATIBLE_WITH
- ABBs don't have tech relationships (they're abstract), so skip them
"""
import requests

API = "http://localhost:8000/api"

# Manual mapping: SBB ID -> list of CORE technology IDs (minimum dependencies)
# Everything else currently in USES becomes COMPATIBLE_WITH
CORE_TECH = {
    "SBB-AGT-001": ["aws-bedrock"],                    # Bedrock AgentCore = Bedrock is the core
    "SBB-AGT-002": ["aws-eks"],                         # Custom Agent Service = runs on EKS
    "SBB-AGT-003": ["salesforce-agentforce"],            # Salesforce Agentforce = Salesforce platform
    "SBB-AGT-004": ["ms-copilot-studio"],                # Copilot Studio = Microsoft platform
    "SBB-CORE-001": ["aws-bedrock", "aws-eks"],          # Prompt Eng Direct EKS = Bedrock + EKS
    "SBB-CORE-002": ["litellm", "aws-eks"],              # Prompt Eng Gateway = LiteLLM + EKS
    "SBB-CORE-003": ["aws-bedrock", "aws-lambda"],       # Prompt Eng Lambda = Bedrock + Lambda
    "SBB-CORE-004": [],                                  # (if exists, handle gracefully)
    "SBB-INTG-001": ["aws-bedrock"],                     # AWS Bedrock = Bedrock itself
    "SBB-INTG-002": ["aws-bedrock", "aws-eks"],          # LLM Invocation Service = Bedrock + EKS
    "SBB-INTG-003": ["litellm", "aws-eks"],              # LLM Gateway LiteLLM = LiteLLM + EKS
    "SBB-INTG-004": ["aws-eks", "vllm"],                 # Self-Hosted LLM = EKS + vLLM
    "SBB-INTG-005": ["aws-eks"],                         # Self-Hosted Embedding = EKS
    "SBB-INTG-006": ["aws-eks"],                         # Self-Hosted ML = EKS
    "SBB-INTG-007": ["aws-bedrock"],                     # AgentCore Gateway = Bedrock managed
    "SBB-INTG-008": ["aws-eks"],                         # Custom MCP Server = EKS
    "SBB-KR-001": ["aws-eks"],                           # RAG Custom = runs on EKS
    "SBB-KR-002": ["aws-bedrock"],                       # Bedrock Knowledge Bases = Bedrock managed
    "SBB-KR-003": ["aws-kendra"],                        # Amazon Kendra = Kendra service
    "SBB-KR-004": [],                                    # (if exists)
    "SBB-XCUT-001": ["aws-bedrock"],                     # Bedrock Guardrails Integrated = Bedrock
    "SBB-XCUT-002": ["aws-bedrock"],                     # Bedrock ApplyGuardrail = Bedrock API
}


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


def update_pattern(pid, data):
    res = requests.put(
        f"{API}/patterns/{pid}?version_bump=none",
        json=data,
        headers={"Content-Type": "application/json"},
    )
    res.raise_for_status()
    return res.json()


def main():
    print("Loading data...")
    tech_map = get_technologies()
    patterns = get_all_patterns()
    print(f"  {len(patterns)} patterns, {len(tech_map)} technologies")

    updated = 0
    skipped = 0

    for p_summary in patterns:
        pid = p_summary["id"]
        ptype = p_summary["type"]

        if ptype in ("AB", "ABB"):
            skipped += 1
            continue

        pattern = get_pattern(pid)
        rels = pattern.get("relationships", [])
        current_uses = [r["target_id"] for r in rels if r["type"] == "USES" and r.get("target_label") == "Technology"]
        current_compat = [r["target_id"] for r in rels if r["type"] == "COMPATIBLE_WITH" and r.get("target_label") == "Technology"]

        if not current_uses and not current_compat:
            print(f"  SKIP {pid} — no tech relationships")
            skipped += 1
            continue

        core_ids = CORE_TECH.get(pid, [])
        # Core = intersection of current USES with our mapping
        new_core = [tid for tid in current_uses if tid in core_ids]
        # Compatible = everything in current USES that's NOT core + any existing COMPATIBLE_WITH
        new_compat = [tid for tid in current_uses if tid not in core_ids]
        # Also keep any already-set COMPATIBLE_WITH
        for tid in current_compat:
            if tid not in new_compat:
                new_compat.append(tid)

        print(f"  {pid}: USES {len(current_uses)} -> core={len(new_core)} compat={len(new_compat)}")
        core_names = [tech_map.get(t, t) for t in new_core]
        compat_names = [tech_map.get(t, t) for t in new_compat]
        print(f"    Core: {', '.join(core_names) or 'None'}")
        print(f"    Compatible: {', '.join(compat_names) or 'None'}")

        # Update via API — this replaces both USES and COMPATIBLE_WITH
        update_pattern(pid, {
            "technology_ids": new_core,
            "compatible_tech_ids": new_compat,
        })
        updated += 1

    print(f"\nDone! Updated: {updated}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
