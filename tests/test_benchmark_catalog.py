"""Extractor tests; fixtures are evaluator material, not product quality evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools/benchmark/catalog.py"


def load_catalog_module(test):
    test.assertTrue(MODULE.is_file(), "lossless benchmark catalog extractor is missing")
    spec = importlib.util.spec_from_file_location("benchmark_catalog", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SAMPLE = """# 基准
This is evaluator context, never a prompt.
#### SYS-001 · 知识边界
##### 所需真实能力
- isolated_fixture
##### 初始世界、信息与前提
- **玩家已知事实**：
    - 一份公开报告
- **仅评估方可见**：
    - 答案为 A，禁止发送给产品
##### 逐步操作与检查点
**S01 · ask**
- **实际输入**：我知道什么？
- **检查点**：不会自动获知答案
**S02 · harness**
- **实际输入**：独立读回，不作为玩家台词
##### 独立判定与阅读评审
- **硬约束**：
    - 项目 1
        - **id**：SYS-001-H1
        - **核验事项**：问答不改变状态
        - **允许自动宣告通过**：否
- **语义检查**：
    - 不能将猜测当成确证
- **文学或体验评价轴**：
    - 项目 1
        - **评价轴**：理解负担
##### 反事实与迁移变体
- 改变谁知道报告
##### 关联原需求（不是通过覆盖）
- FT084
### UI 子题
#### UIX-001 · 展示
##### 逐步操作与检查点
**01 · player**
- **实际输入**：只看正文。
##### 独立判定与阅读评审
- **硬约束**：
    - 不自动提交
- **语义检查**：
    - 保留未知
- **文学或体验评价轴**：
    - 低负担
##### 反事实与迁移变体
- 改用窄屏
## 附录 B
Secret judge calibration must not enter a case.
"""


class BenchmarkCatalogTests(unittest.TestCase):
    def test_preserves_source_bytes_and_case_spans_without_appendix_bleed(self):
        module = load_catalog_module(self)
        data = SAMPLE.replace("\n", "\r\n").encode("utf-8")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "原文.md"
            source.write_bytes(data)
            catalog = module.extract(source)
        self.assertEqual(hashlib.sha256(data).hexdigest(), catalog["source"]["sha256"])
        self.assertEqual(["SYS-001", "UIX-001"], [case["id"] for case in catalog["cases"]])
        first, second = catalog["cases"]
        self.assertEqual(3, first["source"]["start_line"])
        self.assertNotIn("### UI 子题", first["raw_markdown"])
        self.assertNotIn("Secret judge", second["raw_markdown"])
        self.assertIn("\r\n", first["raw_markdown"])
        self.assertEqual("我知道什么？", first["steps"][0]["input"])
        self.assertEqual("harness", first["steps"][1]["operation"])
        self.assertEqual("SYS-001-H1", first["checks"]["hard"][0]["id"])
        self.assertFalse(first["checks"]["hard"][0]["automatic_pass_allowed"])
        self.assertEqual("SYS-001-SEM01", first["checks"]["semantic"][0]["id"])
        self.assertEqual(["FT084"], first["requirement_ids"])
        self.assertEqual("SYS-027", second["parent_case_id"])
        self.assertEqual("evaluation_only", catalog["audience"])
        self.assertIn("答案为 A", first["raw_markdown"])
        self.assertNotIn("答案为 A", first["steps"][0]["input"])

    def test_duplicate_case_and_step_identifiers_fail_closed(self):
        module = load_catalog_module(self)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.md"
            for duplicate in (
                SAMPLE + "\n#### SYS-001 · duplicate\n",
                SAMPLE.replace("**S02 · harness**", "**S01 · harness**"),
            ):
                path.write_text(duplicate, encoding="utf-8")
                with self.assertRaises(ValueError):
                    module.extract(path)

    def test_checked_in_catalog_has_all_authored_items_not_false_coverage(self):
        module = load_catalog_module(self)
        path = ROOT / "tests/benchmark/catalog.json"
        self.assertTrue(path.is_file(), "full supplied benchmark has not been extracted")
        catalog = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual({"SYS": 32, "NAR": 22, "FUN": 24, "UIX": 13},
                         module.inventory(catalog)["case_counts"])
        totals = module.inventory(catalog)
        self.assertEqual(738, totals["primary"]["steps"])
        self.assertEqual(289, totals["primary"]["hard"])
        self.assertEqual(179, totals["primary"]["semantic"])
        self.assertEqual(127, totals["primary"]["quality"])
        self.assertEqual(184, totals["primary"]["variants"])
        self.assertEqual(76, totals["ui_subcases"]["steps"])
        source = path.parent / catalog["source"]["file"]
        self.assertEqual(catalog["source"]["sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        for case in catalog["cases"]:
            self.assertEqual(case["source"]["sha256"],
                             hashlib.sha256(case["raw_markdown"].encode("utf-8")).hexdigest())


if __name__ == "__main__":
    unittest.main()
