// sidepanel/sidepanel.js — Axis
// Manages UI state, Google Auth, audio playback, visualizer, ephemeral transcripts.

const BACKEND_WS = 'ws://localhost:8080/ws/';
const BACKEND_WS_CHAT = 'ws://localhost:8080/ws-chat/';
const BACKEND_HTTP = 'http://localhost:8080';
let SESSION_ID = crypto.randomUUID();

const GOOGLE_CLIENT_ID = '461115625041-lp7uhcsip7r1uk6bv70rtqap60nkd4mb.apps.googleusercontent.com';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let ws = null;
let chatWs = null;              // WebSocket for chat sessions (tool bridge)
let isListening = false;
let isHolding = false;
let currentTabId = null;
let currentUrl = '';
let currentTitle = '';
let currentUser = null;
let currentView = 'idle'; // idle | live | settings
let wsConnecting = false;
let sessionEnding = false;
let selectedVoice = 'Aoede';
let selectedPersona = 'Pilot';
let savedCustomInstructions = '';
let ssQuality = 0.5;           // screenshot JPEG quality (hardcoded)
let selectedTabs = [];          // [{id, title, url, favIconUrl}] — tabs RESTRICTED from screenshots
let chatSessionId = null;       // current chat session ID
let chatSessionType = null;     // 'chat' or null

// Keep service worker alive
const keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });

// Mic recording state — runs in sidepanel (extension origin, works on all tabs)
let micStream = null;
let micAudioContext = null;
let micWorkletNode = null;

// Tab change detection
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    currentTabId = String(tab.id);
    currentUrl = tab.url || '';
    currentTitle = tab.title || '';
    if (ws?.readyState === WebSocket.OPEN) sendPageContext(tab, ws);
    if (chatWs?.readyState === WebSocket.OPEN) sendPageContext(tab, chatWs);
  } catch (e) { /* tab closed */ }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && String(tabId) === currentTabId) {
    if (changeInfo.url) currentUrl = changeInfo.url;
    if (changeInfo.title) currentTitle = changeInfo.title;
    if (ws?.readyState === WebSocket.OPEN) sendPageContext(tab, ws);
    if (chatWs?.readyState === WebSocket.OPEN) sendPageContext(tab, chatWs);
  }
});

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const screenHome = document.getElementById('screen-home');
const screenAuth = document.getElementById('screen-auth');
const screenMain = document.getElementById('screen-main');

const viewIdle = document.getElementById('view-idle');
const viewLive = document.getElementById('view-live');
const viewSettings = document.getElementById('view-settings');
const settingsOverlay = document.getElementById('settings-overlay');

const userInitialEl = document.getElementById('user-initial');
const settingsInitialEl = document.getElementById('settings-initial');
const settingsDisplayName = document.getElementById('settings-display-name');
const settingsEmail = document.getElementById('settings-email');

