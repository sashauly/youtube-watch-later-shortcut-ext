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

import browser from 'webextension-polyfill';

const BUTTON_MODE_KEY = 'buttonDisplayMode';
const DEFAULT_BUTTON_MODE = 'icon-and-text';

function isFirefox(): boolean {
  // InstallTrigger is a legacy Firefox global, often used in extensions for browser detection.
  // It is generally safe in the popup environment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (globalThis as any).InstallTrigger !== 'undefined';
}

function logError(message: string, error?: unknown): void {
  console.error(`[WatchLaterExt:Popup] ${message}`, error);
}

function handleButtonStyle(): void {
  const styleSelect = document.getElementById('button-style-select') as HTMLSelectElement | null;

  if (!styleSelect || !browser.storage?.sync) return;

  browser.storage.sync
    .get({ [BUTTON_MODE_KEY]: DEFAULT_BUTTON_MODE })
    .then((result) => {
      const mode = result[BUTTON_MODE_KEY] as string;

      if (styleSelect.querySelector(`option[value="${mode}"]`)) {
        styleSelect.value = mode;
      } else {
        styleSelect.value = DEFAULT_BUTTON_MODE;
      }
    })
    .catch((e) => {
      logError('Failed to load button style from sync storage.', e);
    });

  styleSelect.addEventListener('change', () => {
    const newMode = styleSelect.value;

    browser.storage.sync.set({ [BUTTON_MODE_KEY]: newMode }).catch((e) => {
      logError('Failed to save button style to sync storage.', e);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  handleButtonStyle();

  const list = document.getElementById('shortcut-list') as HTMLUListElement | null;
  if (list && browser.commands) {
    try {
      const commands = await browser.commands.getAll();

      list.innerHTML = ''; 

      commands.forEach((cmd) => {
        if (cmd.shortcut && cmd.description) {
          const li = document.createElement('li');
          li.className = 'shortcut-item'; 

          const descSpan = document.createElement('span');
          descSpan.className = 'shortcut-description'; 
          descSpan.textContent = `${cmd.description}:`;

          const keySpan = document.createElement('span');
          
          keySpan.className = 'hotkey';
          
          keySpan.textContent = cmd.shortcut;

          li.appendChild(descSpan);
          li.appendChild(keySpan);
          list.appendChild(li);
        }
      });
    } catch (e) {
      logError('Failed to retrieve commands (shortcuts).', e);
    }
  }

  const openShortcutsBtn = document.getElementById('open-shortcuts') as HTMLButtonElement | null;
  if (openShortcutsBtn) {
    openShortcutsBtn.onclick = () => {
      const url = isFirefox() ? 'about:addons' : 'chrome://extensions/shortcuts';
      if (browser.tabs?.create) {
        browser.tabs.create({ url }).catch((e) => {
          logError('Failed to open shortcuts settings tab.', e);
        });
      }
    };
  }

  const debugToggle = document.getElementById('debug-toggle') as HTMLInputElement | null;
  if (debugToggle && browser.storage?.local) {
    browser.storage.local
      .get({ debugMode: false })
      .then((result) => {
        debugToggle.checked = !!result.debugMode;
      })
      .catch((e) => {
        logError('Failed to load debug mode from storage.', e);
      });

    debugToggle.addEventListener('change', () => {
      const debugMode = debugToggle.checked;

      browser.storage.local.set({ debugMode }).catch((e) => {
        logError('Failed to save debug mode to storage.', e);
      });

      if (browser.runtime?.sendMessage) {
        browser.runtime.sendMessage({ type: 'set-debug-mode', debugMode }).catch((e) => {
          logError('Failed to send debug mode message to background script.', e);
        });
      }
    });
  }
});
