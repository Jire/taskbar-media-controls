// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// Minimal, self-contained MPRIS client.
//
// Deliberately does not reuse GNOME Shell's ui/mpris.js: that module is
// internal and changes between releases, while the MPRIS D-Bus spec itself
// has been stable for over a decade. Nothing here knows about Spotify
// specifically, so new Spotify versions need no changes.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import {typeName} from './gtype.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';

const RootProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
  </interface>
</node>`);

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`);

function newProxy(Wrapper, busName, cancellable) {
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line no-new
        new Wrapper(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
            if (error)
                reject(error);
            else
                resolve(proxy);
        }, cancellable);
    });
}

function dbusCall(method, params, replyType, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            method, params, new GLib.VariantType(replyType),
            Gio.DBusCallFlags.NONE, -1, cancellable,
            (conn, res) => {
                try {
                    resolve(conn.call_finish(res).deepUnpack());
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function ignoreCancel(e) {
    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        console.warn(`[taskbar-media-controls] ${e.message}`);
}

export const MprisPlayer = GObject.registerClass({
    GTypeName: typeName('MprisPlayer'),
    Signals: {'changed': {}},
}, class MprisPlayer extends GObject.Object {
    constructor(busName) {
        super();
        this.busName = busName;
        this.pid = 0;
        this.app = null;
        this.identity = '';
        this.title = '';
        this.artists = [];
        this.artUrl = '';
        this.status = 'Stopped';
        this.canPlay = false;
        this.canPause = false;
        this.canGoNext = false;
        this.canGoPrevious = false;
        this.canControl = false;
        this.lastPlayed = 0;
        this.ready = false;
        this._cancellable = new Gio.Cancellable();
    }

    async init() {
        const c = this._cancellable;
        const [root, player, pid] = await Promise.all([
            newProxy(RootProxy, this.busName, c),
            newProxy(PlayerProxy, this.busName, c),
            dbusCall('GetConnectionUnixProcessID',
                new GLib.Variant('(s)', [this.busName]), '(u)', c)
                .then(([p]) => p).catch(() => 0),
        ]);
        if (c.is_cancelled())
            return;
        this._root = root;
        this._player = player;
        this.pid = pid;
        this._rootId = root.connect('g-properties-changed', () => this._sync());
        this._playerId = player.connect('g-properties-changed', () => this._sync());
        this.ready = true;
        this._sync();
    }

    /** Whether this player should be shown with controls at all. */
    get usable() {
        return this.ready && this.canControl &&
            (this.canPlay || this.status === 'Playing') &&
            this.title !== '';
    }

    get isPlaying() {
        return this.status === 'Playing';
    }

    get displayName() {
        return this.app?.get_name() || this.identity ||
            this.busName.slice(MPRIS_PREFIX.length);
    }

    _sync() {
        const p = this._player;
        const meta = {};
        try {
            for (const [k, v] of Object.entries(p.Metadata ?? {}))
                meta[k] = v.deepUnpack();
        } catch (e) {
            console.warn(`[taskbar-media-controls] bad metadata from ${this.busName}: ${e}`);
        }

        this.title = typeof meta['xesam:title'] === 'string' ? meta['xesam:title'] : '';
        const artists = meta['xesam:artist'];
        this.artists = Array.isArray(artists)
            ? artists.filter(a => typeof a === 'string')
            : typeof artists === 'string' ? [artists] : [];
        this.artUrl = typeof meta['mpris:artUrl'] === 'string' ? meta['mpris:artUrl'] : '';

        const prevStatus = this.status;
        this.status = p.PlaybackStatus ?? 'Stopped';
        if (this.status === 'Playing' && prevStatus !== 'Playing')
            this.lastPlayed = GLib.get_monotonic_time();

        this.canPlay = !!p.CanPlay;
        this.canPause = !!p.CanPause;
        this.canGoNext = !!p.CanGoNext;
        this.canGoPrevious = !!p.CanGoPrevious;
        // Some players omit CanControl; the spec says to assume true then.
        this.canControl = p.CanControl ?? true;

        this.identity = this._root.Identity ?? '';
        const entry = this._root.DesktopEntry;
        const appSys = Shell.AppSystem.get_default();
        this.app = entry ? appSys.lookup_app(`${entry}.desktop`) : null;
        if (!this.app && this.pid) {
            // Fall back to the app that owns a window with this PID.
            this.app = Shell.WindowTracker.get_default().get_app_from_pid(this.pid);
        }

        this.emit('changed');
    }

    playPause() {
        this._player?.PlayPauseAsync().catch(ignoreCancel);
    }

    next() {
        this._player?.NextAsync().catch(ignoreCancel);
    }

    previous() {
        this._player?.PreviousAsync().catch(ignoreCancel);
    }

    raise() {
        if (this.app)
            this.app.activate();
        else if (this._root?.CanRaise)
            this._root.RaiseAsync().catch(ignoreCancel);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._rootId)
            this._root.disconnect(this._rootId);
        if (this._playerId)
            this._player.disconnect(this._playerId);
        this._root = this._player = null;
        this.ready = false;
    }
});

/**
 * Tracks every MPRIS player on the session bus.
 * Emits 'players-changed' when the set of usable players, or any player's
 * state, changes.
 */
export const MprisManager = GObject.registerClass({
    GTypeName: typeName('MprisManager'),
    Signals: {'players-changed': {}},
}, class MprisManager extends GObject.Object {
    constructor() {
        super();
        this._players = new Map();
        this._cancellable = new Gio.Cancellable();
        this._subId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (oldOwner)
                    this._remove(name);
                if (newOwner)
                    this._add(name);
            });

        dbusCall('ListNames', null, '(as)', this._cancellable)
            .then(([names]) => names
                .filter(n => n.startsWith(MPRIS_PREFIX))
                .forEach(n => this._add(n)))
            .catch(ignoreCancel);
    }

    /** Usable players, the playing / most recently played one first. */
    get players() {
        return [...this._players.values()]
            .filter(p => p.usable)
            .sort((a, b) => (b.isPlaying - a.isPlaying) || (b.lastPlayed - a.lastPlayed));
    }

    /**
     * The player belonging to a Meta.Window, matched by app first and PID
     * second (browsers often don't set DesktopEntry).
     */
    findForWindow(window) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const pid = window.get_pid();
        const players = this.players;
        const byApp = app ? players.filter(p => p.app === app) : [];
        if (byApp.length)
            return byApp.find(p => p.pid === pid) ?? byApp[0];
        return players.find(p => pid > 0 && p.pid === pid) ?? null;
    }

    _add(busName) {
        if (this._players.has(busName))
            return;
        const player = new MprisPlayer(busName);
        this._players.set(busName, player);
        player.connect('changed', () => this.emit('players-changed'));
        player.init().catch(e => {
            ignoreCancel(e);
            this._remove(busName);
        });
    }

    _remove(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;
        this._players.delete(busName);
        player.destroy();
        this.emit('players-changed');
    }

    destroy() {
        this._cancellable.cancel();
        Gio.DBus.session.signal_unsubscribe(this._subId);
        for (const p of this._players.values())
            p.destroy();
        this._players.clear();
    }
});
