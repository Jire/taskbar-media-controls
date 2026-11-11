// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 Jire

// Development helper, not part of the extension. Loads (or reloads) the
// installed extension into the running GNOME Shell without logging out.
// install.sh puts this file in ~/.local/share/taskbar-media-controls/.
// Run it from Looking Glass (Alt+F2, type "lg", Enter) with:
//
//   eval(new TextDecoder().decode(imports.gi.GLib.file_get_contents(imports.gi.GLib.get_user_data_dir() + '/taskbar-media-controls/hot-load.js')[1]))
//
// GJS caches ES modules by URL, so reloading in place would keep running the
// old code. Instead this copies the installed extension to a fresh folder
// under $XDG_RUNTIME_DIR (cleared at logout) and loads it from there. The
// next real login loads the normal installed copy as usual.
(() => {
    const {Gio, GLib} = imports.gi;
    const uuid = 'taskbar-media-controls@jire.github.io';
    const PER_USER = 2;
    const mgr = Main.extensionManager;

    const src = Gio.File.new_for_path(GLib.build_filenamev(
        [GLib.get_user_data_dir(), 'gnome-shell', 'extensions', uuid]));
    const dest = Gio.File.new_for_path(GLib.build_filenamev(
        [GLib.get_user_runtime_dir(), 'tmc-hot', String(GLib.get_real_time()), uuid]));
    dest.make_directory_with_parents(null);

    const children = src.enumerate_children('standard::name,standard::type', 0, null);
    let info;
    while ((info = children.next_file(null))) {
        if (info.get_file_type() !== Gio.FileType.REGULAR)
            continue;
        src.get_child(info.get_name()).copy(
            dest.get_child(info.get_name()), Gio.FileCopyFlags.OVERWRITE, null, null);
    }

    (async () => {
        try {
            // Unload the running copy, plus any older build of this
            // extension installed under a different UUID.
            for (const id of mgr.getUuids()) {
                if (id === uuid || id.startsWith('taskbar-media-controls@'))
                    await mgr.unloadExtension(mgr.lookup(id));
            }
            // Shell refuses to load a code change after an unload; we sidestep
            // the module cache with the fresh folder, so lift that guard.
            mgr._unloadedExtensions?.delete(uuid);
            const ext = mgr.createExtensionObject(uuid, dest, PER_USER);
            await mgr.loadExtension(ext);
            const state = mgr.lookup(uuid)?.state;
            const err = mgr.lookup(uuid)?.error;
            Main.notify('Taskbar Media Controls',
                err ? `Failed to load: ${err}` : `Loaded (state ${state}).`);
        } catch (e) {
            logError(e, `[${uuid}] hot-load`);
            Main.notify('Taskbar Media Controls', `Failed to load: ${e.message}`);
        }
    })();

    return `loading ${uuid} from ${dest.get_path()}`;
})();
