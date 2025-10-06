//
// Copyright (C) 2025 WorldThirteen
//
// Modified by sashauly.code@gmail.com
// Changes: Merged 2 files for chrome and firefox browser into one,
// added checking for video and Shorts on current tab,
// added debug mode with verbose logging,
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

import browser from 'webextension-polyfill';

// --- Constants and State ---

const WL_PLAYLIST_ID = 'WL';
const API_URL = '/youtubei/v1/browse/edit_playlist';
const SHORTCUTS_URL_FIREFOX = 'about:addons';
const SHORTCUTS_URL_CHROME = 'chrome://extensions/shortcuts';
const LOG_PREFIX = '[WatchLaterExt]';

// New constants for preferences
type ButtonDisplayMode = 'icon-only' | 'icon-and-text';
const DEFAULT_BUTTON_MODE: ButtonDisplayMode = 'icon-and-text';
const BUTTON_MODE_KEY = 'buttonDisplayMode';

let DEBUG = false;
let buttonDisplayMode: ButtonDisplayMode = DEFAULT_BUTTON_MODE;

// --- Utility Functions ---

/** Checks if the current environment is Firefox (only useful in the background script). */
function isFirefox(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (globalThis as any).InstallTrigger !== 'undefined';
}

function logDebug(...args: unknown[]): void {
  if (DEBUG) {
    console.log(LOG_PREFIX, ...args);
  }
}

/** Determines if a URL points to a standard YouTube video (e.g., /watch?v=...) */
function isYouTubeVideo(url: string): boolean {
  try {
    const u = new URL(url);
    // Explicitly check for both hostname and pathname for greater certainty.
    return u.hostname === 'www.youtube.com' && u.pathname === '/watch' && u.searchParams.has('v');
  } catch {
    return false;
  }
}

/** Determines if a URL points to a YouTube Shorts video (e.g., /shorts/...) */
function isYouTubeShorts(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'www.youtube.com' &&
      u.pathname.startsWith('/shorts/') &&
      u.pathname.split('/').length > 2
    );
  } catch {
    return false;
  }
}

// --- Error & Debug Management ---

interface ErrorContext {
  isErrorContext: true;
  action: string;
  tabUrl: string | null;
  videoId: string | null;
  message: string;
  stack: string | null;
  [key: string]: unknown;
}

/** Writes error context to local storage without throwing an error if storage fails. */
function setLastError(context: ErrorContext): void {
  if (browser.storage?.local) {
    const errorObj = {
      ...context,
      timestamp: new Date().toISOString(),
    };
    // Use Promise-based API and catch errors on storage failure
    browser.storage.local.set({ lastError: errorObj }).catch((e) => {
      console.warn(`${LOG_PREFIX} Failed to save lastError to storage:`, e);
    });
  }
}

function logError(...args: unknown[]): void {
  if (DEBUG) {
    console.error(LOG_PREFIX, ...args);
  }
  const first = args[0];
  if (first && typeof first === 'object' && (first as ErrorContext).isErrorContext) {
    setLastError(first as ErrorContext);
  }
}

/** Loads debug mode state from storage on script initialization. */
function initDebugMode(): void {
  if (browser.storage?.local) {
    browser.storage.local.get({ debugMode: false }).then((result) => {
      DEBUG = !!result.debugMode;
      logDebug('Debug mode initialized:', DEBUG);
    });
  }
}

// --- NEW: Preference Loading and Management ---

async function loadPreferences(): Promise<void> {
  if (browser.storage?.sync) {
    try {
      const result = await browser.storage.sync.get({ [BUTTON_MODE_KEY]: DEFAULT_BUTTON_MODE });
      buttonDisplayMode = result[BUTTON_MODE_KEY] as ButtonDisplayMode;
      logDebug(`Preferences loaded. Button mode: ${buttonDisplayMode}`);
    } catch (e) {
      logError(
        {
          isErrorContext: true,
          action: 'load-preferences',
          tabUrl: null,
          videoId: null,
          message: 'Failed to load button style preference from storage.',
          stack: (e as Error)?.stack ?? null,
          error: e,
        },
        'Failed to load preferences:',
        e,
      );
    }
  }
}

