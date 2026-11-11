// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// Adds media buttons to Dash to Panel's window-preview thumbnails.
//
// Dash to Panel has no public API for this, so we wrap two methods of its
// exported `Preview` class. Both have existed unchanged for years; if a
// future release renames them, the hook disables itself and logs a warning
// instead of breaking the panel.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {typeName} from './gtype.js';
import {MediaButtons} from './widgets.js';

const DTP_UUID = 'dash-to-panel@jderose9.github.com';
// Renamed from ENABLED to ACTIVE in GNOME 47.
const STATE_ACTIVE = ExtensionState.ACTIVE ?? ExtensionState.ENABLED;
const BAR = Symbol('tmcBar');

export class DashToPanelHook {
    constructor(manager) {
        this._manager = manager;
        this._bars = new Set();
        this._patched = null;
        this._patching = false;
        this._destroyed = false;
        this._stateId = Main.extensionManager.connect('extension-state-changed',
            (mgr, ext) => {
                if (ext.uuid === DTP_UUID)
                    this._tryPatch();
            });
        this._tryPatch();
    }

    async _tryPatch() {
        if (this._patched || this._patching)
            return;
        const dtp = Main.extensionManager.lookup(DTP_UUID);
        if (!dtp || dtp.state !== STATE_ACTIVE)
            return;

        this._patching = true;
        try {
            // Same URI as Dash to Panel's own import, so GJS hands us the
            // already-loaded module instance rather than a fresh copy.
            const mod = await import(`${dtp.dir.get_uri()}/windowPreview.js`);
            if (this._destroyed)
                return;
            this._patch(mod.Preview?.prototype);
        } catch (e) {
            console.warn(`[taskbar-media-controls] Dash to Panel hook unavailable: ${e.message}`);
        } finally {
            this._patching = false;
        }
    }

    _patch(proto) {
        if (typeof proto?.assignWindow !== 'function' ||
            typeof proto?._onButtonReleaseEvent !== 'function') {
            console.warn('[taskbar-media-controls] Dash to Panel internals changed; preview controls disabled');
            return;
        }

        const hook = this;
        const origAssign = proto.assignWindow;
        const origRelease = proto._onButtonReleaseEvent;

        proto.assignWindow = function (window, ...args) {
            const ret = origAssign.call(this, window, ...args);
            try {
                hook._attach(this, window);
            } catch (e) {
                console.error(e, '[taskbar-media-controls] attaching preview controls');
            }
            return ret;
        };

        // A click on one of our buttons must not also activate the window
        // (which is what a click anywhere else on the preview does).
        proto._onButtonReleaseEvent = function (event, ...args) {
            const target = global.stage.get_event_actor?.(event) ?? event.get_source?.();
            if (this[BAR]?.containsActor(target))
                return Clutter.EVENT_STOP;
            return origRelease.call(this, event, ...args);
        };

        this._patched = {proto, origAssign, origRelease};
    }

    _attach(preview, window) {
        let bar = preview[BAR];
        if (!bar) {
            bar = new PreviewBar(this._manager, preview);
            preview[BAR] = bar;
            preview.add_child(bar);
            this._bars.add(bar);
            bar.connect('destroy', () => {
                this._bars.delete(bar);
                if (preview[BAR] === bar)
                    delete preview[BAR];
            });
        }
        bar.setWindow(window);
    }

    destroy() {
        this._destroyed = true;
        Main.extensionManager.disconnect(this._stateId);
        if (this._patched) {
            const {proto, origAssign, origRelease} = this._patched;
            proto.assignWindow = origAssign;
            proto._onButtonReleaseEvent = origRelease;
            this._patched = null;
        }
        for (const bar of [...this._bars])
            bar.destroy();
    }
}

/** Pill of media buttons overlaid on the bottom of one window thumbnail. */
const PreviewBar = GObject.registerClass({GTypeName: typeName('PreviewBar')},
class PreviewBar extends MediaButtons {
    constructor(manager, preview) {
        super('tmc-preview-bar');
        this.set({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            visible: false,
        });
        this._manager = manager;
        this._preview = preview;
        this._window = null;
        // Disconnected automatically when this actor is destroyed.
        manager.connectObject('players-changed', () => this._sync(), this);
    }

    setWindow(window) {
        this._window = window;
        this._sync();
    }

    _sync() {
        const player = this._window ? this._manager.findForWindow(this._window) : null;
        this.setPlayer(player);
        this.visible = !!player;
        if (player)
            this._place();
    }

    // Sit just above the bottom edge of the thumbnail, clear of the
    // preview's padding and (if the title is shown below) its header.
    _place() {
        const bin = this._preview._previewBin;
        const box = bin?.get_parent();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const padding = (this._preview._padding ?? 0) / scale;
        let below = 0;
        if (box && box.get_last_child() !== bin)
            below = box.get_last_child().height / scale;
        this.style = `margin-bottom: ${Math.round(padding + below + 6)}px;`;
    }
});
