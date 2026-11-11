// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// Puts media cards in the Quick Settings menu, directly under the output
// volume slider.

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MediaCardStack} from './widgets.js';

const N_COLUMNS = 2;
const RETRY_MS = 250;
const MAX_TRIES = 20;

export class QuickSettingsHook {
    constructor(manager) {
        this._manager = manager;
        this._tries = 0;
        this._timeoutId = 0;
        this._tryInsert();
    }

    _tryInsert() {
        const qs = Main.panel.statusArea.quickSettings;
        // The shell creates its Quick Settings items asynchronously, so right
        // after login they may not exist yet. Retry for a few seconds.
        if (!qs?._volumeOutput && this._tries++ < MAX_TRIES) {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_MS, () => {
                this._timeoutId = 0;
                this._tryInsert();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        if (!qs?.menu) {
            console.warn('[taskbar-media-controls] Quick Settings menu not found');
            return;
        }

        this._stack = new MediaCardStack(this._manager, () => qs.menu.close());

        const after = qs._volumeOutput?.quickSettingsItems?.at(-1);
        const sibling = after?.get_parent() ? after.get_next_sibling() : null;
        if (sibling)
            qs.menu.insertItemBefore(this._stack, sibling, N_COLUMNS);
        else
            qs.menu.addItem(this._stack, N_COLUMNS);
    }

    destroy() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._stack?.destroy();
        this._stack = null;
    }
}