/**
 * Sends the current button style preference to a specific tab's content script.
 * @param tabId The ID of the tab to send the message to.
 */
async function sendStyleUpdateToTab(tabId: number): Promise<void> {
  if (browser.tabs?.sendMessage) {
    logDebug(`Sending style update to tab ${tabId}. Mode: ${buttonDisplayMode}`);
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'UPDATE_BUTTON_STYLE',
        mode: buttonDisplayMode,
      });
    } catch (e) {
      // This is expected if the content script hasn't fully loaded yet.
      logDebug(`Could not send message to tab ${tabId}. Likely content script not ready.`, e);
    }
  }
}

// --- Listeners for Preference and Tab Changes ---

// 1. Listen for storage changes from an options page
if (browser.storage?.onChanged) {
  browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'sync' && changes[BUTTON_MODE_KEY]) {
      const newMode = changes[BUTTON_MODE_KEY].newValue as ButtonDisplayMode;
      if (newMode && newMode !== buttonDisplayMode) {
        logDebug(`Storage changed. New button mode: ${newMode}`);
        buttonDisplayMode = newMode;

        // Get all active YouTube tabs and notify them of the change
        const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
        for (const tab of tabs) {
          if (tab.id) {
            // Send the message to instantly update the content script's state
            await sendStyleUpdateToTab(tab.id);
          }
        }
      }
    }
  });
}

// 2. Send preferences when a tab is updated (e.g., page load/refresh/SPA transition)
if (browser.tabs?.onUpdated) {
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only act on complete loads of YouTube pages
    if (changeInfo.status === 'complete' && tab.url?.startsWith('https://www.youtube.com/')) {
      await sendStyleUpdateToTab(tabId);
    }
  });
}

// --- Context Menu Handlers (No changes required here, keeping for completeness) ---

function createContextMenus(): void {
  // Use optional chaining for safety, though polyfill should ensure existence.
  if (!browser.contextMenus) {
    logDebug('Context Menu API not available.');
    return;
  }

  logDebug('Attempting to create context menus...');

  // Use removeAll().then() to ensure a clean slate before creation
  browser.contextMenus
    .removeAll()
    .then(() => {
      logDebug('Existing context menus removed successfully.');

      const createMenuItem = (id: string, title: string): Promise<void> => {
        return Promise.resolve(
          browser.contextMenus.create({
            id: id,
            title: title,
            contexts: ['action'], // 'action' targets the extension icon
          }),
        )
          .then(() => {
            logDebug(`Context menu item "${title}" created successfully (ID: ${id}).`);
          })
          .catch((e: unknown) => {
            logError(
              {
                isErrorContext: true,
                action: `create-menu-${id}`,
                tabUrl: null,
                videoId: null,
                message: `Failed to create context menu item: ${title}`,
                stack: (e as Error)?.stack ?? null,
                error: e,
              },
              `Failed to create context menu item: ${title}`,
              e,
            );
          });
      };

      // Create menu items and wait for both to complete
      return Promise.all([
        createMenuItem('toggle-debug', 'Toggle Debug Mode'),
        createMenuItem('open-shortcuts', 'Open Shortcut Settings'),
      ]);
    })
    .catch((e: unknown) => {
      logError(
        {
          isErrorContext: true,
          action: 'context-menu-setup',
          tabUrl: null,
          videoId: null,
          message: 'Failed to clear or initialize context menus.',
          stack: (e as Error)?.stack ?? null,
          error: e,
        },
        'CRITICAL: Failed to clear or initialize context menus.',
        e,
      );
    });
}

