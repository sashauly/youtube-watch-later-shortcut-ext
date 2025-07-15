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

import browser from 'webextension-polyfill';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const InstallTrigger: any | undefined;
declare function cloneInto<T>(obj: T, targetScope: Window): T;

let DEBUG = false;

function logDebug(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[watch-later-hotkeys]', ...args);
  }
}

interface ErrorContext {
  isErrorContext: true;
  action: string;
  tabUrl: string | null;
  videoId: string | null;
  message: string;
  stack: string | null;
  [key: string]: unknown;
}

function setLastError(context: ErrorContext): void {
  if (browser.storage && browser.storage.local) {
    const errorObj = {
      ...context,
      timestamp: new Date().toISOString(),
    };
    // Always use Promise-based API for polyfill compatibility
    browser.storage.local.set({ lastError: errorObj });
  }
}

function logError(...args: unknown[]): void {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.error('[WatchLaterExt]', ...args);
  }
  const first = args[0];
  if (first && typeof first === 'object' && (first as ErrorContext).isErrorContext) {
    setLastError(first as ErrorContext);
  }
}

// --- Context Menu Setup ---
function createContextMenus(): void {
  if (!browser.contextMenus) return;
  browser.contextMenus.removeAll().then(() => {
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
  browser.contextMenus.onClicked.addListener(
    (info: browser.Menus.OnClickData, tab?: browser.Tabs.Tab) => {
      if (info.menuItemId === 'toggle-debug') {
        if (browser.storage && browser.storage.local) {
          browser.storage.local.get({ debugMode: false }).then((result) => {
            const newDebug = !result.debugMode;
            browser.storage.local.set({ debugMode: newDebug });
            DEBUG = newDebug;
            logDebug('Debug mode toggled via context menu:', DEBUG);
          });
        }
      } else if (info.menuItemId === 'open-shortcuts') {
        const isFirefox = typeof InstallTrigger !== 'undefined';
        const url = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts';
        if (browser.tabs && browser.tabs.create) {
          browser.tabs.create({ url });
        }
      }
    },
  );
}

if (browser.runtime && browser.runtime.onInstalled) {
  browser.runtime.onInstalled.addListener(() => {
    createContextMenus();
  });
}
createContextMenus();
// --- End Context Menu Setup ---

function initDebugMode(): void {
  if (browser.storage && browser.storage.local) {
    browser.storage.local.get({ debugMode: false }).then((result) => {
      DEBUG = !!result.debugMode;
      logDebug('Debug mode initialized:', DEBUG);
    });
  }
}
initDebugMode();

if (browser.runtime && browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener(
    (
      msg: unknown,
      sender: browser.Runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'set-debug-mode') {
        DEBUG = !!(msg as { debugMode?: boolean }).debugMode;
        logDebug('Debug mode set to:', DEBUG);
      }
    },
  );
}

logDebug('Background script loaded.');

function executeYouTubeCommand(action: 'add-to-watch-later' | 'remove-from-watch-later'): void {
  const getAddVideoParams = (videoId: string) => ({
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

  const getRemoveVideoParams = (videoId: string) => ({
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

  const sendActionToNativeYouTubeHandler = (getParams: (videoId: string) => object) => {
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
      eventDetail = cloneInto(eventDetail, window);
    }

    const event = new window.CustomEvent('yt-action', { ...eventDetail });
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
    // eslint-disable-next-line no-console
    console.warn('Error while sending message to native YouTube handler', error);
  }
}

browser.commands.onCommand.addListener(async (command: string) => {
  logDebug(`Command registered: ${command}`);
  if (command === 'add-to-watch-later' || command === 'remove-from-watch-later') {
    const startTime = Date.now();
    const tabs = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
      url: 'https://www.youtube.com/*',
    });
    const activeYouTubeTab = tabs[0];

    if (!activeYouTubeTab || !activeYouTubeTab.url || typeof activeYouTubeTab.id !== 'number') {
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: activeYouTubeTab?.url ?? null,
          videoId: null,
          message: 'No active YouTube tab detected.',
          stack: null,
        } as ErrorContext,
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
        } as ErrorContext,
        'Active tab is not a YouTube video or Shorts.',
        activeYouTubeTab.url,
      );
      return;
    }

    let videoId: string | null = null;
    try {
      const url = new URL(activeYouTubeTab.url);
      if (isShorts) {
        videoId = url.pathname.split('/')[2] || null;
      } else if (isVideo) {
        videoId = url.searchParams.get('v');
      }
    } catch {
      videoId = null;
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
      const err = error as { message?: string; stack?: string };
      logError(
        {
          isErrorContext: true,
          action: command,
          tabUrl: activeYouTubeTab.url,
          videoId,
          message: err && err.message ? err.message : String(error),
          stack: err && err.stack ? err.stack : null,
        } as ErrorContext,
        'Failed to execute action on the YouTube tab.',
        error,
        err && err.stack,
      );
    }
  }
});

export function isYouTubeVideo(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.searchParams.has('v') && u.pathname === '/watch';
  } catch {
    return false;
  }
}

export function isYouTubeShorts(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}
