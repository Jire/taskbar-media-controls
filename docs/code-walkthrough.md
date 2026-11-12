# Code walkthrough

A guided read of everything that ships in the extension zip (`extension/`), for reviewers and contributors. It covers what each file does, what it touches in GNOME Shell and Dash to Panel, and how `disable()` undoes it.

## Lifecycle at a glance

```
enable()
 ├─ MprisManager            watches the session bus for MPRIS players
 ├─ QuickSettingsHook       adds a MediaCardStack under the volume slider
 │                          in every Quick Settings menu (one per monitor
 │                          with Dash to Panel)
 └─ DashToPanelHook         wraps 2 methods on Dash to Panel's Preview class

disable()                   reverse order of the above; see each file below
```

Nothing happens at import time except defining classes, two D-Bus proxy wrapper classes (`makeProxyWrapper` returns a class, not a connection) and a string constant in `gtype.js`.

## `extension.js`

Creates the `MprisManager`, then the two hooks, each inside its own `try` so one failing (for example on an unexpected Shell version) doesn't stop the other. `disable()` destroys the hooks first, then the manager they depend on.

## `mpris.js`: player tracking

**Why not reuse GNOME Shell's `ui/mpris.js`?** It's internal, its API changes between releases (for example how sources are attached to the message list), and it doesn't expose the process ID needed to match a player to a window. The MPRIS D-Bus spec itself has been stable for over a decade.

- **`MprisManager`**
  - Subscribes to `NameOwnerChanged` on `org.freedesktop.DBus` and lists existing names once with `ListNames`.
  - Creates an `MprisPlayer` for every `org.mpris.MediaPlayer2.*` name.
  - Emits `players-changed` whenever the set of players or any player's state changes.
  - `destroy()` cancels pending calls, unsubscribes the bus signal, and disconnects and destroys every player.
- **`MprisPlayer`**
  - Holds two proxies: `org.mpris.MediaPlayer2` (identity, desktop entry, `Raise`) and `.Player` (status, metadata, controls).
  - Looks up the owner's PID with `GetConnectionUnixProcessID`.
  - Re-reads everything on `g-properties-changed`.
  - Metadata is validated per the spec, because some players send wrong types. A metadata warning is logged at most once per player.
  - `destroy()` cancels init and disconnects both proxy signal handlers.
- **`usable`:** a player is shown only when it can be controlled, can play (or is playing), and has a title. This hides idle browser tabs.
- **`findForWindow(window)`:** matches by `Shell.App` first, using the player's `DesktopEntry` against the window's app. If the player has no `DesktopEntry` (some browsers), it falls back to the PID.
- **Album art:** `mpris:artUrl` is passed to `Gio.FileIcon`, the same way GNOME Shell's own media widget does. For `https://` URLs (Spotify, browsers), GVfs fetches the image. The extension makes no other network requests.

## `widgets.js`: UI

- **`MediaButtons`** is a `St.BoxLayout` of three `St.Button`s. `setPlayer()` swaps the `changed` handler from the old player to the new one. Buttons become non-reactive when the player says that action is unavailable.
- **`MediaCard`** shows art, app name and icon, title, artist, and a `MediaButtons`. Clicking the info area raises the player (`Shell.App.activate()`, or MPRIS `Raise()` as a fallback) and closes the menu.
- **`MediaCardStack`** shows one card per usable player, at most three, with the playing one first. It hides when there are none.
- **`setVertical()`** handles `St.BoxLayout` gaining `orientation` (and deprecating `vertical`) in GNOME 48.

Every `connect` on a player or manager is disconnected in the widget's `destroy` handler.

## `quickSettings.js`: Quick Settings card

**Which menus.** GNOME has one Quick Settings menu, `Main.panel.statusArea.quickSettings`. Dash to Panel gives each extra monitor's panel its own copy of it. It lists them in `global.dashToPanel.panels[i].statusArea.quickSettings` and emits `panels-created` on `global.dashToPanel` whenever it rebuilds them, for example when a monitor is plugged in or some of its settings change. That object is what Dash to Panel provides for other extensions to add to its secondary panels. The hook adds a card to every menu it finds, re-checks on `panels-created`, and re-attaches to `global.dashToPanel` when Dash to Panel is turned off and on (`extension-state-changed`). Without Dash to Panel, only the main menu is used.