// 1. Listen for Installation/Update
if (browser.runtime.onInstalled) {
  browser.runtime.onInstalled.addListener(() => {
    logDebug('Extension installed/updated. Creating context menus...');
    createContextMenus();
  });
}

// 2. Listen for Browser Startup (More Robust)
if (browser.runtime.onStartup) {
  browser.runtime.onStartup.addListener(() => {
    logDebug('Browser started up. Re-creating context menus...');
    createContextMenus();
  });
}

// 3. Immediate Call (for development reloads)
logDebug('Executing immediate createContextMenus call...');
createContextMenus();
// --- End Context Menu Setup ---

if (browser.contextMenus?.onClicked) {
  browser.contextMenus.onClicked.addListener((info: browser.Menus.OnClickData) => {
    if (info.menuItemId === 'toggle-debug' && browser.storage?.local) {
      browser.storage.local
        .get({ debugMode: false })
        .then((result) => {
          const newDebug = !result.debugMode;
          browser.storage.local.set({ debugMode: newDebug });
          DEBUG = newDebug; // Update local state immediately
          logDebug('Debug mode toggled via context menu:', DEBUG);
        })
        .catch((e) => logError('Failed to toggle debug mode in storage:', e));
    } else if (info.menuItemId === 'open-shortcuts' && browser.tabs?.create) {
      const url = isFirefox() ? SHORTCUTS_URL_FIREFOX : SHORTCUTS_URL_CHROME;
      browser.tabs
        .create({ url })
        .catch((e) => logError('Failed to open shortcuts settings tab:', e));
    }
  });
}

// --- YouTube Action Execution (Runs as Content Script) ---
// (The command logic remains unchanged as it is independent of button style)

type YouTubeAction = 'add-to-watch-later' | 'remove-from-watch-later';

// ... (getAddVideoParams, getRemoveVideoParams, executeYouTubeCommand functions remain the same) ...
function getAddVideoParams(videoId: string): object {
  return {
    clickTrackingParams: '',
    commandMetadata: {
      webCommandMetadata: {
        sendPost: true,
        apiUrl: API_URL,
      },
    },
    playlistEditEndpoint: {
      playlistId: WL_PLAYLIST_ID,
      actions: [{ addedVideoId: videoId, action: 'ACTION_ADD_VIDEO' }],
    },
  };
}
function getRemoveVideoParams(videoId: string): object {
  return {
    clickTrackingParams: '',
    commandMetadata: {
      webCommandMetadata: {
        sendPost: true,
        apiUrl: API_URL,
      },
    },
    playlistEditEndpoint: {
      playlistId: WL_PLAYLIST_ID,
      actions: [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }],
    },
  };
}
function executeYouTubeCommand(action: YouTubeAction): void {
  // This is a minimal implementation of logDebug, as the full logError/logDebug
  // infrastructure is complex to pass to the content script.
  const contentLogDebug = (...args: unknown[]) => {
    console.log('[WatchLaterExt:Content]', ...args);
  };

  const sendActionToNativeYouTubeHandler = (getParams: (videoId: string) => object) => {
    // Use `window.location` in the content script context
    const location = new URL(window.location.href);
    const appElement = document.querySelector('ytd-app');

    // Get video ID from URL
    let videoId = location.searchParams.get('v');
    if (location.pathname.startsWith('/shorts/')) {
      // Short-circuit the split for performance/clarity
      const pathSegments = location.pathname.split('/');
      videoId = pathSegments.length >= 3 ? pathSegments[2] : null;
    }

    if (!videoId || !appElement) {
      console.warn('[WatchLaterExt:Content] Could not find videoId or ytd-app element.');
      return;
    }

    let eventDetail: object = {
      actionName: 'yt-service-request',
      returnValue: [],
      args: [{ data: {} }, getParams(videoId)],
      optionalAction: false,
    };

    // Firefox requires objects passed across the content script/page boundary to be "cloned"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (window as any).cloneInto === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventDetail = (window as any).cloneInto({ detail: eventDetail }, window);
    } else {
      eventDetail = { detail: eventDetail };
    }

    // Dispatch the CustomEvent on the ytd-app element
    const event = new window.CustomEvent('yt-action', eventDetail);
    appElement.dispatchEvent(event);
    contentLogDebug(`Dispatched '${action}' event for video ID: ${videoId}`);
  };

  try {
    const paramsGenerator =
      action === 'add-to-watch-later' ? getAddVideoParams : getRemoveVideoParams;

    sendActionToNativeYouTubeHandler(paramsGenerator);
  } catch (error) {
    console.error('[WatchLaterExt:Content] Error during execution:', error);
  }
}

