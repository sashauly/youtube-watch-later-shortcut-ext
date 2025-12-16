import browser from 'webextension-polyfill';

const WL_BUTTON_ID = 'ywhl-watch-later-button';
const LOG_PREFIX = '[WatchLaterExt:Content]';
const INJECTED_BUTTON_ID = 'ywhl-custom-button';
const WL_ICON_SVG_INACTIVE = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true">
  <path clip-rule="evenodd" d="M20.5 12c0 4.694-3.806 8.5-8.5 8.5S3.5 16.694 3.5 12 7.306 3.5 12 3.5s8.5 3.806 8.5 8.5Zm1.5 0c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10Zm-9.25-5c0-.414-.336-.75-.75-.75s-.75.336-.75.75v5.375l.3.225 4 3c.331.248.802.181 1.05-.15.248-.331.181-.801-.15-1.05l-3.7-2.775V7Z" fill-rule="evenodd"></path>
</svg>`;

const WL_ICON_SVG_ACTIVE = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true">
  <path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 4.5a1 1 0 011 1v4.933l3.515 2.11a1 1 0 01-1.03 1.714l-4-2.4-.485-.291V6.5a1 1 0 011-1Z"></path>
</svg>`;

type ButtonDisplayMode = 'icon-only' | 'icon-and-text';

let currentVideoId: string | null = null;
let isCurrentlyInWL: boolean = false;
let nativeSaveButtonObserver: MutationObserver | null = null;
let injectionTimeout: number | null = null;
let buttonDisplayMode: ButtonDisplayMode = 'icon-and-text';
const DEBOUNCE_DELAY = 100;

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
  if (!videoId) return;

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

  let eventData = eventDetail;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (window as any).cloneInto === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventData = (window as any).cloneInto(eventDetail, window);
  }

  const event = new window.CustomEvent('yt-action', eventData);
  appElement.dispatchEvent(event);
  console.log(`${LOG_PREFIX} Dispatched ${isAdding ? 'Add' : 'Remove'} WL event for ${videoId}.`);
}

/**
 * Toggles the button's visual state (icon, color, text) and updates internal state.
 */
function updateButtonState(button: HTMLButtonElement, newWLState: boolean): void {
  const textDiv = button.querySelector(
    '.yt-spec-button-shape-next__button-text-content',
  ) as HTMLElement | null;

  const svgContainerDiv = button.querySelector(
    '.yt-spec-button-shape-next__icon div[style*="fill: currentcolor"]',
  ) as HTMLElement | null;

  const newText = 'Watch Later';
  const displayMode = buttonDisplayMode;

  isCurrentlyInWL = newWLState;

  if (newWLState) {
    button.classList.add('ywhl-active-button-state');

    button.style.color = 'var(--yt-spec-brand-icon-active)';
    button.style.backgroundColor = '';

    if (svgContainerDiv) svgContainerDiv.innerHTML = WL_ICON_SVG_ACTIVE;
  } else {
    button.classList.remove('ywhl-active-button-state');

    button.style.backgroundColor = '';
    button.style.color = '';

    if (svgContainerDiv) svgContainerDiv.innerHTML = WL_ICON_SVG_INACTIVE;
  }

  button.title = newText;
  button.setAttribute('aria-label', newText);
  button.setAttribute('aria-pressed', newWLState.toString());
  if (textDiv) textDiv.textContent = newText;

  // Handle display mode change
  if (displayMode === 'icon-only') {
    button.classList.remove('yt-spec-button-shape-next--icon-leading');

    if (textDiv) textDiv.style.display = 'none';
  } else {
    button.classList.add('yt-spec-button-shape-next--icon-leading');

    if (textDiv) textDiv.style.display = '';
  }
}

function checkNativeSaveButtonState(): boolean {
  const nativeSaveButton = document.querySelector(
    'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Save"], ' +
      'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Guardar"], ' +
      'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Tallenna"], ' +
      'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Salva"]',
  );

  if (nativeSaveButton) {
    return nativeSaveButton.getAttribute('aria-pressed') === 'true';
  }

  return window.location.href.includes('&list=WL');
}

