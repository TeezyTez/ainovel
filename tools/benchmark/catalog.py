"""Lossless index of the supplied Markdown benchmark (evaluation side only).

This is a project-local extractor, not the absent upstream benchmark runner.
No function converts a case, rubric, or fixture into a product-model prompt.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

CASE = re.compile(r"^#### ((?:SYS|NAR|FUN|UIX)-\d{3}) · (.+?)\s*$")
SECTION = re.compile(r"^##### (.+?)\s*$")
STEP = re.compile(r"^\*\*((?:S)?\d+) · ([^*]+)\*\*\s*$")
BULLET = re.compile(r"^( *)(?:- |\* )(.+?)\s*$")
FIELD = re.compile(r"^\*\*(.+?)\*\*\s*[：:]\s*(.*)$")
CHECK_GROUPS = {"hard": "硬约束", "semantic": "语义检查", "quality": "文学或体验评价轴"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def span(lines: list[str], start: int, end: int) -> dict:
    return {"start_line": start + 1, "end_line": end,
            "sha256": sha256("".join(lines[start:end]).encode("utf-8"))}


def parse_items(lines: list[str], start: int, end: int) -> list[dict]:
    """Preserve nested Markdown list items without interpreting their authority."""
    roots, stack = [], []
    for index in range(start, end):
        match = BULLET.match(lines[index])
        if not match:
            continue
        indent, text = len(match[1]), match[2]
        while stack and stack[-1][0] >= indent:
            _, old, old_start = stack.pop()
            old["source"] = span(lines, old_start, index)
        field = FIELD.match(text)
        item = {"text": text, "label": field[1] if field else None,
                "value": field[2] if field else text, "children": []}
        (stack[-1][1]["children"] if stack else roots).append(item)
        stack.append((indent, item, index))
    while stack:
        _, item, item_start = stack.pop()
        item["source"] = span(lines, item_start, end)
    return roots


def value(items: list[dict], label: str, default=None):
    return next((item["value"] for item in items if item["label"] == label), default)


def section_items(sections: list[dict], heading: str) -> list[dict]:
    return next((section["items"] for section in sections if section["heading"] == heading), [])


def make_check(case_id: str, kind: str, index: int, node: dict) -> dict:
    original_id = value(node["children"], "id") or value(node["children"], "检查编号")
    prefix = {"hard": "H", "semantic": "SEM", "quality": "Q", "variants": "V"}[kind]
    automatic = value(node["children"], "允许自动宣告通过")
    return {"id": original_id or f"{case_id}-{prefix}{index:02d}",
            "source_id": original_id, "kind": kind,
            "automatic_pass_allowed": False if automatic == "否" or kind in {"semantic", "quality"} else None,
            "source": node["source"], "definition": node}


def extract(path: Path) -> dict:
    raw = path.read_bytes()
    lines = raw.decode("utf-8-sig").splitlines(keepends=True)
    cases, seen = [], set()
    for start, line in enumerate(lines):
        match = CASE.match(line)
        if not match:
            continue
        case_id, title = match.groups()
        if case_id in seen:
            raise ValueError(f"Duplicate case ID {case_id} at line {start + 1}")
        seen.add(case_id)
        end = next((index for index in range(start + 1, len(lines))
                    if re.match(r"^#{1,4} ", lines[index])), len(lines))
        headings = [(index, found[1]) for index in range(start + 1, end)
                    if (found := SECTION.match(lines[index]))]
        sections, steps = [], []
        step_ids = set()
        for ordinal, (section_start, heading) in enumerate(headings):
            section_end = headings[ordinal + 1][0] if ordinal + 1 < len(headings) else end
            sections.append({"heading": heading, "source": span(lines, section_start, section_end),
                             "raw_markdown": "".join(lines[section_start:section_end]),
                             "items": parse_items(lines, section_start + 1, section_end)})
            if heading != "逐步操作与检查点":
                continue
            markers = [(index, found[1], found[2]) for index in range(section_start + 1, section_end)
                       if (found := STEP.match(lines[index]))]
            for number, (step_start, step_id, operation) in enumerate(markers):
                if step_id in step_ids:
                    raise ValueError(f"Duplicate step ID {case_id}/{step_id}")
                step_ids.add(step_id)
                step_end = markers[number + 1][0] if number + 1 < len(markers) else section_end
                items = parse_items(lines, step_start + 1, step_end)
                steps.append({"id": step_id, "operation": operation,
                              "input": value(items, "实际输入"), "checkpoint": value(items, "检查点"),
                              "source": span(lines, step_start, step_end), "items": items,
                              "raw_markdown": "".join(lines[step_start:step_end])})
        review = section_items(sections, "独立判定与阅读评审")
        checks = {}
        for kind, label in CHECK_GROUPS.items():
            nodes = next((node["children"] for node in review if node["label"] == label), [])
            checks[kind] = [make_check(case_id, kind, index + 1, node) for index, node in enumerate(nodes)]
        checks["variants"] = [make_check(case_id, "variants", index + 1, node)
                              for index, node in enumerate(section_items(sections, "反事实与迁移变体"))]
        check_ids = [check["id"] for group in checks.values() for check in group]
        if len(set(check_ids)) != len(check_ids):
            raise ValueError(f"Duplicate check ID in {case_id}")
        cases.append({"id": case_id, "title": title, "category": case_id.split("-")[0],
                      "parent_case_id": "SYS-027" if case_id.startswith("UIX-") else None,
                      "source": span(lines, start, end), "raw_markdown": "".join(lines[start:end]),
                      "sections": sections, "steps": steps, "checks": checks,
                      "required_capabilities": [node["value"] for node in section_items(sections, "所需真实能力")],
                      "execution_type": [node["value"] for node in section_items(sections, "执行类型")],
                      "requirement_ids": [node["value"] for node in section_items(sections, "关联原需求（不是通过覆盖）")]})
    if not cases:
        raise ValueError("No benchmark cases found; refusing an empty coverage denominator")
    return {"schema_version": 1, "origin": "project_local_markdown_extractor",
            "audience": "evaluation_only", "source": {"file": "source.md", "original_name": path.name,
            "sha256": sha256(raw), "byte_count": len(raw), "line_count": len(lines)}, "cases": cases}


def inventory(catalog: dict) -> dict:
    counts, primary, ui = {}, {"steps": 0, "hard": 0, "semantic": 0, "quality": 0, "variants": 0}, {}
    ui.update(primary)
    for case in catalog["cases"]:
        category = case["category"]
        counts[category] = counts.get(category, 0) + 1
        group = ui if category == "UIX" else primary
        group["steps"] += len(case["steps"])
        for kind in case["checks"]:
            group[kind] += len(case["checks"][kind])
    return {"case_counts": counts, "primary": primary, "ui_subcases": ui,
            "notice": "Authored definitions only. No product execution or acceptance is implied."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    catalog = extract(args.source)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "source.md").write_bytes(args.source.read_bytes())
    (args.out / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(inventory(catalog), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
