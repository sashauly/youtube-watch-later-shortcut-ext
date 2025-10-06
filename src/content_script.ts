//
// Content Script for YouTube Watch Later Hotkeys Extension
// This script injects a customizable Watch Later button into the YouTube video actions section
// and ensures its state (added/not added) is synchronized with the native "Save" button
// across SPA navigations.
//
import browser from 'webextension-polyfill';

// --- Utility Constants ---
const WL_BUTTON_ID = 'ywhl-watch-later-button';
const LOG_PREFIX = '[WatchLaterExt:Content]';
// NOTE: Use a unique ID for the injected button to avoid conflicts
const INJECTED_BUTTON_ID = 'ywhl-custom-button';

const WL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true">
  <path clip-rule="evenodd" d="M20.5 12c0 4.694-3.806 8.5-8.5 8.5S3.5 16.694 3.5 12 7.306 3.5 12 3.5s8.5 3.806 8.5 8.5Zm1.5 0c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10Zm-9.25-5c0-.414-.336-.75-.75-.75s-.75.336-.75.75v5.375l.3.225 4 3c.331.248.802.181 1.05-.15.248-.331.181-.801-.15-1.05l-3.7-2.775V7Z" fill-rule="evenodd"></path>
</svg>`;

type ButtonDisplayMode = 'icon-only' | 'icon-and-text';

// --- Internal State and Cache ---
let currentVideoId: string | null = null;
let isCurrentlyInWL: boolean = false;
let nativeSaveButtonObserver: MutationObserver | null = null;
let injectionTimeout: number | null = null;
let buttonDisplayMode: ButtonDisplayMode = 'icon-and-text'; // DEFAULT SETTING
const DEBOUNCE_DELAY = 100;

// --- Event Dispatcher (Internal YT Action) ---

/** Generates the payload for the internal YouTube service request. */
function getActionParams(videoId: string, isAdding: boolean): object {
  const action = isAdding ? 'ACTION_ADD_VIDEO' : 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID';
  const videoKey = isAdding ? 'addedVideoId' : 'removedVideoId';

  return {
    clickTrackingParams: '',
    commandMetadata: {
      webCommandMetadata: {
        sendPost: true,
        apiUrl: '/youtubei/v1/browse/edit_playlist',
      },
    },
    playlistEditEndpoint: {
      playlistId: 'WL',
      actions: [{ [videoKey]: videoId, action: action }],
    },
  };
}

/** Sends the native YouTube action event. */
function sendNativeYouTubeAction(videoId: string, isAdding: boolean): void {
  // FIX: Explicitly cast query result to HTMLElement
  const appElement = document.querySelector('ytd-app') as HTMLElement | null;
  if (!appElement) return;

  const eventDetail = {
    detail: {
      actionName: 'yt-service-request',
      returnValue: [],
      args: [{ data: {} }, getActionParams(videoId, isAdding)],
      optionalAction: false,
    },
  };

  // Firefox compatibility check (required for cross-origin event dispatch)
  let eventData = eventDetail;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (window as any).cloneInto === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventData = (window as any).cloneInto(eventDetail, window);
  } else {
    // Standard browser behavior (Chrome, etc.)
    eventData = { detail: eventDetail.detail };
  }

  const event = new window.CustomEvent('yt-action', eventData);
  appElement.dispatchEvent(event);
  console.log(`${LOG_PREFIX} Dispatched ${isAdding ? 'Add' : 'Remove'} WL event for ${videoId}.`);
}

// --- State and UI Update Logic ---

/**
 * Toggles the button's visual state (icon, color, text) and updates internal state.
 */
function updateButtonState(button: HTMLButtonElement, newWLState: boolean): void {
  // FIX: Ensure the query selector returns an HTMLElement
  const iconDiv = button.querySelector(
    '.yt-spec-button-shape-next__icon div',
  ) as HTMLElement | null;
  const textDiv = button.querySelector(
    '.yt-spec-button-shape-next__button-text-content',
  ) as HTMLElement | null;

  const newText = newWLState ? 'Remove from Watch Later' : 'Watch Later';
  const displayMode = buttonDisplayMode;

  isCurrentlyInWL = newWLState; // Update internal state

  // 1. Update visual state (highlighting & Text Color FIX)
  if (newWLState) {
    // Saved/Highlighted state (red background)
    // FIX: Ensure style access is on an HTMLElement
    button.style.backgroundColor = 'var(--yt-spec-brand-button-background)';
    button.style.color = 'white';

    if (iconDiv) iconDiv.style.fill = 'white';
  } else {
    // Default tonal state (transparent background)
    button.style.backgroundColor = '';
    button.style.color = '';

    if (iconDiv) iconDiv.style.fill = 'currentcolor';
  }

  // 2. Update text and attributes
  button.title = newText;
  button.setAttribute('aria-label', newText);
  button.setAttribute('aria-pressed', newWLState.toString());
  if (textDiv) textDiv.textContent = newText;

  // 3. APPLY DISPLAY MODE
  if (displayMode === 'icon-only') {
    button.classList.remove('yt-spec-button-shape-next--icon-leading');
    // FIX: Ensure style access is on an HTMLElement
    if (textDiv) textDiv.style.display = 'none';
  } else {
    button.classList.add('yt-spec-button-shape-next--icon-leading');
    // FIX: Ensure style access is on an HTMLElement
    if (textDiv) textDiv.style.display = ''; // Restore default display
  }
}

/**
 * Checks the native "Save" button's state to determine if the video is in WL.
 */
function checkNativeSaveButtonState(): boolean {
  // Target the native "Save" button inside the action bar
  const nativeSaveButton = document.querySelector(
    'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Save"], ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Guardar"]',
  );

  if (nativeSaveButton) {
    // The most reliable indicator is the aria-pressed attribute
    return nativeSaveButton.getAttribute('aria-pressed') === 'true';
  }

  // Fallback check for initial load from WL list
  return window.location.href.includes('&list=WL');
}

/**
 * Sets up a MutationObserver to listen for state changes on the native Save button.
 */
function observeNativeSaveButton(): void {
  // 1. Clean up any existing observer
  if (nativeSaveButtonObserver) {
    nativeSaveButtonObserver.disconnect();
    nativeSaveButtonObserver = null;
  }

  // 2. Locate the native button and our custom button
  const nativeSaveButton = document.querySelector(
    'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Save"], ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Guardar"]',
  );
  // FIX: Use the specific ID for the inner button element for observation
  const buttonToUpdate = document.getElementById(INJECTED_BUTTON_ID) as HTMLButtonElement | null;

  if (!nativeSaveButton || !buttonToUpdate) {
    return;
  }

  // 3. Create observer
  nativeSaveButtonObserver = new MutationObserver(() => {
    const isSaved = checkNativeSaveButtonState();
    if (isSaved !== isCurrentlyInWL) {
      console.log(
        `${LOG_PREFIX} Native button changed state. Updating custom button to WL: ${isSaved}`,
      );
      updateButtonState(buttonToUpdate, isSaved);
    }
  });

  // Observe attribute changes (aria-pressed is crucial for state)
  nativeSaveButtonObserver.observe(nativeSaveButton, {
    attributes: true,
    attributeFilter: ['aria-pressed', 'title', 'aria-label'],
  });
}

// --- DOM Injection and Cleanup ---

/**
 * Creates the custom Watch Later button element.
 */
function createWatchLaterButton(): HTMLElement {
  const initialState = checkNativeSaveButtonState();
  isCurrentlyInWL = initialState;

  const actionText = initialState ? 'Remove from Watch Later' : 'Watch Later';
  const displayMode = buttonDisplayMode;

  // Determine initial button classes based on display mode
  const buttonClassModifier =
    displayMode === 'icon-only' ? '' : 'yt-spec-button-shape-next--icon-leading';

  // 1. Create the <yt-button-view-model> wrapper (Crucial for YT styling inheritance)
  const buttonWrapper = document.createElement('yt-button-view-model');
  buttonWrapper.className = 'ytd-menu-renderer';
  buttonWrapper.id = WL_BUTTON_ID; // Wrapper ID

  // Use innerHTML for creating the complex button structure
  buttonWrapper.innerHTML = `
    <button-view-model class="ytSpecButtonViewModelHost style-scope ytd-menu-renderer">
      <button
        id="${INJECTED_BUTTON_ID}"
        class="yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m ${buttonClassModifier} yt-spec-button-shape-next--enable-backdrop-filter-experiment"
        title="${actionText}"
        aria-label="${actionText}"
        aria-disabled="false"
        aria-pressed="${initialState}"
      >
        <div aria-hidden="true" class="yt-spec-button-shape-next__icon">
          <span class="ytIconWrapperHost" style="width: 24px; height: 24px">
            <span class="yt-icon-shape ytSpecIconShapeHost">
              <div style="width: 100%; height: 100%; display: block; fill: currentcolor">
                ${WL_ICON_SVG}
              </div>
            </span>
          </span>
        </div>
        <div class="yt-spec-button-shape-next__button-text-content" 
             style="display: ${displayMode === 'icon-only' ? 'none' : ''};">${actionText}</div>
        <yt-touch-feedback-shape aria-hidden="true" class="yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response">
          <div class="yt-spec-touch-feedback-shape__stroke"></div>
          <div class="yt-spec-touch-feedback-shape__fill"></div>
        </yt-touch-feedback-shape>
      </button>
    </button-view-model>`;

  const buttonElement = buttonWrapper.querySelector(`#${INJECTED_BUTTON_ID}`) as HTMLButtonElement;

  // Call updateButtonState to finalize colors based on initial state and preference
  updateButtonState(buttonElement, initialState);

  // Add click listener
  buttonElement.addEventListener('click', () => {
    sendNativeYouTubeAction(currentVideoId!, !isCurrentlyInWL);
    updateButtonState(buttonElement, !isCurrentlyInWL);
  });

  return buttonWrapper;
}