function observeNativeSaveButton(): void {
  if (nativeSaveButtonObserver) {
    nativeSaveButtonObserver.disconnect();
    nativeSaveButtonObserver = null;
  }

  const nativeSaveButton = document.querySelector(
    'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Save"], ' +
      'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Guardar"], ' +
      'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Tallenna"], ' +
      'ytd-menu-renderer #top-level-buttons-computed button[aria-label*="Salva"]',
  );

  const buttonToUpdate = document.getElementById(INJECTED_BUTTON_ID) as HTMLButtonElement | null;

  if (!nativeSaveButton || !buttonToUpdate) {
    return;
  }

  nativeSaveButtonObserver = new MutationObserver(() => {
    const isSaved = checkNativeSaveButtonState();
    if (isSaved !== isCurrentlyInWL) {
      console.log(
        `${LOG_PREFIX} Native button changed state. Updating custom button to WL: ${isSaved}`,
      );
      updateButtonState(buttonToUpdate, isSaved);
    }
  });

  nativeSaveButtonObserver.observe(nativeSaveButton, {
    attributes: true,
    attributeFilter: ['aria-pressed', 'title', 'aria-label'],
  });
}

function createWatchLaterButton(): HTMLElement {
  const initialState = checkNativeSaveButtonState();
  isCurrentlyInWL = initialState;

  const actionText = 'Watch Later';
  const displayMode = buttonDisplayMode;
  const initialIconSVG = initialState ? WL_ICON_SVG_ACTIVE : WL_ICON_SVG_INACTIVE;

  const buttonClassModifier =
    displayMode === 'icon-only' ? '' : 'yt-spec-button-shape-next--icon-leading';

  const buttonActiveStateClass = initialState ? 'ywhl-active-button-state' : '';

  const buttonWrapper = document.createElement('yt-button-view-model');
  buttonWrapper.className = 'ytd-menu-renderer';
  buttonWrapper.id = WL_BUTTON_ID;

  buttonWrapper.innerHTML = `
    <button-view-model class="ytSpecButtonViewModelHost style-scope ytd-menu-renderer">
      <button
        id="${INJECTED_BUTTON_ID}"
        class="yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m ${buttonClassModifier} ${buttonActiveStateClass} yt-spec-button-shape-next--enable-backdrop-filter-experiment"
        title="${actionText}"
        aria-label="${actionText}"
        aria-disabled="false"
        aria-pressed="${initialState}"
      >
        <div aria-hidden="true" class="yt-spec-button-shape-next__icon">
          <span class="ytIconWrapperHost" style="width: 24px; height: 24px">
            <span class="yt-icon-shape ytSpecIconShapeHost">
              <div style="width: 100%; height: 100%; display: block; fill: currentcolor">
                ${initialIconSVG}
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

  updateButtonState(buttonElement, initialState);

  buttonElement.addEventListener('click', () => {
    const newState = !isCurrentlyInWL;
    sendNativeYouTubeAction(currentVideoId!, newState);
    updateButtonState(buttonElement, newState);
  });

  return buttonWrapper;
}

function cleanupPreviousButton(): void {
  if (nativeSaveButtonObserver) {
    nativeSaveButtonObserver.disconnect();
    nativeSaveButtonObserver = null;
  }
  const existingButton = document.getElementById(WL_BUTTON_ID);
  if (existingButton) {
    existingButton.remove();
  }
  currentVideoId = null;
  isCurrentlyInWL = false;
}

function debouncedInjectWatchLaterButton(): void {
  if (injectionTimeout !== null) {
    clearTimeout(injectionTimeout);
  }

  injectionTimeout = setTimeout(() => {
    injectWatchLaterButton();
    injectionTimeout = null;
  }, DEBOUNCE_DELAY) as unknown as number;
}

function injectWatchLaterButton(): void {
  const buttonsContainer = document.getElementById('top-level-buttons-computed');
  const location = new URL(window.location.href);

  const nextVideoId =
    location.searchParams.get('v') ||
    (location.pathname.startsWith('/shorts/') ? location.pathname.split('/')[2] : null);

  if (nextVideoId === currentVideoId) {
    const existingButtonWrapper = document.getElementById(WL_BUTTON_ID);
    if (existingButtonWrapper) {
      const button = existingButtonWrapper.querySelector(
        `#${INJECTED_BUTTON_ID}`,
      ) as HTMLButtonElement | null;

      if (button) updateButtonState(button, checkNativeSaveButtonState());
      return;
    }
  }

  if (nextVideoId !== currentVideoId) {
    console.log(`${LOG_PREFIX} Navigated. Cleaning up old button (ID: ${currentVideoId}).`);
    cleanupPreviousButton();
    currentVideoId = nextVideoId;
  }

  if (!buttonsContainer || !currentVideoId) {
    console.log(`${LOG_PREFIX} Injection skipped: Container not found or not a valid video page.`);

    const pageManager = document.getElementById('page-manager');
    if (pageManager) {
      observePageManagerForButtonsContainer(pageManager);
    }
    return;
  }

  console.log(`${LOG_PREFIX} Injecting button for new video ID: ${currentVideoId}`);
  const newButton = createWatchLaterButton();

  const segmentedButton = buttonsContainer.querySelector(
    'segmented-like-dislike-button-view-model',
  );
  let insertBeforeElement: Element | null = null;

  if (segmentedButton && segmentedButton.nextElementSibling) {
    insertBeforeElement = segmentedButton.nextElementSibling;
  } else {
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

let pageManagerObserver: MutationObserver | null = null;

function observePageManagerForButtonsContainer(pageManager: HTMLElement): void {
  if (pageManagerObserver) return;

  console.log(
    `${LOG_PREFIX} Starting observation on page-manager for button container (#top-level-buttons-computed) to appear.`,
  );

  pageManagerObserver = new MutationObserver((_mutationsList, observer) => {
    const buttonsContainer = document.getElementById('top-level-buttons-computed');
    if (buttonsContainer) {
      console.log(`${LOG_PREFIX} Button container found. Stopping observation.`);
      observer.disconnect();
      pageManagerObserver = null;
      debouncedInjectWatchLaterButton();
    }
  });

  pageManagerObserver.observe(pageManager, {
    childList: true,
    subtree: true,
  });
}

function handlePreferenceUpdate(newMode: ButtonDisplayMode) {
  if (newMode === buttonDisplayMode) return;

  console.log(`${LOG_PREFIX} Preference updated: ${newMode}`);
  buttonDisplayMode = newMode;

  const existingButtonWrapper = document.getElementById(WL_BUTTON_ID);
  if (existingButtonWrapper) {
    const button = existingButtonWrapper.querySelector(
      `#${INJECTED_BUTTON_ID}`,
    ) as HTMLButtonElement | null;
    if (button) {
      updateButtonState(button, isCurrentlyInWL);
      return;
    }
  }

  debouncedInjectWatchLaterButton();
}

function initializeContentScript() {
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type: string; mode: ButtonDisplayMode };

      if (
        msg.type === 'UPDATE_BUTTON_STYLE' &&
        (msg.mode === 'icon-only' || msg.mode === 'icon-and-text')
      ) {
        handlePreferenceUpdate(msg.mode);
      }
    });
  }

  document.addEventListener('yt-navigate-finish', () => {
    debouncedInjectWatchLaterButton();
  });

  const initialObserver = new MutationObserver((_mutationsList, observer) => {
    const container = document.getElementById('top-level-buttons-computed');

    if (container) {
      if (!document.getElementById(WL_BUTTON_ID)) {
        injectWatchLaterButton();
      }
      observer.disconnect();
    }
  });

  const appElement = document.getElementById('page-manager') as HTMLElement | null;
  if (appElement) {
    initialObserver.observe(appElement, { childList: true, subtree: true });
  } else {
    debouncedInjectWatchLaterButton();
  }
}

initializeContentScript();
