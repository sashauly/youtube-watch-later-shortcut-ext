// Copyright (C) 2025 Sasha Ulyanov
//
// This file is part of youtube-watch-later-hotkeys-extension.
//
// youtube-watch-later-hotkeys-extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// youtube-watch-later-hotkeys-extension is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with youtube-watch-later-hotkeys-extension.  If not, see <https://www.gnu.org/licenses/>.

// Polyfill for browser API
import browser from 'webextension-polyfill';

// Declare global for cross-browser detection
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const InstallTrigger: any | undefined;

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('shortcut-list') as HTMLUListElement | null;
  if (!list) return;

  // Use browser.commands.getAll (Promise) if available, else fallback to callback
  if (browser.commands && browser.commands.getAll.length === 0) {
    // Promise-based (Firefox, with polyfill)
    browser.commands.getAll().then((commands: browser.Commands.Command[]) => {
      commands.forEach((cmd) => {
        if (cmd.shortcut) {
          const li = document.createElement('li');
          li.innerHTML = `<b>${cmd.description}:</b> ${cmd.shortcut}`;
          list.appendChild(li);
        }
      });
    });
  } else if (browser.commands && typeof browser.commands.getAll === 'function') {
    // Callback-based (Chrome)
    (
      browser.commands.getAll as unknown as (
        cb: (commands: browser.Commands.Command[]) => void,
      ) => void
    )((commands) => {
      commands.forEach((cmd) => {
        if (cmd.shortcut) {
          const li = document.createElement('li');
          li.innerHTML = `<b>${cmd.description}:</b> ${cmd.shortcut}`;
          list.appendChild(li);
        }
      });
    });
  }

  const openShortcutsBtn = document.getElementById('open-shortcuts') as HTMLButtonElement | null;
  if (openShortcutsBtn) {
    openShortcutsBtn.onclick = () => {
      const isFirefox = typeof InstallTrigger !== 'undefined';
      const url = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts';
      if (browser.tabs && browser.tabs.create) {
        browser.tabs.create({ url });
      }
    };
  }

  // Debug mode toggle
  const debugToggle = document.getElementById('debug-toggle') as HTMLInputElement | null;
  if (debugToggle && browser.storage && browser.storage.local) {
    browser.storage.local.get({ debugMode: false }).then((result) => {
      debugToggle.checked = !!result.debugMode;
    });
    debugToggle.addEventListener('change', () => {
      const debugMode = debugToggle.checked;
      browser.storage.local.set({ debugMode });
      // Notify background script to update debug mode
      if (browser.runtime && browser.runtime.sendMessage) {
        browser.runtime.sendMessage({ type: 'set-debug-mode', debugMode });
      }
    });
  }
});
