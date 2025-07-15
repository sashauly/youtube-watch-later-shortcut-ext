//
// Copyright (C) 2025 WorldThirteen
// 
// Modified by sashauly.code@gmail.com
// Changes: Merged 2 files for chrome and firefox browser into one,
// added checking for video and Shorts on current tab,
// addded debug mode with verbose logging,
// added error logging for failed actions,
// added context menu for toggling debug mode and opening shortcuts settings
// 
// This file is part of youtube-watch-later-shortcut-ext.
// 
// youtube-watch-later-shortcut-ext is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// youtube-watch-later-shortcut-ext is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with youtube-watch-later-shortcut-ext.  If not, see <https://www.gnu.org/licenses/>.

// Polyfill for browser API
if (typeof browser === 'undefined') {
  var browser = chrome;
}

// Helper for Firefox's cloneInto
function maybeCloneInto(obj, targetWindow) {
  if (typeof cloneInto === 'function') {
    return cloneInto(obj, targetWindow);
  }
  return obj;
}

let DEBUG = false;

function logDebug(...args) {
  if (DEBUG) {
    console.log('[WatchLaterExt]', ...args);
  }
}

function setLastError(context) {
  if (browser.storage && browser.storage.local) {
    const errorObj = {
      ...context,
      timestamp: new Date().toISOString(),
    };
    if (browser.storage.local.set.length === 1) {
      browser.storage.local.set({ lastError: errorObj });
    } else {
      browser.storage.local.set({ lastError: errorObj });
    }
  }
}

function logError(...args) {
  if (DEBUG) {
    console.error('[WatchLaterExt]', ...args);
  }
  if (args[0] && typeof args[0] === 'object' && args[0].isErrorContext) {
    setLastError(args[0]);
  }
}

// --- Context Menu Setup ---
function createContextMenus() {
  if (!browser.contextMenus) return;
  browser.contextMenus.removeAll(() => {
    browser.contextMenus.create({
      id: 'toggle-debug',
      title: 'Toggle Debug Mode',
      contexts: ['action'],
    });
    browser.contextMenus.create({
      id: 'open-shortcuts',
      title: 'Open Shortcut Settings',
      contexts: ['action'],
    });
  });
}

if (browser.contextMenus && browser.contextMenus.onClicked) {
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'toggle-debug') {
      if (browser.storage && browser.storage.local) {
        if (browser.storage.local.get.length === 1) {
          browser.storage.local.get({ debugMode: false }).then((result) => {
            const newDebug = !result.debugMode;
            browser.storage.local.set({ debugMode: newDebug });
            DEBUG = newDebug;
            logDebug('Debug mode toggled via context menu:', DEBUG);
          });
        } else {
          browser.storage.local.get({ debugMode: false }, (result) => {
            const newDebug = !result.debugMode;
            browser.storage.local.set({ debugMode: newDebug });
            DEBUG = newDebug;
            logDebug('Debug mode toggled via context menu:', DEBUG);
          });
        }
      }
    } else if (info.menuItemId === 'open-shortcuts') {
      const isFirefox = typeof InstallTrigger !== 'undefined';
      const url = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts';
      if (browser.tabs && browser.tabs.create) {
        browser.tabs.create({ url });
      }
    }
  });
}

if (browser.runtime && browser.runtime.onInstalled) {
  browser.runtime.onInstalled.addListener(() => {
    createContextMenus();
  });
}
createContextMenus();

// --- End Context Menu Setup ---

function initDebugMode() {
  if (browser.storage && browser.storage.local) {
    if (browser.storage.local.get.length === 1) {
      // Promise-based (Firefox, polyfill)
      browser.storage.local.get({ debugMode: false }).then((result) => {
        DEBUG = !!result.debugMode;
        logDebug('Debug mode initialized:', DEBUG);
      });
    } else {
      // Callback-based (Chrome)
      browser.storage.local.get({ debugMode: false }, (result) => {
        DEBUG = !!result.debugMode;
        logDebug('Debug mode initialized:', DEBUG);
      });
    }
  }
}
initDebugMode();

if (browser.runtime && browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'set-debug-mode') {
      DEBUG = !!msg.debugMode;
      logDebug('Debug mode set to:', DEBUG);
    }
  });
}

logDebug('Background script loaded.');

