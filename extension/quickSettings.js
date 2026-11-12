// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// Puts media cards in every Quick Settings menu, directly under the output
// volume slider.
//
// GNOME has one Quick Settings menu. Dash to Panel gives each extra
// monitor's panel its own copy, lists them in `global.dashToPanel.panels`,
// and emits 'panels-created' whenever it rebuilds them (monitor changes,
// some of its settings). That object is what Dash to Panel provides for
// other extensions to add to its secondary panels.

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DTP_UUID} from './dashToPanel.js';
import {MediaCardStack} from './widgets.js';

const N_COLUMNS = 2;
const RETRY_MS = 250;
const MAX_TRIES = 20;

export class QuickSettingsHook {
    constructor(manager) {
        this._manager = manager;
        this._stacks = new Map(); // Quick Settings indicator -> MediaCardStack
        this._retries = new Map(); // Quick Settings indicator -> GLib source id
        this._dtp = null;
        this._dtpId = 0;

        this._stateId = Main.extensionManager.connect('extension-state-changed',
            (mgr, ext) => {
                if (ext.uuid === DTP_UUID)
                    this._watchDashToPanel();
            });
        this._watchDashToPanel();
        this._addToAll();
    }

    _watchDashToPanel() {
        const dtp = global.dashToPanel ?? null;
        if (dtp === this._dtp)
            return;
        this._unwatchDashToPanel();
        this._dtp = dtp;
        this._dtpId = dtp?.connect('panels-created', () => this._addToAll()) ?? 0;
        this._addToAll();
    }

    _unwatchDashToPanel() {
        if (this._dtpId)
            this._dtp.disconnect(this._dtpId);
        this._dtp = null;
        this._dtpId = 0;
    }

    _quickSettingsIndicators() {
        const all = [Main.panel.statusArea.quickSettings];
        for (const panel of global.dashToPanel?.panels ?? [])
            all.push(panel.statusArea?.quickSettings);
        return [...new Set(all.filter(Boolean))];
    }

    _addToAll() {
        for (const qs of this._quickSettingsIndicators())
            this._add(qs, 0);
    }

    _add(qs, tries) {
        if (this._stacks.has(qs) || this._retries.has(qs))
            return;

        // Each Quick Settings creates its items asynchronously, so a new
        // one (at login, or a new monitor's) may not have them yet.
        if (!qs._volumeOutput && tries < MAX_TRIES) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_MS, () => {
                this._retries.delete(qs);
                this._add(qs, tries + 1);
                return GLib.SOURCE_REMOVE;
            });
            this._retries.set(qs, id);
            return;
        }
        if (!qs.menu)
            return;

        const stack = new MediaCardStack(this._manager, () => qs.menu.close());
        const after = qs._volumeOutput?.quickSettingsItems?.at(-1);
        const sibling = after?.get_parent() ? after.get_next_sibling() : null;
        if (sibling)
            qs.menu.insertItemBefore(stack, sibling, N_COLUMNS);
        else
            qs.menu.addItem(stack, N_COLUMNS);

        this._stacks.set(qs, stack);
        stack.connect('destroy', () => {
            if (this._stacks.get(qs) === stack)
                this._stacks.delete(qs);
        });
    }

    destroy() {
        Main.extensionManager.disconnect(this._stateId);
        this._unwatchDashToPanel();
        for (const id of this._retries.values())
            GLib.source_remove(id);
        this._retries.clear();
        for (const stack of [...this._stacks.values()])
            stack.destroy();
        this._stacks.clear();
    }
}
