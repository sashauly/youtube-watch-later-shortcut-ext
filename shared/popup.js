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
window.browser = window.browser || window.chrome;

document.addEventListener("DOMContentLoaded", () => {
  const list = document.getElementById("shortcut-list");
  // Use browser.commands.getAll (Promise) if available, else fallback to callback
  if (browser.commands && browser.commands.getAll.length === 0) {
    // Promise-based (Firefox, with polyfill)
    browser.commands.getAll().then((commands) => {
      commands.forEach((cmd) => {
        if (cmd.shortcut) {
          const li = document.createElement("li");
          li.innerHTML = `<b>${cmd.description}:</b> ${cmd.shortcut}`;
          list.appendChild(li);
        }
      });
    });
  } else {
    // Callback-based (Chrome)
    browser.commands.getAll((commands) => {
      commands.forEach((cmd) => {
        if (cmd.shortcut) {
          const li = document.createElement("li");
          li.innerHTML = `<b>${cmd.description}:</b> ${cmd.shortcut}`;
          list.appendChild(li);
        }
      });
    });
  }

  document.getElementById("open-shortcuts").onclick = () => {
    // Detect browser for correct shortcut settings page
    const isFirefox = typeof InstallTrigger !== "undefined";
    const url = isFirefox ? "about:addons" : "chrome://extensions/shortcuts";
    if (browser.tabs && browser.tabs.create) {
      browser.tabs.create({ url });
    }
  };

  // Debug mode toggle
  const debugToggle = document.getElementById("debug-toggle");
  if (browser.storage && browser.storage.local) {
    if (browser.storage.local.get.length === 1) {
      // Promise-based (Firefox, with polyfill)
      browser.storage.local.get({ debugMode: false }).then((result) => {
        debugToggle.checked = !!result.debugMode;
      });
    } else {
      // Callback-based (Chrome)
      browser.storage.local.get({ debugMode: false }, (result) => {
        debugToggle.checked = !!result.debugMode;
      });
    }
  }
  debugToggle.addEventListener("change", () => {
    const debugMode = debugToggle.checked;
    if (browser.storage && browser.storage.local) {
      if (browser.storage.local.set.length === 1) {
        // Promise-based
        browser.storage.local.set({ debugMode });
      } else {
        // Callback-based
        browser.storage.local.set({ debugMode });
      }
    }
    // Notify background script to update debug mode
    if (browser.runtime && browser.runtime.sendMessage) {
      browser.runtime.sendMessage({ type: "set-debug-mode", debugMode });
    }
  });

  // Show last error if present
  const lastErrorSection = document.getElementById("last-error-section");
  const lastErrorMsg = document.getElementById("last-error-msg");
  if (browser.storage && browser.storage.local) {
    if (browser.storage.local.get.length === 1) {
      browser.storage.local.get(["lastError"]).then((result) => {
        if (result.lastError) {
          lastErrorSection.style.display = "block";
          lastErrorMsg.textContent = JSON.stringify(result.lastError, null, 2);
        }
      });
    } else {
      browser.storage.local.get(["lastError"], (result) => {
        if (result.lastError) {
          lastErrorSection.style.display = "block";
          lastErrorMsg.textContent = JSON.stringify(result.lastError, null, 2);
        }
      });
    }
  }
});