/**
 * Disconnects the observer and removes the custom button.
 */
function cleanupPreviousButton(): void {
  if (nativeSaveButtonObserver) {
    nativeSaveButtonObserver.disconnect();
    nativeSaveButtonObserver = null;
  }
  const existingButton = document.getElementById(WL_BUTTON_ID);
  if (existingButton) {
    // .remove() is safe on Element type
    existingButton.remove();
  }
  currentVideoId = null;
  isCurrentlyInWL = false;
}

/**
 * Executes the main injection function after a short delay,
 * cancelling any previous calls to prevent running the expensive
 * logic too many times during rapid SPA navigation.
 */
function debouncedInjectWatchLaterButton(): void {
  if (injectionTimeout !== null) {
    clearTimeout(injectionTimeout);
  }
  // Cast to number is safe for setTimeout return in browser context
  injectionTimeout = setTimeout(() => {
    injectWatchLaterButton();
    injectionTimeout = null;
  }, DEBOUNCE_DELAY) as unknown as number;
}

/**
 * Main injection function to run after DOM is ready.
 */
function injectWatchLaterButton(): void {
  const buttonsContainer = document.getElementById('top-level-buttons-computed');
  const location = new URL(window.location.href);

  // Get the ID from the current URL
  const nextVideoId =
    location.searchParams.get('v') ||
    (location.pathname.startsWith('/shorts/') ? location.pathname.split('/')[2] : null);

  // 1. --- Navigation Check ---
  if (nextVideoId === currentVideoId) {
    const existingButtonWrapper = document.getElementById(WL_BUTTON_ID);
    if (existingButtonWrapper) {
      const button = existingButtonWrapper.querySelector(
        `#${INJECTED_BUTTON_ID}`,
      ) as HTMLButtonElement | null;
      // Same video, button exists: just ensure state is up-to-date
      if (button) updateButtonState(button, checkNativeSaveButtonState());
      return;
    }
  }

  // 2. --- Video ID Change/Cleanup ---
  if (nextVideoId !== currentVideoId) {
    console.log(`${LOG_PREFIX} Navigated. Cleaning up old button (ID: ${currentVideoId}).`);
    cleanupPreviousButton();
    currentVideoId = nextVideoId;
  }

  if (!buttonsContainer || !currentVideoId) {
    console.log(`${LOG_PREFIX} Injection skipped: Container not found or not a valid video page.`);
    return;
  }

  // --- 3. Injection Logic ---

  console.log(`${LOG_PREFIX} Injecting button for new video ID: ${currentVideoId}`);
  const newButton = createWatchLaterButton();

  // Insertion Point Logic: Find the element after Like/Dislike
  const segmentedButton = buttonsContainer.querySelector(
    'segmented-like-dislike-button-view-model',
  );
  let insertBeforeElement: Element | null = null;

  if (segmentedButton && segmentedButton.nextElementSibling) {
    insertBeforeElement = segmentedButton.nextElementSibling;
  } else {
    // Fallback: Try to find the Share button explicitly.
    insertBeforeElement = buttonsContainer.querySelector(
      'yt-button-view-model[aria-label="Share"], yt-button-view-model:nth-child(3)',
    );
  }

  if (insertBeforeElement) {
    buttonsContainer.insertBefore(newButton, insertBeforeElement);
  } else {
    buttonsContainer.appendChild(newButton);
  }

  console.log(`${LOG_PREFIX} Starting state observation.`);
  observeNativeSaveButton();
}