// --- Main Command Listener ---
// (Remains the same)

browser.commands.onCommand.addListener(async (command: string) => {
  const startTime = Date.now();
  logDebug(`Command registered: ${command}`);

  if (command !== 'add-to-watch-later' && command !== 'remove-from-watch-later') {
    return;
  }

  // --- HOIST DECLARATIONS HERE ---
  let activeYouTubeTab: browser.Tabs.Tab | undefined;
  let videoId: string | null = null;
  // --- END HOIST ---

  try {
    const tabs = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
      url: 'https://www.youtube.com/*',
    });
    activeYouTubeTab = tabs[0];

    // Early exit if no valid tab is found
    if (!activeYouTubeTab?.url || typeof activeYouTubeTab.id !== 'number') {
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: activeYouTubeTab?.url ?? null,
          videoId: null,
          message: 'No active YouTube tab detected.',
          stack: null,
        },
        'No active YouTube tab detected.',
      );
      return;
    }

    const { url, id: tabId } = activeYouTubeTab;
    const isVideo = isYouTubeVideo(url);
    const isShorts = isYouTubeShorts(url);

    if (!isVideo && !isShorts) {
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: url,
          videoId: null,
          message: 'Active tab is not a YouTube video or Shorts.',
          stack: null,
        },
        'Active tab is not a YouTube video or Shorts.',
        url,
      );
      return;
    }

    videoId = null;
    try {
      const u = new URL(url);
      if (isShorts) {
        videoId = u.pathname.split('/')[2] || null;
      } else if (isVideo) {
        videoId = u.searchParams.get('v');
      }
    } catch {
      // Should not happen if isYouTubeVideo/isYouTubeShorts passed, but safe to catch.
      videoId = null;
    }

    logDebug(`Tab URL: ${url}`);
    logDebug(`Video ID: ${videoId}`);
    logDebug(`Type: ${isShorts ? 'Shorts' : 'Video'}`);

    if (!videoId) {
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: url,
          videoId: null,
          message: 'Could not extract Video ID from URL.',
          stack: null,
        },
        'Could not extract Video ID from URL.',
        url,
      );
      return;
    }

    logDebug(`Executing command: ${command} on tab ${tabId}`);

    // The command argument is explicitly typed in this scope, so we can cast it.
    await browser.scripting.executeScript({
      target: { tabId },
      func: executeYouTubeCommand,
      args: [command as YouTubeAction],
    });

    const elapsed = Date.now() - startTime;
    logDebug(
      command === 'add-to-watch-later'
        ? `Video added to Watch Later! (${elapsed}ms)`
        : `Video removed from Watch Later! (${elapsed}ms)`,
    );
  } catch (error) {
    const err = error as { message?: string; stack?: string };
    const errorContext: ErrorContext = {
      isErrorContext: true,
      action: command,
      tabUrl: activeYouTubeTab?.url ?? null,
      videoId: videoId ?? null, // use the variable from the try block
      message: err?.message ?? String(error),
      stack: err?.stack ?? null,
    };
    logError(errorContext, 'Failed to execute action on the YouTube tab.', error);
  }
});

// --- Initialization ---

initDebugMode();
loadPreferences(); // NEW: Load preferences on startup
logDebug('Background script loaded.');
