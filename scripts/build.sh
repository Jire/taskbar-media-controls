#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 Jire
#
# Builds dist/<uuid>.shell-extension.zip from extension/.
# Install the result with:  ./install.sh --zip dist/*.shell-extension.zip
set -euo pipefail
cd "$(dirname "$0")/.."

uuid=$(python3 -c 'import json; print(json.load(open("extension/metadata.json"))["uuid"])')
out="dist/$uuid.shell-extension.zip"
mkdir -p dist
rm -f "$out"

if command -v zip >/dev/null 2>&1; then
    (cd extension && zip -qr -X "../$out" .)
else
    python3 - "$out" <<'EOF'
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('extension'):
        for f in sorted(files):
            path = os.path.join(root, f)
            z.write(path, os.path.relpath(path, 'extension'))
EOF
fi
echo "$out"