// --- Startup Logic (SPA Reliability & Preference Handling) ---

function handlePreferenceUpdate(newMode: ButtonDisplayMode) {
  if (newMode === buttonDisplayMode) return;

  console.log(`${LOG_PREFIX} Preference updated: ${newMode}`);
  buttonDisplayMode = newMode;

  // If the button exists on the current page, re-inject/update its style immediately
  const existingButtonWrapper = document.getElementById(WL_BUTTON_ID);
  if (existingButtonWrapper) {
    // FIX: Use the specific inner button ID for casting
    const button = existingButtonWrapper.querySelector(
      `#${INJECTED_BUTTON_ID}`,
    ) as HTMLButtonElement | null;
    if (button) {
      updateButtonState(button, isCurrentlyInWL);
      return;
    }
  }

  // If no button exists but we are on a video page, trigger a re-injection attempt
  debouncedInjectWatchLaterButton();
}

function initializeContentScript() {
  // Placeholder for receiving messages from the background script
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    // FIX: Use 'unknown' for the message parameter to satisfy the polyfill's type
    browser.runtime.onMessage.addListener((message: unknown) => {
      // Type assertion for the expected message structure
      const msg = message as { type: string; mode: ButtonDisplayMode };

      // FIX: The original error check used a comparison that would never be true.
      // We check if the type is correct and the mode is one of the expected strings.
      if (
        msg.type === 'UPDATE_BUTTON_STYLE' &&
        (msg.mode === 'icon-only' || msg.mode === 'icon-and-text')
      ) {
        handlePreferenceUpdate(msg.mode);
      }
    });
  }

  // 1. Listen for the native YouTube navigation finish event (Most reliable trigger for SPA)
  document.addEventListener('yt-navigate-finish', () => {
    debouncedInjectWatchLaterButton();
  });

  // 2. Initial call (for the first page load)
  setTimeout(debouncedInjectWatchLaterButton, 500);

  // 3. Simple MutationObserver fallback for rare edge cases (e.g., first load of homepage)
  const initialObserver = new MutationObserver((_mutationsList, observer) => {
    const container = document.getElementById('top-level-buttons-computed');
    // We only inject if the container appears AND our button is NOT already there
    if (container && !document.getElementById(WL_BUTTON_ID)) {
      injectWatchLaterButton();
      observer.disconnect(); // Stop the initial observer once the container is found
    }
  });

  // FIX: Ensure 'page-manager' is treated as an HTMLElement
  const appElement = document.getElementById('page-manager') as HTMLElement | null;
  if (appElement) {
    initialObserver.observe(appElement, { childList: true, subtree: true });
  }
}

// Start the whole process
initializeContentScript();
