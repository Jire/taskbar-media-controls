// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {MprisManager} from './mpris.js';
import {QuickSettingsHook} from './quickSettings.js';
import {DashToPanelHook} from './dashToPanel.js';

export default class TaskbarMediaControls extends Extension {
    enable() {
        this._manager = new MprisManager();
        this._hooks = [];
        for (const Hook of [QuickSettingsHook, DashToPanelHook]) {
            try {
                this._hooks.push(new Hook(this._manager));
            } catch (e) {
                console.error(e, `[taskbar-media-controls] ${Hook.name} failed`);
            }
        }
    }

    disable() {
        this._hooks?.forEach(h => h.destroy());
        this._hooks = null;
        this._manager?.destroy();
        this._manager = null;
    }
}