function executeYouTubeCommand(action) {
  const getAddVideoParams = (videoId) => ({
    clickTrackingParams: '',
    commandMetadata: {
      webCommandMetadata: {
        sendPost: true,
        apiUrl: '/youtubei/v1/browse/edit_playlist',
      },
    },
    playlistEditEndpoint: {
      playlistId: 'WL',
      actions: [{ addedVideoId: videoId, action: 'ACTION_ADD_VIDEO' }],
    },
  });

  const getRemoveVideoParams = (videoId) => ({
    clickTrackingParams: '',
    commandMetadata: {
      webCommandMetadata: {
        sendPost: true,
        apiUrl: '/youtubei/v1/browse/edit_playlist',
      },
    },
    playlistEditEndpoint: {
      playlistId: 'WL',
      actions: [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }],
    },
  });

  const sendActionToNativeYouTubeHandler = (getParams) => {
    const location = new URL(window.location.href);
    const appElement = document.querySelector('ytd-app');
    let videoId = location.searchParams.get('v');

    if (location.pathname.startsWith('/shorts/')) {
      videoId = location.pathname.split('/')[2];
    }

    if (!videoId || !appElement) {
      return;
    }

    let eventDetail = {
      detail: {
        actionName: 'yt-service-request',
        returnValue: [],
        args: [{ data: {} }, getParams(videoId)],
        optionalAction: false,
      },
    };

     if (typeof cloneInto === 'function') {
    eventDetail = cloneInto(obj, window);
  }

    const event = new window.CustomEvent('yt-action', {...eventDetail});

    appElement.dispatchEvent(event);
  };

  try {
    if (action === 'add-to-watch-later') {
      sendActionToNativeYouTubeHandler(getAddVideoParams);
    }
    if (action === 'remove-from-watch-later') {
      sendActionToNativeYouTubeHandler(getRemoveVideoParams);
    }
  } catch (error) {
    console.warn('Error while sending message to native YouTube handler', error);
  }
}

browser.commands.onCommand.addListener(async (command) => {
  logDebug(`Command registered: ${command}`);
  if (command === 'add-to-watch-later' || command === 'remove-from-watch-later') {
    const startTime = Date.now();
    const [activeYouTubeTab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
      url: 'https://www.youtube.com/*',
    });

    if (!activeYouTubeTab) {
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: null,
          videoId: null,
          message: 'No active YouTube tab detected.',
          stack: null,
        },
        'No active YouTube tab detected.',
      );
      return;
    }

    const isVideo = isYouTubeVideo(activeYouTubeTab.url);
    const isShorts = isYouTubeShorts(activeYouTubeTab.url);

    if (!isVideo && !isShorts) {
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: activeYouTubeTab.url,
          videoId: null,
          message: 'Active tab is not a YouTube video or Shorts.',
          stack: null,
        },
        'Active tab is not a YouTube video or Shorts.',
        activeYouTubeTab.url,
      );
      return;
    }

    let videoId = null;
    if (isShorts) {
      const url = new URL(activeYouTubeTab.url);
      videoId = url.pathname.split('/')[2];
    } else if (isVideo) {
      const url = new URL(activeYouTubeTab.url);
      videoId = url.searchParams.get('v');
    }
    logDebug(`Tab URL: ${activeYouTubeTab.url}`);
    logDebug(`Video ID: ${videoId}`);
    logDebug(`Type: ${isShorts ? 'Shorts' : 'Video'}`);

    try {
      logDebug(`Executing command: ${command} on tab ${activeYouTubeTab.id}`);
      await browser.scripting.executeScript({
        target: { tabId: activeYouTubeTab.id },
        func: executeYouTubeCommand,
        args: [command],
      });
      const elapsed = Date.now() - startTime;
      logDebug(
        command === 'add-to-watch-later'
          ? `Video added to Watch Later! (${elapsed}ms)`
          : `Video removed from Watch Later! (${elapsed}ms)`,
      );
    } catch (error) {
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: activeYouTubeTab.url,
          videoId,
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : null,
        },
        'Failed to execute action on the YouTube tab.',
        error,
        error && error.stack,
      );
    }
  }
});
function isYouTubeVideo(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.searchParams.has('v') && u.pathname === '/watch';
  } catch {
    return false;
  }
}

function isYouTubeShorts(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isYouTubeVideo, isYouTubeShorts };
}