**Timing.** Each Quick Settings builds its items asynchronously, so at login, or for a new monitor's copy, `_volumeOutput` may not exist yet. The hook retries each menu every 250 ms, up to 20 times, then falls back to appending the card at the end.

**Placement.** The card goes directly after the output-volume slider, using the public `QuickSettingsMenu.insertItemBefore(item, sibling, colSpan)`. `_volumeOutput` is the one private field read here, and only to find that sibling.

**Cleanup.** Cards are tracked per menu, so a menu never gets two. When Dash to Panel discards a menu, the card is destroyed with it and dropped from tracking. `destroy()` disconnects both signals, removes pending retries, and destroys every remaining card.

## `dashToPanel.js`: window-preview buttons

This is the part reviewers are most likely to ask about, because it interacts with another extension.

**What it does.** Dash to Panel draws window previews with its exported `Preview` class (`windowPreview.js`). The hook wraps two methods on `Preview.prototype`:

| Method | Wrapper |
| --- | --- |
| `assignWindow(window)` | Calls the original, then attaches or updates a `PreviewBar` (a `MediaButtons` subclass) if the window belongs to an MPRIS player |
| `_onButtonReleaseEvent(event)` | If the click landed on our buttons, stop the event, so the preview's normal "click activates the window" doesn't also fire; otherwise call the original |

**How it gets the class.** It looks up Dash to Panel with `Main.extensionManager.lookup()`, then dynamically imports `${dtp.dir.get_uri()}/windowPreview.js`. GJS caches ES modules by URL, so this returns the module instance Dash to Panel is already using rather than a second copy. It doesn't modify Dash to Panel's files, settings or state, and it doesn't enable, disable or reload any extension.

**Ordering.** If Dash to Panel isn't active yet, the hook waits for `extension-state-changed`. If Dash to Panel is missing, or its methods have been renamed, the hook logs one warning and does nothing. The Quick Settings card keeps working.

**Placement.** The bar is a child of the preview actor, aligned bottom-centre. `_place()` reads two Dash to Panel fields (`_previewBin`, `_padding`), with null checks, to sit above the thumbnail's padding and below-title header.

**Cleanup.** `destroy()` disconnects `extension-state-changed`, restores both original methods, and destroys every bar it created. A Symbol-keyed property on each preview links it to its bar and is deleted along with the bar. Each bar disconnects from the manager automatically when destroyed (`connectObject`).

## `gtype.js`

GType names must be unique per process. The extension's classes are named `TaskbarMediaControls_<Name>_<hash of this file's URL>`. A normal install always gets the same names. A development copy loaded from another folder (`scripts/hot-load.js`, which isn't shipped in the zip) gets different ones, so the two can't clash.

## `stylesheet.css`

Only classes prefixed `tmc-`. Colours use translucent grey so the card works in both light and dark styles. The preview bar uses a dark pill, since it sits on top of arbitrary window content.

## Logging

There are only warnings and errors: a missing or changed Dash to Panel, Quick Settings not found, a failed D-Bus call (cancellations ignored), and a player's bad metadata, logged once per player. Nothing is logged during normal operation.

---

## Publishing to extensions.gnome.org

1. Read the [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html), and this walkthrough against the code, until you can answer questions about any of it. Reviewers ask, and they reject submissions whose authors can't explain them.
2. Run the checks and build:
   ```bash
   npx --yes eslint@9 . && shellcheck install.sh scripts/*.sh && scripts/build.sh
   ```
3. Read the terms of service at <https://extensions.gnome.org/upload/>. If you agree, upload. It prompts for your extensions.gnome.org username and password:
   ```bash
   gnome-extensions upload --accept-tos dist/taskbar-media-controls@jire.github.io.shell-extension.zip
   ```
4. Watch the review page linked from your account for questions. For later versions, repeat steps 2–3. extensions.gnome.org assigns its own version numbers.
