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

// --- Constants ---
const BUTTON_MODE_KEY = 'buttonDisplayMode';
const DEFAULT_BUTTON_MODE = 'icon-and-text'; // Must match default in background script

// --- Utility Functions ---

/** Checks if the current environment is Firefox (used for opening settings URL). */
function isFirefox(): boolean {
  // InstallTrigger is a legacy Firefox global, often used in extensions for browser detection.
  // It is generally safe in the popup environment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (globalThis as any).InstallTrigger !== 'undefined';
}

/** Handles errors gracefully by logging them to the console. */
function logError(message: string, error?: unknown): void {
  console.error(`[WatchLaterExt:Popup] ${message}`, error);
}

// --- NEW: Button Style Handler ---

function handleButtonStyle(): void {
  const styleSelect = document.getElementById('button-style-select') as HTMLSelectElement | null;

  if (!styleSelect || !browser.storage?.sync) return;

  // a. Load initial state from sync storage
  browser.storage.sync
    .get({ [BUTTON_MODE_KEY]: DEFAULT_BUTTON_MODE })
    .then((result) => {
      // FIX: Assert the type of the retrieved value as string, since we provided a string default.
      const mode = result[BUTTON_MODE_KEY] as string;

      // Set the dropdown to the loaded value (or default)
      if (styleSelect.querySelector(`option[value="${mode}"]`)) {
        styleSelect.value = mode;
      } else {
        styleSelect.value = DEFAULT_BUTTON_MODE;
      }
    })
    .catch((e) => {
      logError('Failed to load button style from sync storage.', e);
    });

  // b. Handle change event
  styleSelect.addEventListener('change', () => {
    const newMode = styleSelect.value;

    // Save to sync storage
    browser.storage.sync.set({ [BUTTON_MODE_KEY]: newMode }).catch((e) => {
      logError('Failed to save button style to sync storage.', e);
    });

    // Note: The background script has a storage.onChanged listener that will
    // pick up this change and broadcast it to all active content scripts.
  });
}

// --- Main DOMContentLoaded Listener ---

document.addEventListener('DOMContentLoaded', async () => {
  // NEW: Initialize button style handler
  handleButtonStyle();

  // --- 1. Shortcut List Display ---
  const list = document.getElementById('shortcut-list') as HTMLUListElement | null;
  if (list && browser.commands) {
    try {
      // The webextension-polyfill ensures this is always Promise-based.
      const commands = await browser.commands.getAll();

      commands.forEach((cmd) => {
        // Ensure description is defined (it should be, based on manifest)
        if (cmd.shortcut && cmd.description) {
          const li = document.createElement('li');
          // Use textContent for description and createElement for the shortcut key
          const keySpan = document.createElement('span');
          keySpan.style.cssText =
            'font-weight: bold; background-color: #eee; padding: 2px 5px; border-radius: 3px; margin-left: 5px;';
          keySpan.textContent = cmd.shortcut;

          li.textContent = `${cmd.description}:`;
          li.appendChild(keySpan);
          list.appendChild(li);
        }
      });
    } catch (e) {
      logError('Failed to retrieve commands (shortcuts).', e);
    }
  }

  // --- 2. Open Shortcuts Button ---
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

  // --- 3. Debug Mode Toggle ---
  const debugToggle = document.getElementById('debug-toggle') as HTMLInputElement | null;
  if (debugToggle && browser.storage?.local) {
    // a. Load initial state
    browser.storage.local
      .get({ debugMode: false })
      .then((result) => {
        debugToggle.checked = !!result.debugMode;
      })
      .catch((e) => {
        logError('Failed to load debug mode from storage.', e);
      });

    // b. Handle change event
    debugToggle.addEventListener('change', () => {
      const debugMode = debugToggle.checked;

      // Update storage
      browser.storage.local.set({ debugMode }).catch((e) => {
        logError('Failed to save debug mode to storage.', e);
      });

      // The background script already has a listener for browser.storage.local changes
      // that updates its internal state, so no explicit message is needed here,
      // but the original logic is harmless.
      if (browser.runtime?.sendMessage) {
        browser.runtime.sendMessage({ type: 'set-debug-mode', debugMode }).catch((e) => {
          logError('Failed to send debug mode message to background script.', e);
        });
      }
    });
  }
});