const goLiveBtn = document.getElementById('go-live-btn');
const endSessionBtn = document.getElementById('end-session-btn');
const holdBtn = document.getElementById('hold-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const newSessionBtn = document.getElementById('new-session-btn');
const themeToggle = document.getElementById('theme-toggle');

// Idle view elements
const idleGreetingEl = document.getElementById('idle-greeting');
const tabPillsEl = document.getElementById('tab-pills');
const addTabsBtn = document.getElementById('add-tabs-btn');
const tabDropdown = document.getElementById('tab-dropdown');
const idleTextInput = document.getElementById('idle-text-input');
const chatDropOverlay = document.getElementById('chat-drop-overlay');

// Chat view elements
const viewChat = document.getElementById('view-chat');
const chatBackBtn = document.getElementById('chat-back-btn');
const chatSessionTitle = document.getElementById('chat-session-title');
const newChatBtn = document.getElementById('new-chat-btn');
const chatMessagesEl = document.getElementById('chat-messages');
const chatTextInput = document.getElementById('chat-text-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatTabPillsEl = document.getElementById('chat-tab-pills');
const chatAddTabsBtn = document.getElementById('chat-add-tabs-btn');
const chatTabDropdown = document.getElementById('chat-tab-dropdown');
const sessionResumePopup = document.getElementById('session-resume-popup');

const liveCanvas = document.getElementById('live-visualizer');
const chatContainer = document.getElementById('chat-container');
const recentSessionsDiv = document.getElementById('recent-sessions');

// Image Modal References
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const modalDownloadBtn = document.getElementById('modal-download-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');

// ---------------------------------------------------------------------------
// Screen & View management
// ---------------------------------------------------------------------------
function showScreen(el) {
  [screenHome, screenAuth, screenMain].forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

function switchView(view) {
  currentView = view;
  viewIdle.classList.remove('active-view');
  viewLive.classList.remove('active-view');
  if (viewChat) viewChat.classList.remove('active-view');
  viewSettings.classList.remove('open');
  settingsOverlay.classList.remove('visible');

  if (view === 'idle') {
    viewIdle.classList.add('active-view');
  } else if (view === 'live') {
    viewLive.classList.add('active-view');
  } else if (view === 'chat') {
    if (viewChat) viewChat.classList.add('active-view');
  } else if (view === 'settings') {
    // Keep current underneath
    if (currentView !== 'settings') {
      // re-show whatever was behind
    }
    viewSettings.classList.add('open');
    settingsOverlay.classList.add('visible');
    if (currentUser) loadRecentSessions();
  }
}

function openSettings() {
  viewSettings.classList.add('open');
  settingsOverlay.classList.add('visible');
  if (currentUser) {
    settingsDisplayName.textContent = currentUser.name || 'User';
    settingsEmail.textContent = currentUser.email || '';
    const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
    settingsInitialEl.textContent = initial;
    loadRecentSessions();
  }
}

function closeSettings() {
  viewSettings.classList.remove('open');
  settingsOverlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
document.getElementById('sign-in-btn').addEventListener('click', signIn);
signOutBtn.addEventListener('click', signOutUser);

chrome.storage.local.get(['pp_user', 'pp_token'], (data) => {
  if (data.pp_user && data.pp_token) {
    currentUser = data.pp_user;
    showMainScreen();
    connectWS(currentUser.id, data.pp_token);
  }
});

// Load personalization settings from sync storage
chrome.storage.sync.get(['axis_voice', 'axis_persona', 'axis_custom_instructions'], (data) => {
  selectedVoice = data.axis_voice || 'Aoede';
  selectedPersona = data.axis_persona || 'Pilot';
  savedCustomInstructions = data.axis_custom_instructions || '';
  const voiceEl = document.getElementById('voice-select');
  const personaEl = document.getElementById('persona-select');
  const instructionsEl = document.getElementById('custom-instructions');
  const charCountEl = document.getElementById('char-count');
  if (voiceEl) voiceEl.value = selectedVoice;
  if (personaEl) personaEl.value = selectedPersona;
  if (instructionsEl) instructionsEl.value = savedCustomInstructions;
  if (charCountEl) charCountEl.textContent = `${savedCustomInstructions.length}/500`;
});

function signIn() {
  console.log("signIn() triggered!");
  try {
    const redirectUrl = chrome.identity.getRedirectURL();
    console.log("Redirect URL:", redirectUrl);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', 'openid profile email');
    console.log("Auth URL ready:", authUrl.toString());

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (responseUrl) => {
        console.log("launchWebAuthFlow callback returned. URL:", responseUrl);
        const errorDiv = document.getElementById('auth-error');
        if (chrome.runtime.lastError || !responseUrl) {
          console.error('Auth error (chrome.runtime.lastError):', chrome.runtime.lastError);
          if (errorDiv) {
            errorDiv.textContent = 'Auth error: ' + (chrome.runtime.lastError?.message || 'No response URL');
          }
          return;
        }
        if (errorDiv) errorDiv.textContent = '';
        console.log("Parsing token from fragment...");

        let accessToken = null;
        try {
          // The responseUrl often looks like: https://<id>.chromiumapp.org/#access_token=ya29....
          const hashIdx = responseUrl.indexOf('#');
          if (hashIdx !== -1) {
            const fragment = responseUrl.substring(hashIdx + 1);
            const params = new URLSearchParams(fragment);
            accessToken = params.get('access_token');
          }
        } catch (e) {
          console.error("Error parsing URL Fragment:", e);
        }

        if (!accessToken) {
          console.error("No access token found in response URL:", responseUrl);
          if (errorDiv) errorDiv.textContent = "Sign in successful but could not extract token.";
          return;
        }

        console.log("Fetching user profile...");
        try {
          const resp = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`);
          if (!resp.ok) {
            throw new Error(`Profile fetch HTTP Error: ${resp.status}`);
          }
          const profile = await resp.json();
          console.log("Profile fetched:", profile.email);
          currentUser = { id: profile.sub, name: profile.name, email: profile.email, picture: profile.picture };
          chrome.storage.local.set({ pp_user: currentUser, pp_token: accessToken });
          showAuthenticatingScreen(() => { showMainScreen(); connectWS(currentUser.id, accessToken); });
        } catch (e) {
          console.error("Profile fetch error:", e);
          if (errorDiv) errorDiv.textContent = 'User info fetch failed: ' + e.message;
        }
      }
    );
  } catch (err) {
    const errorDiv = document.getElementById('auth-error');
    console.error('Synchronous error in signIn():', err);
    if (errorDiv) errorDiv.textContent = 'Error: ' + err.message;
  }
}

function showAuthenticatingScreen(onComplete) {
  showScreen(screenAuth);
  setTimeout(() => { if (onComplete) onComplete(); }, 2200);
}

function showMainScreen() {
  showScreen(screenMain);
  if (currentUser) {
    const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
    userInitialEl.textContent = initial;
    // Populate greeting
    const firstName = (currentUser.name || '').split(' ')[0] || 'there';
    if (idleGreetingEl) idleGreetingEl.textContent = `Nice to see you, ${firstName}!`;
  }
  switchView('idle');
  populateTabSelector();
}

function signOutUser() {
  chrome.storage.local.remove(['pp_user', 'pp_token']);
  currentUser = null;
  closeSettings();
  disconnectWS();
  showScreen(screenHome);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function connectWS(userId, token) {
  if (wsConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  let reconnectAttempts = 0;
  const maxReconnect = 10;
  const baseDelay = 1000;

  function doConnect() {
    if (wsConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
    wsConnecting = true;
    ws = new WebSocket(BACKEND_WS + SESSION_ID);
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      wsConnecting = false;
      reconnectAttempts = 0;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = String(tab.id);
      currentUrl = tab.url || '';
      currentTitle = tab.title || '';

      // Wait for backend 'ready' signal before sending auth
      const authPayload = JSON.stringify({
        type: 'auth',
        user_id: userId,
        id_token: token,
        email: currentUser?.email || '',
        display_name: currentUser?.name || '',
        tab_id: currentTabId,
        page_url: tab.url,
        page_title: tab.title || '',
        session_id: SESSION_ID,
        voice: selectedVoice,
        persona: selectedPersona,
        custom_instructions: savedCustomInstructions,
        selected_tabs: selectedTabs.map(t => ({ id: t.id, url: t.url, title: t.title })),
      });

      let authSent = false;
      const readyTimeout = setTimeout(() => {
        // Fallback: send auth after 8s even without 'ready'
        if (!authSent && ws?.readyState === WebSocket.OPEN) {
          authSent = true;
          ws.send(authPayload);
          sendPageContext(tab);
          goLiveBtn.disabled = false;
        }
      }, 8000);

      // Temporarily listen for the 'ready' message
      const origOnMessage = ws.onmessage;
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ready' && !authSent) {
              authSent = true;
              clearTimeout(readyTimeout);
              ws.send(authPayload);
              sendPageContext(tab);
              goLiveBtn.disabled = false;
            }
          } catch { }
        }
        // Restore original handler and forward this message
        ws.onmessage = origOnMessage;
        if (origOnMessage) origOnMessage(event);
      };
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playAudioBinary(event.data);
      } else {
        handleMessage(JSON.parse(event.data), ws);
      }
    };

    ws.onerror = () => {
      wsConnecting = false;
    };

    ws.onclose = () => {
      wsConnecting = false;
      goLiveBtn.disabled = true;
      if (reconnectAttempts < maxReconnect) {
        setTimeout(doConnect, baseDelay * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;
      }
    };
  }
  doConnect();
}

function disconnectWS() {
  if (ws) { ws.close(); ws = null; }
}

// ---------------------------------------------------------------------------
// Page context
// ---------------------------------------------------------------------------
function isRestrictedUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url.startsWith('edge://') || url === 'about:blank';
}

function sendPageContext(tab, targetWs) {
  const s = targetWs || ws;
  const url = tab.url || '';
  const title = tab.title || '';
  if (isRestrictedUrl(url)) {
    if (s?.readyState === WebSocket.OPEN) {
      s.send(JSON.stringify({ type: 'page_context', url, title: title || 'New Tab', webmcp_available: false, webmcp_tools: [], selected_tabs: selectedTabs, session_id: SESSION_ID }));
    }
    return;
  }
  chrome.runtime.sendMessage({ type: 'get_webmcp_tools' }, (response) => {
    if (chrome.runtime.lastError) {
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'page_context', url, title, webmcp_available: false, webmcp_tools: [], selected_tabs: selectedTabs, session_id: SESSION_ID }));
      }
      return;
    }
    if (s?.readyState === WebSocket.OPEN) {
      s.send(JSON.stringify({ type: 'page_context', url, title, webmcp_available: response?.available || false, webmcp_tools: response?.tools || [], selected_tabs: selectedTabs, session_id: SESSION_ID }));
    }
  });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
function handleMessage(msg, sock) {
  const s = sock || ws;
  console.log('[Axis] WS message:', msg.type, msg.text ? msg.text.slice(0, 80) : '');
  if (msg.type === 'audio_response') {
    playAudio(msg.data);
  } else if (msg.type === 'user_transcript' || msg.type === 'input_transcription') {
    if (msg.text) {
      showTranscript(msg.text, 'user', !msg.is_partial);
    }
  } else if (msg.type === 'agent_transcript' || msg.type === 'output_transcription') {
    if (msg.text) {
      showTranscript(msg.text, 'agent', !msg.is_partial);

      // TRIGGER: If agent says they will generate/draw, show a simple text bubble immediately
      const lower = msg.text.toLowerCase();
      const keywords = ['generating', 'drawing', 'creating', 'painting', 'rendering', 'sketching', 'generated', 'visualizing'];
      const hasKeywords = keywords.some(k => lower.includes(k));

      if (hasKeywords) {
        if (!document.querySelector('.generating-bubble') && !document.querySelector('.image-message-card')) {
          showGeneratingBubble();
        }
      }
    }
  } else if (msg.type === 'session_ended') {
    // Server confirmed session end
  } else if (msg.type === 'turn_complete') {
    // nothing special
  } else if (msg.type === 'status') {
    handleStatusMessage(msg);
  } else if (msg.type === 'error') {
    if (msg.message && !msg.message.toLowerCase().includes('cannot access')) {
      showTranscript(msg.message, 'agent', true);
    }
  } else if (msg.type === 'request_screenshot') {
    chrome.tabs.get(Number(currentTabId), (tab) => {
      if (chrome.runtime.lastError || !tab) {
        if (s?.readyState === WebSocket.OPEN) {
          s.send(JSON.stringify({ type: 'screenshot_result', data: '', success: false, error: 'tab_not_found', session_id: SESSION_ID }));
        }
        return;
      }

      const activeUrl = tab.url || '';
      const activeTabId = tab.id;
      const restrictedPrefixes = ["chrome://", "about:", "chrome-extension://", "edge://"];
      const isChromePage = restrictedPrefixes.some(p => activeUrl.toLowerCase().startsWith(p)) || !activeUrl;
      const isRestrictedTab = selectedTabs.some(t => t.id === activeTabId);

      if (isChromePage || isRestrictedTab) {
        handleStatusMessage({
          type: 'status',
          level: 'info',
          message: "Restricted, Won't Peek here."
        });
        if (s?.readyState === WebSocket.OPEN) {
          s.send(JSON.stringify({
            type: 'screenshot_result',
            data: '',
            success: false,
            error: isChromePage ? 'chrome_internal_page' : 'tab_restricted',
            session_id: SESSION_ID
          }));
        }
        return;
      }

      // Show "Peek" notification before capturing
      handleStatusMessage({
        type: 'status',
        level: 'info',
        message: "Taking a look at the screen."
      });

      chrome.runtime.sendMessage({ type: 'capture_screenshot', quality: 80 }, (response) => {
        void chrome.runtime.lastError;
        if (!response?.success || !response?.data) {
          if (s?.readyState === WebSocket.OPEN) {
            s.send(JSON.stringify({ type: 'screenshot_result', data: '', success: false, session_id: SESSION_ID }));
          }
          return;
        }

        const img = new Image();
        img.onload = () => {
          const MAX_WIDTH = 960;
          let width = img.width;
          let height = img.height;

          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedDataUrl = canvas.toDataURL('image/jpeg', ssQuality);
          const compressedB64 = compressedDataUrl.replace(/^data:image\/jpeg;base64,/, '');

          if (s?.readyState === WebSocket.OPEN) {
            s.send(JSON.stringify({ type: 'screenshot_result', data: compressedB64, success: true, session_id: SESSION_ID }));
          }
        };

        img.onerror = (e) => {
          console.error('[Axis] Screenshot img load error:', e);
          if (s?.readyState === WebSocket.OPEN) {
            s.send(JSON.stringify({ type: 'screenshot_result', data: '', success: false, error: 'img_load_error', session_id: SESSION_ID }));
          }
        };

        img.src = 'data:image/jpeg;base64,' + response.data;
      });
    });
  } else if (msg.type === 'execute_webmcp') {
    chrome.runtime.sendMessage({ type: 'execute_webmcp', tool_name: msg.tool_name, args: msg.args }, (response) => {
      void chrome.runtime.lastError;
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: response?.success || false, error: response?.error || null, session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'execute_dom') {
    chrome.runtime.sendMessage({ type: 'execute_dom', selector: msg.selector, action: msg.action, value: msg.value }, (response) => {
      void chrome.runtime.lastError;
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: response?.success || false, error: response?.error || null, session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'browser_action') {
    chrome.runtime.sendMessage({ type: 'browser_action', action: msg.action, url: msg.url, tab_query: msg.tab_query }, (response) => {
      void chrome.runtime.lastError;
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'browser_action_result', success: response?.success || false, error: response?.error || null, message: response?.message || '', tabs: response?.tabs || null, tabId: response?.tabId || null, url: response?.url || null, title: response?.title || null, session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'get_interactive_elements') {
    chrome.runtime.sendMessage({ type: 'get_interactive_elements' }, (response) => {
      void chrome.runtime.lastError;
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: response?.success || false, elements: response?.elements || [], session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'file_uploaded') {
    showToast(`\u2713 ${msg.filename} shared with Axis`);
  } else if (msg.type === 'tool_start' && msg.tool === 'generate_image') {
    const isImageCardReady = document.querySelector('.image-message-card');
    const isBubbleActive = document.querySelector('.generating-bubble');
    if (!isBubbleActive && !isImageCardReady) {
      showGeneratingBubble();
    }
  } else if (msg.type === 'tool_result' && msg.tool === 'generate_image') {
    // In chat view, remove the '...' thinking bubble since the image IS the response
    if (currentView === 'chat') {
      const thinkingBubble = document.querySelector('.chat-bubble.agent.partial');
      if (thinkingBubble) thinkingBubble.remove();
    }
    const generatingBubble = document.querySelector('.generating-bubble');
    if (generatingBubble) {
      resolveImageMessage(generatingBubble, msg.data);
    } else {
      // If result came before bubble was triggered (race condition)
      const container = currentView === 'chat' ? chatMessagesEl : chatContainer;
      const ghost = document.createElement('div');
      container.appendChild(ghost);
      resolveImageMessage(ghost, msg.data);
    }
  }
}

// ---------------------------------------------------------------------------
// Tab Selector
// ---------------------------------------------------------------------------
async function populateTabSelector() {
  if (!tabPillsEl) return;
  // Restore previously restricted tabs
  chrome.storage.session.get(['axis_selected_tabs'], async (data) => {
    const saved = data.axis_selected_tabs || [];
    try {
      const allTabs = await chrome.tabs.query({});
      const openIds = new Set(allTabs.map(t => t.id));
      selectedTabs = saved.filter(t => openIds.has(t.id));
    } catch { selectedTabs = []; }
    renderTabPills();
  });
}

function renderTabPills() {
  // Pills UI removed per new UX
  if (tabPillsEl) tabPillsEl.innerHTML = '';
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

if (addTabsBtn) {
  addTabsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!tabDropdown.classList.contains('hidden')) {
      tabDropdown.classList.add('hidden');
      return;
    }
    // Populate dropdown with open tabs
    const allTabs = await chrome.tabs.query({});
    const selIds = new Set(selectedTabs.map(t => t.id));
    tabDropdown.innerHTML = '';
    for (const tab of allTabs) {
      if (isRestrictedUrl(tab.url)) continue;
      const isRestricted = selIds.has(tab.id);
      const item = document.createElement('div');
      item.className = 'tab-dropdown-item';
      const checkClass = isRestricted ? 'tab-check checked' : 'tab-check';
      const favicon = tab.favIconUrl ? `<img src="${escapeAttr(tab.favIconUrl)}" alt="" title="${escapeAttr(tab.title)}">` : `<span style="width:16px" title="${escapeAttr(tab.title)}"></span>`;
      item.innerHTML = `<span class="${checkClass}"></span>${favicon}<span class="tab-title">${escapeHtml((tab.title || '').slice(0, 50))}</span>`;
      item.addEventListener('click', () => {
        const idx = selectedTabs.findIndex(t => t.id === tab.id);
        const checkIcon = item.querySelector('.tab-check');

        if (idx >= 0) {
          selectedTabs.splice(idx, 1);
          if (checkIcon) checkIcon.classList.remove('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showToast(`${tab.title || 'Tab'} unrestricted`);
        } else {
          selectedTabs.push({ id: tab.id, title: tab.title || '', url: tab.url || '', favIconUrl: tab.favIconUrl || '' });
          if (checkIcon) checkIcon.classList.add('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showToast(`${tab.title || 'Tab'} restricted`);
        }

        // Immediate sync with backend
        chrome.tabs.get(Number(currentTabId), (t) => {
          if (!chrome.runtime.lastError && t) sendPageContext(t);
        });
      });
      tabDropdown.appendChild(item);
    }
    tabDropdown.classList.remove('hidden');
  });
}
// Close tab dropdown on outside click
document.addEventListener('click', (e) => {
  if (tabDropdown && !tabDropdown.contains(e.target) && e.target !== addTabsBtn && !addTabsBtn?.contains(e.target)) {
    tabDropdown.classList.add('hidden');
  }
});

// Chat restrict tabs button logic
if (chatAddTabsBtn) {
  chatAddTabsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!chatTabDropdown.classList.contains('hidden')) {
      chatTabDropdown.classList.add('hidden');
      return;
    }
    // Populate dropdown with open tabs
    const allTabs = await chrome.tabs.query({});
    const selIds = new Set(selectedTabs.map(t => t.id));
    chatTabDropdown.innerHTML = '';
    for (const tab of allTabs) {
      if (isRestrictedUrl(tab.url)) continue;
      const isRestricted = selIds.has(tab.id);
      const item = document.createElement('div');
      item.className = 'tab-dropdown-item';
      const check = document.createElement('span');
      check.className = isRestricted ? 'tab-check checked' : 'tab-check';
      const favicon = tab.favIconUrl ? `<img src="${escapeAttr(tab.favIconUrl)}" alt="" title="${escapeAttr(tab.title)}">` : `<span style="width:16px" title="${escapeAttr(tab.title)}"></span>`;
      item.innerHTML = `${favicon}<span class="tab-title">${escapeHtml((tab.title || '').slice(0, 50))}</span>`;
      item.prepend(check);
      item.addEventListener('click', (ev) => {
        const idx = selectedTabs.findIndex(t => t.id === tab.id);
        if (idx >= 0) {
          selectedTabs.splice(idx, 1);
          check.classList.remove('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showChatToast(`${tab.title || 'Tab'} unrestricted`);
        } else {
          selectedTabs.push({ id: tab.id, title: tab.title || '', url: tab.url || '', favIconUrl: tab.favIconUrl || '' });
          check.classList.add('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showChatToast(`${tab.title || 'Tab'} restricted`);
        }

        // Immediate sync with backend
        chrome.tabs.get(Number(currentTabId), (t) => {
          if (!chrome.runtime.lastError && t) sendPageContext(t);
        });
      });
      chatTabDropdown.appendChild(item);
    }
    chatTabDropdown.classList.remove('hidden');
  });
}

// (Screenshot mode feature removed — agent handles screenshots via predictive caching)

// ---------------------------------------------------------------------------
// Go Live / End Session / Hold
// ---------------------------------------------------------------------------
goLiveBtn.addEventListener('click', () => {
  sessionEnding = false;
  if (idleTextInput) idleTextInput.value = '';
  clearTranscript();
  switchView('live');
  startListening();
  showSilenceDots();
});

// Enter key in idle text input → open chat session
if (idleTextInput) {
  idleTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = idleTextInput.value.trim();
      if (!text) return;
      idleTextInput.value = '';
      openChatSession(text);
    }
  });
}

endSessionBtn.addEventListener('click', () => {
  sessionEnding = true;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'end_session' }));
  }
  stopListening();
  setTimeout(() => {
    if (ws) { ws.close(); ws = null; }
    SESSION_ID = crypto.randomUUID();
    switchView('idle');
    clearTranscript();
  }, 500);
});

holdBtn.addEventListener('click', () => {
  if (isHolding) {
    isHolding = false;
    holdBtn.textContent = 'Hold';
    startListening();
  } else {
    isHolding = true;
    holdBtn.textContent = 'Resume';
    stopMicOnly();
  }
});

settingsBtn.addEventListener('click', openSettings);
settingsBackBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

newSessionBtn.addEventListener('click', () => { resetSession(); });

// Persistent error reset button
const errorResetBtn = document.getElementById('error-reset-btn');
if (errorResetBtn) {
  errorResetBtn.addEventListener('click', () => { resetSession(); });
}

function resetSession() {
  SESSION_ID = crypto.randomUUID();
  clearTranscript();
  closeSettings();
  document.getElementById('error-modal')?.classList.add('hidden');

  if (currentView === 'live') {
    switchView('idle');
    stopListening();
  }
  // Reconnect with new session
  if (currentUser) {
    chrome.storage.local.get(['pp_token'], (data) => {
      if (data.pp_token) {
        disconnectWS();
        connectWS(currentUser.id, data.pp_token);
      }
    });
  }
}

// Theme toggle
themeToggle.addEventListener('change', () => {
  document.body.classList.toggle('theme-light', themeToggle.checked);
});

// Image Modal Listeners
if (imageModal) {
  modalCloseBtn.onclick = closeModal;
  imageModal.onclick = (e) => {
    if (e.target === imageModal) closeModal();
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal.classList.contains('visible')) {
      closeModal();
    }
  });
}

function openModal(src) {
  if (!imageModal || !modalImage) return;
  modalImage.src = src;
  imageModal.classList.add('visible');

  // Set up modal download
  modalDownloadBtn.onclick = () => downloadImage(src);
}

function closeModal() {
  if (imageModal) imageModal.classList.remove('visible');
}

function downloadImage(dataUrl) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `axis-vision-${timestamp}.png`;
  link.click();
}

// ---------------------------------------------------------------------------
// Mic — captures directly in sidepanel (extension origin, single permission)
// ---------------------------------------------------------------------------
async function startListening() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    micAudioContext = new AudioContext({ sampleRate: 16000 });
    const source = micAudioContext.createMediaStreamSource(micStream);

    const workletUrl = chrome.runtime.getURL('content/pcm-processor.js');
    await micAudioContext.audioWorklet.addModule(workletUrl);

    micWorkletNode = new AudioWorkletNode(micAudioContext, 'pcm-processor');
    micWorkletNode.port.onmessage = (e) => {
      if (e.data.type === 'audio_data' && ws?.readyState === WebSocket.OPEN && !sessionEnding) {
        ws.send(e.data.buffer);
      }
    };

    source.connect(micWorkletNode);
    // micWorkletNode.connect(micAudioContext.destination); // REMOVED to prevent echo loopback

    isListening = true;

    // Notify user that agent is live and ready for mic input
    handleStatusMessage({
      type: 'status',
      level: 'info',
      message: 'Please use earphones for better experience'
    });
  } catch (err) {
    console.error('[Axis] Mic start failed:', err.message);
  }
}

function stopListening() {
  stopMicOnly();
  isListening = false;
  isHolding = false;
  holdBtn.textContent = 'Pause';
}

function stopMicOnly() {
  if (micWorkletNode) {
    micWorkletNode.disconnect();
    micWorkletNode = null;
  }
  if (micAudioContext) {
    micAudioContext.close();
    micAudioContext = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  isListening = false;
}

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------
const playbackCtx = new AudioContext({ sampleRate: 24000 });
let nextPlayTime = 0;

// Analyser for agent audio output
const playbackAnalyser = playbackCtx.createAnalyser();
playbackAnalyser.fftSize = 128;
playbackAnalyser.connect(playbackCtx.destination);

function playAudio(base64Data) {
  try {
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer);
    const buffer = playbackCtx.createBuffer(1, samples.length, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768.0;
    const source = playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackAnalyser);
    const now = playbackCtx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  } catch (e) { /* silent */ }
}

function playAudioBinary(arrayBuffer) {
  try {
    const samples = new Int16Array(arrayBuffer);
    const buffer = playbackCtx.createBuffer(1, samples.length, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768.0;
    const source = playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackAnalyser);
    const now = playbackCtx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  } catch (e) { /* silent */ }
}

// ---------------------------------------------------------------------------
// Audio Visualizer (AudioAnalyser-based)
// ---------------------------------------------------------------------------
const liveCtx = liveCanvas.getContext('2d');

// Live visualizer — reacts to agent audio output
function drawLiveVisualizer() {
  const w = liveCanvas.width;
  const h = liveCanvas.height;
  liveCtx.clearRect(0, 0, w, h);
  const bars = 64;
  const barW = (w / bars) * 0.55;
  const gap = w / bars;

  const dataArray = new Uint8Array(playbackAnalyser.frequencyBinCount);
  playbackAnalyser.getByteFrequencyData(dataArray);

  for (let i = 0; i < bars; i++) {
    const idx = Math.floor(i * dataArray.length / bars);
    const amp = dataArray[idx] / 255;
    const barH = Math.max(h * amp * 0.85, 3);
    const x = i * gap + (gap - barW) / 2;
    const y = (h - barH) / 2;

    // Blue for user, purple for agent — blend based on amplitude
    const grad = liveCtx.createLinearGradient(x, y, x, y + barH);
    if (amp > 0.15) {
      grad.addColorStop(0, '#6b21a8');
      grad.addColorStop(1, '#a855f7');
    } else {
      grad.addColorStop(0, '#1a4fd6');
      grad.addColorStop(1, '#4fc3f7');
    }
    liveCtx.fillStyle = grad;
    liveCtx.fillRect(x, y, barW, barH);
  }
  requestAnimationFrame(drawLiveVisualizer);
}
drawLiveVisualizer();

// ---------------------------------------------------------------------------
// Chat Bubbles — bottom-to-top stacking, no fading
// ---------------------------------------------------------------------------
const MAX_BUBBLES = 50;
let lastBubbleRole = null;
let lastBubbleEl = null;

function showTranscript(text, role, isFinal) {
  if (!chatContainer) return;

  // If partial: append delta to active bubble for same role
  if (!isFinal) {
    if (lastBubbleEl && lastBubbleRole === role && lastBubbleEl.classList.contains('partial')) {
      // Manage spacing between word chunks
      const current = lastBubbleEl.textContent;
      const separator = (current && !current.endsWith(' ') && !text.startsWith(' ')) ? ' ' : '';
      lastBubbleEl.textContent += separator + text;
    } else {
      // Create a new partial bubble
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${role} partial`;
      bubble.textContent = text;
      chatContainer.appendChild(bubble);
      lastBubbleEl = bubble;
      lastBubbleRole = role;
    }
  }
  // If final: overwrite active partial bubble with cumulative string, then seal
  else {
    if (lastBubbleEl && lastBubbleRole === role && lastBubbleEl.classList.contains('partial')) {
      lastBubbleEl.textContent = text;
      lastBubbleEl.classList.remove('partial');
    } else {
      // Create a new final bubble if no active partial existed
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${role}`;
      bubble.textContent = text;
      chatContainer.appendChild(bubble);
    }
    // Seal bubble (next transcript creates a new one)
    lastBubbleRole = null;
    lastBubbleEl = null;
  }

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // De-spawn old bubbles at the top when exceeding max
  while (chatContainer.children.length > MAX_BUBBLES) {
    const oldest = chatContainer.firstElementChild;
    // Remove immediately to prevent infinite while loop if animationend hasn't fired
    oldest.remove();
  }
}

function clearTranscript() {
  if (chatContainer) chatContainer.innerHTML = '';
  lastBubbleRole = null;
  lastBubbleEl = null;
}

// Legacy stubs
function showSilenceDots() { }
function clearEphemeral() { clearTranscript(); }

// ---------------------------------------------------------------------------
// Drag & Drop File Upload
// ---------------------------------------------------------------------------
const liveView = document.getElementById('view-live');
const dropOverlay = document.getElementById('drop-overlay');

liveView.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropOverlay.classList.add('visible');
});

liveView.addEventListener('dragleave', () => {
  dropOverlay.classList.remove('visible');
});

liveView.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('visible');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  await handleFileUpload(file);
});

async function handleFileUpload(file) {
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  if (file.size > MAX_SIZE) {
    showToast('File too large. Max 5MB.');
    return;
  }

  const allowed = [
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  if (!allowed.includes(file.type)) {
    showToast('Unsupported file type.');
    return;
  }

  showToast(`Uploading ${file.name}...`);

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'file_upload',
        session_id: SESSION_ID,
        filename: file.name,
        mime_type: file.type,
        size: file.size,
        data: base64
      }));
    }
  };
  reader.readAsDataURL(file);
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'upload-toast';
  toast.textContent = msg;
  liveView.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showChatToast(msg) {
  if (!viewChat) return;
  const toast = document.createElement('div');
  toast.className = 'upload-toast';
  toast.textContent = msg;
  viewChat.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---------------------------------------------------------------------------
// Drag & Drop for Chat view
// ---------------------------------------------------------------------------
if (viewChat) {
  viewChat.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (chatDropOverlay) chatDropOverlay.classList.add('visible');
  });
  viewChat.addEventListener('dragleave', () => {
    if (chatDropOverlay) chatDropOverlay.classList.remove('visible');
  });
  viewChat.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (chatDropOverlay) chatDropOverlay.classList.remove('visible');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    await handleChatFileUpload(file);
  });
}

async function handleChatFileUpload(file) {
  const MAX_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE) { showChatToast('File too large. Max 5MB.'); return; }
  const allowed = [
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  if (!allowed.includes(file.type)) { showChatToast('Unsupported file type.'); return; }
  showChatToast(`Uploading ${file.name}...`);
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    // For chat, send as a chat message with the file context
    if (chatSessionId && currentUser) {
      sendChatMessage(`[Attached file: ${file.name}]`);
    } else if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'file_upload', session_id: SESSION_ID,
        filename: file.name, mime_type: file.type, size: file.size, data: base64
      }));
    }
  };
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------------------------
// REST API calls — Recent Sessions
// ---------------------------------------------------------------------------
async function fetchRecentSessions(userId) {
  try {
    const resp = await fetch(`${BACKEND_HTTP}/users/${encodeURIComponent(userId)}/sessions?limit=10`);
    if (!resp.ok) throw new Error('Failed');
    return await resp.json();
  } catch (e) {
    return [];
  }
}

async function fetchSessionTranscript(userId, sessionId) {
  try {
    const resp = await fetch(`${BACKEND_HTTP}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/transcript`);
    if (!resp.ok) throw new Error('Failed');
    return await resp.json();
  } catch (e) {
    return [];
  }
}

async function deleteSession(userId, sessionId) {
  const resp = await fetch(`${BACKEND_HTTP}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('Delete failed');
  return await resp.json();
}

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

async function loadRecentSessions() {
  if (!currentUser) return;
  recentSessionsDiv.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  const sessions = await fetchRecentSessions(currentUser.id);
  recentSessionsDiv.innerHTML = '';
  if (!sessions.length) {
    recentSessionsDiv.innerHTML = '<div class="session-empty">No recent sessions</div>';
    return;
  }
  for (const s of sessions) {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = s.session_id;
    const urlShort = s.page_url ? (() => { try { return new URL(s.page_url).hostname; } catch { return s.page_url; } })() : '';
    const sessionType = s.session_type || 'live';
    const typeBadge = sessionType === 'chat'
      ? '<span class="session-type-badge chat">💬 Chat</span>'
      : '<span class="session-type-badge live">🎙 Live</span>';
    card.innerHTML = `
      <div class="session-card-left">
        <div class="session-headline">${escapeHtml(s.session_headline || 'Session')}</div>
        <div class="session-url">${escapeHtml(urlShort)}</div>
        <div class="session-time">${relativeTime(s.started_at)} ${typeBadge}</div>
      </div>
      <button class="session-delete" title="Delete">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 0 011 1v2"/>
        </svg>
      </button>`;

    // Click card → show popup then resume session
    card.querySelector('.session-card-left').addEventListener('click', async () => {
      // Show popup
      if (sessionResumePopup) {
        sessionResumePopup.classList.remove('hidden');
        setTimeout(() => sessionResumePopup.classList.add('hidden'), 2200);
      }
      const transcript = await fetchSessionTranscript(currentUser.id, s.session_id);
      closeSettings();
      setTimeout(() => {
        resumeSession(s, transcript);
      }, 800);
    });

    // Delete button
    card.querySelector('.session-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      card.remove(); // optimistic
      try {
        await deleteSession(currentUser.id, s.session_id);
      } catch {
        // Re-add on failure
        card.classList.add('error');
        recentSessionsDiv.prepend(card);
        setTimeout(() => card.classList.remove('error'), 1000);
      }
    });

    recentSessionsDiv.appendChild(card);
  }
}

function resumeSession(sessionMeta, transcript) {
  const sessionType = sessionMeta.session_type || 'live';
  if (sessionType === 'chat') {
    // Show chat view with read-only transcript
    switchView('chat');
    if (chatSessionTitle) chatSessionTitle.textContent = sessionMeta.session_headline || 'Chat';
    chatSessionId = sessionMeta.session_id;
    if (chatMessagesEl) {
      chatMessagesEl.innerHTML = '';
      for (const msg of transcript) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${msg.role}`;
        bubble.textContent = msg.text;
        chatMessagesEl.appendChild(bubble);
      }
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
  } else {
    // Live session — show transcript in live view (read-only)
    switchView('live');
    clearTranscript();
    for (const msg of transcript) {
      showTranscript(msg.text, msg.role, true);
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// About Axis panel
// ---------------------------------------------------------------------------
const viewAbout = document.getElementById('view-about');
const aboutAxisBtn = document.getElementById('about-axis-btn');
const aboutBackBtn = document.getElementById('about-back-btn');

function openAbout() { viewAbout.classList.add('open'); }
function closeAbout() { viewAbout.classList.remove('open'); }

aboutAxisBtn.addEventListener('click', openAbout);
if (aboutBackBtn) aboutBackBtn.addEventListener('click', closeAbout);

// ---------------------------------------------------------------------------
// Chat Session (WebSocket-based with full tool access)
// ---------------------------------------------------------------------------

function closeChatWs() {
  if (chatWs) {
    try { chatWs.send(JSON.stringify({ type: 'end_session' })); } catch { }
    chatWs.close();
    chatWs = null;
  }
}

async function openChatSession(initialMessage) {
  // Close any existing chat WS
  closeChatWs();

  chatSessionId = crypto.randomUUID();
  chatSessionType = 'chat';
  if (chatSessionTitle) chatSessionTitle.textContent = 'Chat';
  if (chatMessagesEl) chatMessagesEl.innerHTML = '';
  switchView('chat');
  populateChatTabSelector();

  if (!currentUser) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = String(tab?.id || '');

  // Open WebSocket for chat (full tool access)
  chatWs = new WebSocket(BACKEND_WS_CHAT + chatSessionId);

  chatWs.onopen = () => {
    console.log('[Axis] Chat WS connected');
  };

  chatWs.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'ready') {
      // Send auth
      chatWs.send(JSON.stringify({
        type: 'auth',
        user_id: currentUser.id,
        email: currentUser?.email || '',
        display_name: currentUser?.name || '',
        tab_id: currentTabId,
        page_url: tab?.url || '',
        page_title: tab?.title || '',
      }));
      sendPageContext(tab, chatWs);
    } else if (msg.type === 'status' && msg.message === 'authenticated') {
      console.log('[Axis] Chat WS authenticated');
      // Send initial message if any
      if (initialMessage) {
        sendChatMessage(initialMessage);
        initialMessage = null;
      }
    } else if (msg.type === 'chat_thinking') {
      // Agent is processing — add or keep the loading bubble
      if (!document.querySelector('.chat-bubble.agent.partial')) {
        const thinkBubble = document.createElement('div');
        thinkBubble.className = 'chat-bubble agent partial';
        thinkBubble.textContent = '...';
        chatMessagesEl.appendChild(thinkBubble);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    } else if (msg.type === 'chat_response') {
      // Replace loading bubble with actual response
      const partial = document.querySelector('.chat-bubble.agent.partial');
      if (partial) {
        partial.classList.remove('partial');
        partial.textContent = msg.text || 'Done.';
      } else {
        const agentBubble = document.createElement('div');
        agentBubble.className = 'chat-bubble agent';
        agentBubble.textContent = msg.text || 'Done.';
        chatMessagesEl.appendChild(agentBubble);
      }
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    } else {
      // Delegate tool bridge messages (screenshot, DOM, browser action requests)
      handleMessage(msg, chatWs);
    }
  };

  chatWs.onerror = () => {
    console.error('[Axis] Chat WS error');
  };

  chatWs.onclose = () => {
    console.log('[Axis] Chat WS closed');
    chatWs = null;
  };
}

function sendChatMessage(text) {
  if (!text || !chatSessionId || !currentUser) return;
  if (!chatWs || chatWs.readyState !== WebSocket.OPEN) {
    console.error('[Axis] Chat WS not connected');
    return;
  }

  // Add user bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.textContent = text;
  chatMessagesEl.appendChild(userBubble);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  // Add loading agent bubble
  const agentBubble = document.createElement('div');
  agentBubble.className = 'chat-bubble agent partial';
  agentBubble.textContent = '...';
  chatMessagesEl.appendChild(agentBubble);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  // Send via WebSocket
  chatWs.send(JSON.stringify({ type: 'chat_message', text }));
}

// Chat send button
if (chatSendBtn) {
  chatSendBtn.addEventListener('click', () => {
    const text = chatTextInput?.value.trim();
    if (!text) return;
    chatTextInput.value = '';
    sendChatMessage(text);
  });
}

// Chat Enter key
if (chatTextInput) {
  chatTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = chatTextInput.value.trim();
      if (!text) return;
      chatTextInput.value = '';
      sendChatMessage(text);
    }
  });
}

// Chat back button → idle
if (chatBackBtn) {
  chatBackBtn.addEventListener('click', () => {
    closeChatWs();
    switchView('idle');
  });
}

// New Chat button
if (newChatBtn) {
  newChatBtn.addEventListener('click', () => {
    openChatSession(null);
  });
}

// Chat tab selector — no pills, restriction is shown via toast only
async function populateChatTabSelector() {
  // No pills to render — tab restriction feedback is via toast popup
}

// Close chat tab dropdown on outside click
document.addEventListener('click', (e) => {
  if (chatTabDropdown && !chatTabDropdown.contains(e.target) && e.target !== chatAddTabsBtn && !chatAddTabsBtn?.contains(e.target)) {
    chatTabDropdown.classList.add('hidden');
  }
});

// ---------------------------------------------------------------------------
// Feedback panel
// ---------------------------------------------------------------------------
const viewFeedback = document.getElementById('view-feedback');
const sendFeedbackBtn = document.getElementById('send-feedback-btn');
const feedbackBackBtn = document.getElementById('feedback-back-btn');
const feedbackForm = document.getElementById('feedback-form');
const feedbackSuccess = document.getElementById('feedback-success');

function openFeedback() {
  viewFeedback.classList.add('open');
  feedbackForm.classList.remove('hidden');
  feedbackSuccess.classList.add('hidden');
}
function closeFeedback() { viewFeedback.classList.remove('open'); }

sendFeedbackBtn.addEventListener('click', openFeedback);
feedbackBackBtn.addEventListener('click', closeFeedback);

feedbackForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('feedback-type').value;
  const subject = document.getElementById('feedback-subject').value.trim();
  const message = document.getElementById('feedback-message').value.trim();
  const name = document.getElementById('feedback-name').value.trim() || 'Anonymous';
  if (!subject || !message) return;

  const submitBtn = feedbackForm.querySelector('.btn-feedback-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';

  try {
    const resp = await fetch(`${BACKEND_HTTP}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback_type: type,
        subject: subject,
        message: message,
        sender_name: name,
        user_email: currentUser?.email || '',
      }),
    });
    const result = await resp.json();
    if (result.success) {
      feedbackForm.classList.add('hidden');
      feedbackSuccess.textContent = 'Thank you for your valuable feedback!🥺';
      feedbackSuccess.classList.remove('hidden');
      feedbackForm.reset();
    } else {
      feedbackSuccess.textContent = 'Failed to send. Please try again later🥲.';
      feedbackSuccess.classList.remove('hidden');
    }
  } catch (err) {
    feedbackSuccess.textContent = 'Failed to send. Please try again later🥲.';
    feedbackSuccess.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Feedback';
  }
});

// ---------------------------------------------------------------------------
// Personalize Pilot settings
// ---------------------------------------------------------------------------
function showSaveConfirm() {
  const el = document.getElementById('settings-save-confirm');
  if (!el) return;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 1500);
}

const voiceSelect = document.getElementById('voice-select');
const personaSelect = document.getElementById('persona-select');
const customInstructionsEl = document.getElementById('custom-instructions');
const charCountEl = document.getElementById('char-count');
const saveInstructionsBtn = document.getElementById('save-instructions-btn');

if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    selectedVoice = voiceSelect.value;
    chrome.storage.sync.set({ axis_voice: selectedVoice });
    showSaveConfirm();
  });
}

