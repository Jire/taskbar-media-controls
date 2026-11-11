// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {typeName} from './gtype.js';

// St.BoxLayout gained `orientation` in GNOME 48 and deprecated `vertical`.
function setVertical(box) {
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
}

/**
 * Previous / play-pause / next buttons bound to one MprisPlayer.
 * `player` may be swapped or set to null at any time.
 */
export const MediaButtons = GObject.registerClass({GTypeName: typeName('MediaButtons')},
class MediaButtons extends St.BoxLayout {
    constructor(styleClass) {
        super({
            style_class: `tmc-buttons ${styleClass ?? ''}`,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._player = null;
        this._playerId = 0;

        this._prev = this._addButton('media-skip-backward-symbolic',
            'Previous track', () => this._player?.previous());
        this._play = this._addButton('media-playback-start-symbolic',
            'Play or pause', () => this._player?.playPause());
        this._play.add_style_class_name('tmc-play');
        this._next = this._addButton('media-skip-forward-symbolic',
            'Next track', () => this._player?.next());

        this.connect('destroy', () => this.setPlayer(null));
    }

    _addButton(iconName, label, callback) {
        const button = new St.Button({
            style_class: 'tmc-control',
            accessible_name: label,
            can_focus: true,
            child: new St.Icon({icon_name: iconName, style_class: 'tmc-control-icon'}),
        });
        button.connect('clicked', () => callback());
        this.add_child(button);
        return button;
    }

    get player() {
        return this._player;
    }

    setPlayer(player) {
        if (player === this._player)
            return;
        if (this._playerId)
            this._player.disconnect(this._playerId);
        this._player = player;
        this._playerId = player?.connect('changed', () => this.sync()) ?? 0;
        this.sync();
    }

    sync() {
        const p = this._player;
        if (!p)
            return;
        this._play.child.icon_name = p.isPlaying
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._play.reactive = p.isPlaying ? p.canPause || p.canPlay : p.canPlay;
        this._prev.reactive = p.canGoPrevious;
        this._next.reactive = p.canGoNext;
    }

    /** True when `actor` is one of our buttons or inside one. */
    containsActor(actor) {
        return !!actor && (actor === this || this.contains(actor));
    }
});

/**
 * Card shown in the Quick Settings menu: artwork, title, artist, app name
 * and the three media buttons. Clicking the text/artwork raises the player.
 */
export const MediaCard = GObject.registerClass({GTypeName: typeName('MediaCard')},
class MediaCard extends St.BoxLayout {
    constructor(onActivate) {
        super({style_class: 'tmc-card', x_expand: true});
        this._player = null;
        this._playerId = 0;

        const info = new St.Button({
            style_class: 'tmc-card-info',
            x_expand: true,
            can_focus: true,
            accessible_name: 'Show player',
        });
        const infoBox = new St.BoxLayout({x_expand: true, style_class: 'tmc-card-info-box'});
        info.set_child(infoBox);

        this._art = new St.Icon({style_class: 'tmc-art', icon_size: 56});
        infoBox.add_child(this._art);

        const text = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style_class: 'tmc-text',
        });
        setVertical(text);
        const appRow = new St.BoxLayout({style_class: 'tmc-app-row'});
        this._appIcon = new St.Icon({icon_size: 12, style_class: 'tmc-app-icon'});
        this._appName = new St.Label({style_class: 'tmc-app-name'});
        appRow.add_child(this._appIcon);
        appRow.add_child(this._appName);
        this._title = new St.Label({style_class: 'tmc-title'});
        this._artist = new St.Label({style_class: 'tmc-artist'});
        for (const l of [this._appName, this._title, this._artist])
            l.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        text.add_child(appRow);
        text.add_child(this._title);
        text.add_child(this._artist);
        infoBox.add_child(text);

        info.connect('clicked', () => {
            this._player?.raise();
            onActivate?.();
        });

        this._buttons = new MediaButtons('tmc-card-buttons');
        this.add_child(info);
        this.add_child(this._buttons);

        this.connect('destroy', () => this.setPlayer(null));
    }

    setPlayer(player) {
        this._buttons.setPlayer(player);
        if (player === this._player)
            return;
        if (this._playerId)
            this._player.disconnect(this._playerId);
        this._player = player;
        this._lastArt = null;
        this._playerId = player?.connect('changed', () => this.sync()) ?? 0;
        this.sync();
    }

    sync() {
        const p = this._player;
        if (!p)
            return;
        this._title.text = p.title;
        this._artist.text = p.artists.join(', ');
        this._artist.visible = this._artist.text !== '';
        this._appName.text = p.displayName;
        this._appIcon.gicon = p.app?.get_icon() ?? null;
        this._appIcon.visible = !!this._appIcon.gicon;

        if (p.artUrl !== this._lastArt) {
            this._lastArt = p.artUrl;
            this._art.gicon = p.artUrl
                ? new Gio.FileIcon({file: Gio.File.new_for_uri(p.artUrl)})
                : new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
        }
    }
});

/** Vertical stack of MediaCards, one per usable player. */
export const MediaCardStack = GObject.registerClass({GTypeName: typeName('MediaCardStack')},
class MediaCardStack extends St.BoxLayout {
    constructor(manager, onActivate, maxCards = 3) {
        super({
            style_class: 'tmc-stack',
            x_expand: true,
        });
        setVertical(this);
        this._manager = manager;
        this._onActivate = onActivate;
        this._max = maxCards;
        this._managerId = manager.connect('players-changed', () => this._sync());
        this.connect('destroy', () => manager.disconnect(this._managerId));
        this._sync();
    }

    _sync() {
        const players = this._manager.players.slice(0, this._max);
        const cards = this.get_children();
        while (cards.length < players.length) {
            const card = new MediaCard(this._onActivate);
            this.add_child(card);
            cards.push(card);
        }
        while (cards.length > players.length)
            cards.pop().destroy();
        players.forEach((p, i) => cards[i].setPlayer(p));
        this.visible = players.length > 0;
    }
});
