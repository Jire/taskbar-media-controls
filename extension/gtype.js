// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// Unique GType names per load, so the extension can be hot-reloaded from a
// fresh copy (see hot-load.js) without "type already registered" errors.
globalThis.__tmcLoadGeneration = (globalThis.__tmcLoadGeneration ?? 0) + 1;
const GEN = globalThis.__tmcLoadGeneration;

export function typeName(name) {
    return `TaskbarMediaControls_${name}_${GEN}`;
}
