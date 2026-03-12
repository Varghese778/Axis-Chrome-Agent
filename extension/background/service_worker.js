// background/service_worker.js
// Handles side panel opening, screenshot capture, and relays messages between
// side panel and content scripts. Also relays audio chunks from content script
// to the side panel (which holds the WebSocket connection).

// ---------------------------------------------------------------------------
// Open side panel when extension icon is clicked
// ---------------------------------------------------------------------------
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ---------------------------------------------------------------------------
// Ensure content script is loaded on active tab (for tab switches)
// ---------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    // Specifically block only sensitive pages. chrome://newtab is technically okay to run basic scripts on.
    if (tab.url && (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://settings'))) {
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: activeInfo.tabId },
      files: ['content/content.js'],
    });
  } catch (e) {
    // Expected to fail on chrome:// or extension pages — ignore
  }
});

// ---------------------------------------------------------------------------
// Keep service worker alive (PRD + reference pattern)
// ---------------------------------------------------------------------------
let keepAliveInterval = null;

// Port reference to side panel for relaying audio chunks
let sidePanelPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    sidePanelPort = port;
    keepAliveInterval = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => { });
    }, 20000);
    port.onDisconnect.addListener(() => {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
      sidePanelPort = null;
    });
  }
});

// ---------------------------------------------------------------------------
// Message handler — screenshot capture, audio relay, content script commands
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Screenshot capture request — from side panel WebSocket relay
  if (message.type === 'capture_screenshot') {
    const quality = message.quality || 25;
    // Always re-query the active tab at capture time — never use a stored tab ID
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ success: false, error: 'no_active_tab' });
        return;
      }
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
        sendResponse({ success: false, error: 'chrome_page' });
        return;
      }
      chrome.tabs.captureVisibleTab(
        tab.windowId,
        { format: 'jpeg', quality },
        (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          // Strip data:image/jpeg;base64, prefix
          const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
          sendResponse({ success: true, data: b64 });
        }
      );
    });
    return true; // async response
  }

  // Audio chunk from content script — no longer needed (mic is in sidepanel)

  // Forward WebMCP / DOM commands to content script in the active tab
  if (
    message.type === 'execute_webmcp' ||
    message.type === 'execute_dom' ||
    message.type === 'get_webmcp_tools' ||
    message.type === 'get_interactive_elements'
  ) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      // Fail fast on restricted pages where content script cannot run
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
        sendResponse({ success: false, error: 'chrome_page' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse(response);
      });
    });
    return true; // async response
  }

  // ---------------------------------------------------------------------------
  // Browser navigation actions (open/close/switch tabs, navigate, back/forward)
  // ---------------------------------------------------------------------------
  if (message.type === 'browser_action') {
    const action = message.action;

    if (action === 'open_tab') {
      chrome.tabs.create({ url: message.url }, (tab) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ success: true, message: `Opened new tab: ${message.url}`, tabId: tab.id, url: tab.url || message.url, title: tab.title || '' });
      });
      return true;
    }

    if (action === 'close_tab') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        chrome.tabs.remove(tabs[0].id, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          // Query for the new active tab after closing
          chrome.tabs.query({ active: true, currentWindow: true }, (newTabs) => {
            const newTab = newTabs[0];
            sendResponse({ success: true, message: 'Closed current tab', tabId: newTab?.id, url: newTab?.url || '', title: newTab?.title || '' });
          });
        });
      });
      return true;
    }

    if (action === 'switch_tab') {
      const query = (message.tab_query || '').toLowerCase();
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const match = tabs.find(
          (t) =>
            (t.title && t.title.toLowerCase().includes(query)) ||
            (t.url && t.url.toLowerCase().includes(query))
        );
        if (match) {
          chrome.tabs.update(match.id, { active: true }, () => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            sendResponse({ success: true, message: `Switched to: ${match.title}`, tabId: match.id, url: match.url || '', title: match.title || '' });
          });
        } else {
          sendResponse({ success: false, error: `No tab matching "${message.tab_query}"` });
        }
      });
      return true;
    }

    if (action === 'navigate') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        chrome.tabs.update(tabs[0].id, { url: message.url }, (tab) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ success: true, message: `Navigated to: ${message.url}`, tabId: tab.id, url: tab.url || message.url, title: tab.title || '' });
        });
      });
      return true;
    }

    if (action === 'go_back') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        const tabId = tabs[0].id;
        chrome.tabs.goBack(tabId, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          chrome.tabs.get(tabId, (tab) => {
            sendResponse({ success: true, message: 'Went back', tabId: tab.id, url: tab.url || '', title: tab.title || '' });
          });
        });
      });
      return true;
    }

    if (action === 'go_forward') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        const tabId = tabs[0].id;
        chrome.tabs.goForward(tabId, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          chrome.tabs.get(tabId, (tab) => {
            sendResponse({ success: true, message: 'Went forward', tabId: tab.id, url: tab.url || '', title: tab.title || '' });
          });
        });
      });
      return true;
    }

    if (action === 'refresh') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        const tabId = tabs[0].id;
        chrome.tabs.reload(tabId, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          chrome.tabs.get(tabId, (tab) => {
            sendResponse({ success: true, message: 'Refreshed page', tabId: tab.id, url: tab.url || '', title: tab.title || '' });
          });
        });
      });
      return true;
    }

    if (action === 'list_tabs') {
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const tabList = tabs.map((t, i) => ({
          index: i,
          title: t.title,
          url: t.url,
          active: t.active,
        }));
        sendResponse({ success: true, tabs: tabList });
      });
      return true;
    }

    sendResponse({ success: false, error: `Unknown browser action: ${action}` });
    return true;
  }

  // WebMCP tools updated notification from content script
  if (message.type === 'webmcp_tools_updated') {
    // Store for later use if needed
    chrome.storage.local.set({
      webmcpTools: message.tools,
      webmcpUrl: message.url,
    });
  }
});
