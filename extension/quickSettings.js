// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// Puts media cards in the Quick Settings menu, directly under the output
// volume slider (like the media flyout attached to the Windows volume panel).

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MediaCardStack} from './widgets.js';

const N_COLUMNS = 2;

export class QuickSettingsHook {
    constructor(manager) {
        this._manager = manager;
        this._tries = 0;
        this._timeoutId = 0;
        this._tryInsert();
    }

    _tryInsert() {
        const qs = Main.panel.statusArea.quickSettings;
        // Shell builds the indicators asynchronously at startup.
        if (!qs?.menu || (!qs._volumeOutput && this._tries < 20)) {
            this._tries++;
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this._timeoutId = 0;
                this._tryInsert();
                return GLib.SOURCE_REMOVE;
            });
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
