"""Synthetic source fixtures only; no ERP configuration or external services."""
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('extractor', pathlib.Path(__file__).with_name('extract-evidence.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ExtractorTests(unittest.TestCase):
    def test_split_does_not_split_decimal_enum_or_comment(self):
        body = "`a` decimal(12,4), `b` enum('x,y','z') COMMENT 'a,b', /* x,y */ KEY (`a`,`b`)"
        self.assertEqual(len(MODULE.split_top(body)), 3)

    def test_mask_preserves_offsets_and_lines(self):
        text = 'class C {\n String x = "{ // }"; /* }\n { */\n}'
        masked = MODULE.mask(text)
        self.assertEqual(len(masked), len(text))
        self.assertEqual(masked.count('\n'), text.count('\n'))
        self.assertEqual(MODULE.closing(masked, masked.index('{')), len(text)-1)

    def test_real_extraction_records_duplicates_conflicts_and_unknowns(self):
        with tempfile.TemporaryDirectory(prefix='wimoor-evidence-fixture-') as tmp:
            base = pathlib.Path(tmp)
            root = base / 'source'
            root.mkdir()
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], check=True)
            sql = root / 'db_fixture'
            sql.mkdir()
            (sql / 'a.sql').write_text("CREATE TABLE `stock` (`id` bigint NOT NULL, `q` decimal(12,4) DEFAULT '0' COMMENT 'q,a', PRIMARY KEY (`id`));\nINSERT INTO stock VALUES ('SECRET_MUST_NOT_EXPORT');")
            (sql / 'b.sql').write_text("CREATE TABLE `stock` (`id` bigint NOT NULL, PRIMARY KEY (`id`));")
            service = root / 'service'
            service.mkdir()
            (service / 'StockService.java').write_text('public class StockService {\n @Transactional\n public int receive(int q) {\n return mapper.update(q);\n }\n}')
            mapper = root / 'mapper'
            mapper.mkdir()
            (mapper / 'StockMapper.xml').write_text('<mapper><select id="lock">select * from t_stock for update</select></mapper>')
            out = base / 'output'
            subprocess.run(['python3', str(pathlib.Path(__file__).with_name('extract-evidence.py')), '--source', str(root), '--output', str(out)], check=True, capture_output=True)
            summary = json.loads((out / 'summary.json').read_text())
            self.assertEqual(summary['unique_table_identities'], 1)
            self.assertEqual(summary['table_definitions'], 2)
            self.assertEqual(summary['conflicting_identities'], 1)
            methods = json.loads((out / 'methods.json').read_text())
            self.assertEqual(methods[0]['method'], 'receive')
            self.assertTrue(methods[0]['transactional'])
            self.assertEqual(methods[0]['line'], 3)
            self.assertTrue(json.loads((out / 'mapper_statements.json').read_text())[0]['row_lock'])
            for file in out.glob('*.json'):
                self.assertNotIn('SECRET_MUST_NOT_EXPORT', file.read_text())


if __name__ == '__main__':
    unittest.main()
