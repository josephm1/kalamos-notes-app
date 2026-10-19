#!/usr/bin/env python3
"""Host adapter for EpubImageCatalog, the canonical Android/host source parser.

Resolve the declared jsoup dependency with tools/gradle.sh first. Compilation is
cached by source/dependency bytes in a private temporary directory. No book text
or credentials are cached in the compiled adapter.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile


def catalog(epub):
    here = Path(__file__).resolve().parent
    source = here.parent / 'src/main/java/com/kalamos/foundation/documents/EpubImageCatalog.java'
    cli = here / 'EpubImageCatalogCli.java'
    version = '1.23.2'
    caches = [Path.home() / '.gradle/caches', Path.home() / '.var/app/com.google.AndroidStudio/.gradle/caches']
    jars = [jar for cache in caches for jar in cache.glob(f'modules-2/files-2.1/org.jsoup/jsoup/{version}/*/jsoup-{version}.jar')]
    if not jars:
        raise RuntimeError('Resolve foundation/documents dependencies with tools/gradle.sh before extracting EPUB images')
    jar = jars[0]
    compiler = shutil.which('javac')
    if not compiler:
        jdks = list(Path('/var/lib/flatpak/runtime/org.freedesktop.Sdk.Extension.openjdk17').glob('*/*/*/files/jvm/*/bin/javac'))
        compiler = str(jdks[-1]) if jdks else None
    if not compiler:
        raise RuntimeError('A JDK is required for the canonical EPUB image evaluation adapter')
    java = str(Path(compiler).with_name('java'))
    identity = hashlib.sha256(source.read_bytes() + cli.read_bytes() + jar.read_bytes()).hexdigest()
    classes = Path(tempfile.gettempdir()) / ('kalamos-epub-catalog-' + identity)
    classes.mkdir(mode=0o700, exist_ok=True)
    if not (classes / 'EpubImageCatalogCli.class').exists():
        subprocess.run([compiler, '--release', '17', '-cp', str(jar), '-d', str(classes), str(source), str(cli)], check=True, capture_output=True)
    result = subprocess.run([java, '-cp', os.pathsep.join([str(classes), str(jar)]), 'EpubImageCatalogCli', str(epub)], check=True, capture_output=True, text=True)
    rows = []
    with zipfile.ZipFile(epub) as book:
        for line in result.stdout.splitlines():
            values = [base64.b64decode(value).decode('utf-8') for value in line.split('\t')]
            entry, caption, page, locator, method = values
            lower = entry.lower()
            rows.append({'entry': entry, 'caption': caption, 'sourcePage': page, 'locator': locator, 'captionMethod': method,
                         'mime': 'image/png' if lower.endswith('.png') else 'image/webp' if lower.endswith('.webp') else 'image/jpeg',
                         'sha256': hashlib.sha256(book.read(entry)).hexdigest()})
    return rows


if __name__ == '__main__':
    print(json.dumps(catalog(sys.argv[1]), ensure_ascii=False))
