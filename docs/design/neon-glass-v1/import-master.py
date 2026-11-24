#!/usr/bin/env python3
"""Import exactly nine hashed Neon Glass masters; safe with python -O."""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import struct
import sys
import tempfile
import zipfile

IDS = (
    '01-login', '02-dashboard', '03-series', '04-episodes', '05-editor',
    '06-style', '07-media', '08-analytics', '09-settings',
)
ZIP_PREFIX = 'dif-neon-glass-master-v1/screens/'
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def require(condition: bool, message: str) -> None:
    """Fail closed even when Python assertions are disabled with -O."""
    if not condition:
        raise ValueError(message)


def install(archive: pathlib.Path, folder: pathlib.Path) -> None:
    manifest_path = folder / 'manifest.json'
    original = manifest_path.read_text(encoding='utf-8')
    manifest = json.loads(original)
    require(manifest.get('name') == 'DIF Studio Neon Glass', 'Nome do master inválido.')
    require(
        manifest.get('image_size') == {'width': 1672, 'height': 941},
        'Dimensões do master incorretas.',
    )
    entries = manifest.get('images')
    require(isinstance(entries, list) and len(entries) == 9, 'Manifesto incompleto.')
    require([entry['name'] for entry in entries] == list(IDS), 'Ordem de imagens inválida.')

    payloads: dict[str, bytes] = {}
    with zipfile.ZipFile(archive) as zf:
        for entry in entries:
            name = entry['name']
            member = ZIP_PREFIX + name + '.png'
            require(entry['file'] == 'screens/' + name + '.png', f'Caminho inválido: {name}')
            info = zf.getinfo(member)
            require(24 <= info.file_size <= 5_000_000, f'Tamanho PNG inválido: {name}')
            payload = zf.read(info)
            require(
                payload[:8] == PNG_MAGIC and payload[12:16] == b'IHDR',
                f'Assinatura PNG inválida: {name}',
            )
            require(
                struct.unpack('>II', payload[16:24]) == (1672, 941),
                f'Dimensões PNG incorretas: {name}',
            )
            digest = hashlib.sha256(payload).hexdigest()
            require(digest == entry['sha256'], f'SHA-256 divergente: {name}')
            payloads[name] = payload
    require(len(payloads) == 9, 'Pacote incompleto.')

    updated = original.replace('"exists_in_repo": false', '"exists_in_repo": true')
    updated = updated.replace(
        '"repo_asset_upload": "PENDING"',
        '"repo_asset_upload": "VERIFIED_LOCAL_FILES"',
    )
    require(updated.count('"exists_in_repo": true') == 9, 'Manifesto inesperado.')

    images_path = folder / 'screens'
    images_path.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dif-master-', dir=folder) as staging:
        staged = pathlib.Path(staging)
        for name, payload in payloads.items():
            (staged / (name + '.png')).write_bytes(payload)
        for name in IDS:
            os.replace(staged / (name + '.png'), images_path / (name + '.png'))
    manifest_path.write_text(updated, encoding='utf-8')
    print('DIF-UX-WO-001: 9/9 PNGs importados e hashes SHA-256 verificados.')
    print('Próximo gate: verificar commit/push, CI e read-back dos hashes.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Uso: python3 docs/design/neon-glass-v1/import-master.py pacote.zip')
    try:
        install(pathlib.Path(sys.argv[1]), pathlib.Path(__file__).resolve().parent)
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        sys.exit(f'BLOCKED: {error}')
