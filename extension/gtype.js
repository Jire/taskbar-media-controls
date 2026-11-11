// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// GType names must be unique per process. Deriving a suffix from where this
// copy of the extension was loaded from means a development build loaded
// from another folder (scripts/hot-load.js) can't clash with the installed
// one, while a normal install always gets the same names.
function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++)
        h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(16);
}

const SUFFIX = hash(import.meta.url);

export function typeName(name) {
    return `TaskbarMediaControls_${name}_${SUFFIX}`;
}