if (personaSelect) {
  personaSelect.addEventListener('change', () => {
    selectedPersona = personaSelect.value;
    chrome.storage.sync.set({ axis_persona: selectedPersona });
    showSaveConfirm();
  });
}

if (customInstructionsEl) {
  customInstructionsEl.addEventListener('input', () => {
    const len = customInstructionsEl.value.length;
    if (charCountEl) charCountEl.textContent = `${len}/500`;
  });
}

if (saveInstructionsBtn) {
  saveInstructionsBtn.addEventListener('click', () => {
    savedCustomInstructions = (customInstructionsEl?.value || '').slice(0, 500);
    chrome.storage.sync.set({ axis_custom_instructions: savedCustomInstructions });
    showSaveConfirm();
  });
}

// ---------------------------------------------------------------------------
// Image Generation DOM Helpers
// ---------------------------------------------------------------------------

/**
 * Shows a simple text bubble indicating image generation is in progress.
 */
function showGeneratingBubble() {
  const container = currentView === 'chat' ? chatMessagesEl : chatContainer;
  if (!container) return null;

  // Dupe check
  if (document.querySelector('.generating-bubble')) return null;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble agent generating-bubble';
  bubble.textContent = 'Generating, please wait...';

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

/**
 * Replaces a generating bubble or ghost element with the actual generated image card.
 */
function resolveImageMessage(anchorEl, data) {
  if (!anchorEl) return;

  const card = document.createElement('div');
  card.className = 'image-message-card';

  const imgSrc = `data:${data.mime_type || 'image/png'};base64,${data.image_b64}`;
  const img = document.createElement('img');
  img.src = imgSrc;
  img.alt = data.caption || 'Generated image';

  // Open modal on click
  card.onclick = () => openModal(imgSrc);

  const footer = document.createElement('div');
  footer.className = 'image-card-footer';

  if (data.caption) {
    const caption = document.createElement('div');
    caption.className = 'image-caption';
    caption.textContent = data.caption;
    footer.appendChild(caption);
  }

  // Prompt text intentionally hidden from UI for cleaner look

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'image-download-btn';
  downloadBtn.textContent = 'Download';
  downloadBtn.onclick = (e) => {
    e.stopPropagation(); // Don't open modal
    downloadImage(imgSrc);
  };
  footer.appendChild(downloadBtn);

  card.appendChild(img);
  card.appendChild(footer);

  // Replace anchor with card
  anchorEl.replaceWith(card);

  // Scroll to bottom
  const container = currentView === 'chat' ? chatMessagesEl : chatContainer;
  if (container) container.scrollTop = container.scrollHeight;
}
/**
 * Handles real-time status updates from the backend.
 */
function handleStatusMessage(msg) {
  let container = document.getElementById('status-notification-container');
  // Use the live-status-container if we are in live view and it's NOT a fatal error
  if (currentView === 'live' && msg.level !== 'error') {
    const liveContainer = document.getElementById('live-status-container');
    if (liveContainer) {
      container = liveContainer;
      // Clear previous messages in live view to ensure only the latest status is visible
      container.innerHTML = '';
    }
  }

  if (!container) return;

  if (msg.level === 'error') {
    const modal = document.getElementById('error-modal');
    if (modal) {
      modal.classList.remove('hidden');
      const msgEl = document.getElementById('error-message');
      if (msgEl) msgEl.textContent = msg.message;
    }
    // Remove all warning banners if there's a fatal error
    container.innerHTML = '';
    return;
  }

  const banner = document.createElement('div');
  const level = msg.level || 'info';
  banner.className = `status-banner ${level}`;

  const icon = level === 'warning' ? '✦' : level === 'info' ? '✦' : '✦';

  let countdownPart = '';
  if (level === 'warning' && msg.countdown) {
    let timeLeft = msg.countdown;
    const isReconnecting = msg.message.toLowerCase().includes('reconnect') || msg.message === 'please wait...';

    if (isReconnecting && msg.retry_attempt !== undefined && msg.total_attempts !== undefined) {
      countdownPart = ` Retrying in <span class="countdown-num">${timeLeft}</span>s (Attempt ${msg.retry_attempt}/${msg.total_attempts})`;
    } else if (isReconnecting) {
      countdownPart = ` <span class="countdown-num">${timeLeft}</span>s`;
    } else {
      countdownPart = ` Retrying in <span class="countdown-num">${timeLeft}</span>s`;
    }

    // Local setInterval for countdown
    const interval = setInterval(() => {
      timeLeft--;
      const numEl = banner.querySelector('.countdown-num');
      if (numEl) numEl.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(interval);
        if (isReconnecting && !isListening) {
          // If we reach 0 and still not listening, it's a failure
          // The backend will send a final error, but we want to make sure
        }
      }
    }, 1000);

    // Auto-remove warning banner just before retry/timeout (countdown + a bit)
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 300);
    }, (msg.countdown * 1000) - 200);
  } else {
    // All other banners (info, authenticated without level, etc.) auto-remove after 3.5s
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 300);
    }, 3500);
  }

  banner.innerHTML = `<span>${icon}</span> <span>${msg.message}${countdownPart}</span>`;
  container.appendChild(banner);
}
