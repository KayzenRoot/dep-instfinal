"""Minimal offline importer regression tests, including optimized Python mode."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import struct
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('dif_master_importer', ROOT / 'import-master.py')
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('Não foi possível carregar o importador para os testes.')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ImportMasterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix='dif-ux-import-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.folder = self.root / 'master'
        self.folder.mkdir()
        self.archive = self.root / 'master.zip'
        entries = []
        with zipfile.ZipFile(self.archive, 'w') as bundle:
            for idx, name in enumerate(MODULE.IDS):
                sample = (
                    MODULE.PNG_MAGIC
                    + struct.pack('>I', 13)
                    + b'IHDR'
                    + struct.pack('>II', 1672, 941)
                    + bytes([idx + 1]) * 5
                )
                bundle.writestr(MODULE.ZIP_PREFIX + name + '.png', sample)
                entries.append({
                    'name': name,
                    'file': f'screens/{name}.png',
                    'sha256': hashlib.sha256(sample).hexdigest(),
                    'exists_in_repo': False,
                })
        self.manifest = {
            'name': 'DIF Studio Neon Glass',
            'image_size': {'width': 1672, 'height': 941},
            'images': entries,
            'repo_asset_upload': 'PENDING',
        }
        self.save()

    def save(self) -> None:
        (self.folder / 'manifest.json').write_text(
            json.dumps(self.manifest, indent=2), encoding='utf-8'
        )

    def test_import_verifies_all_nine_assets(self) -> None:
        MODULE.install(self.archive, self.folder)
        files = list((self.folder / 'screens').glob('*.png'))
        self.assertEqual(len(files), 9)
        saved = json.loads((self.folder / 'manifest.json').read_text(encoding='utf-8'))
        self.assertTrue(all(x['exists_in_repo'] for x in saved['images']))
        self.assertEqual(saved['repo_asset_upload'], 'VERIFIED_LOCAL_FILES')

    def test_rejects_bad_hash_without_writing_assets(self) -> None:
        self.manifest['images'][4]['sha256'] = '0' * 64
        self.save()
        with self.assertRaisesRegex(ValueError, 'SHA-256 divergente'):
            MODULE.install(self.archive, self.folder)
        self.assertFalse((self.folder / 'screens').exists())

    def test_rejects_wrong_image_order_without_writing_assets(self) -> None:
        self.manifest['images'][4]['name'] = '01-login'
        self.save()
        with self.assertRaisesRegex(ValueError, 'Ordem de imagens'):
            MODULE.install(self.archive, self.folder)
        self.assertFalse((self.folder / 'screens').exists())

    def test_rejects_unexpected_manifest_flags_before_writing_assets(self) -> None:
        for image in self.manifest['images']:
            image.pop('exists_in_repo')
        self.save()
        with self.assertRaisesRegex(ValueError, 'Manifesto inesperado'):
            MODULE.install(self.archive, self.folder)
        self.assertFalse((self.folder / 'screens').exists())


if __name__ == '__main__':
    unittest.main()
