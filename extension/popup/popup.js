// popup/popup.js
// Manages UI state, Google Auth via chrome.identity, mic recording, audio playback
// NOTE: Firebase JS SDK cannot be used in MV3 extension popups (CSP blocks CDN scripts).
// Auth uses chrome.identity.launchWebAuthFlow() instead.

// --- ENVIRONMENT CONFIGURATION ---
const IS_PROD = true; // Set to true for production
const PROD_DOMAIN = "axis-backend-461115625041.us-central1.run.app"; // We will paste the URL here later

const BACKEND_WS = IS_PROD ? `wss://${PROD_DOMAIN}/ws/` : 'ws://localhost:8080/ws/';
const BACKEND_WS_CHAT = IS_PROD ? `wss://${PROD_DOMAIN}/ws-chat/` : 'ws://localhost:8080/ws-chat/';
const BACKEND_HTTP = IS_PROD ? `https://${PROD_DOMAIN}` : 'http://localhost:8080';
// ---------------------------------
const SESSION_ID = crypto.randomUUID();

// Google OAuth — replace with your Web client ID from GCP Console > Credentials
const GOOGLE_CLIENT_ID = '461115625041-lp7uhcsip7r1uk6bv70rtqap60nkd4mb.apps.googleusercontent.com';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let ws = null;
let isListening = false;
let recordingContext = null;
let playbackContext = null;
let playbackNode = null;
let currentTabId = null;
let currentUser = null;

// Keep service worker alive while popup is open
const keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const statusDot = document.getElementById('status-dot');
const authSection = document.getElementById('auth-section');
const mainSection = document.getElementById('main-section');
const micBtn = document.getElementById('mic-btn');
const transcript = document.getElementById('transcript');
const modeBadge = document.getElementById('mode-badge');
const userNameEl = document.getElementById('user-name');

// ---------------------------------------------------------------------------
// Auth — chrome.identity.launchWebAuthFlow (MV3-compatible)
// ---------------------------------------------------------------------------
document.getElementById('sign-in-btn').addEventListener('click', signIn);
document.getElementById('sign-out-btn').addEventListener('click', signOutUser);

// Check for existing session when popup opens
chrome.storage.local.get(['pp_user', 'pp_token'], (data) => {
  if (data.pp_user && data.pp_token) {
    currentUser = data.pp_user;
    showMainSection();
    connectWS(currentUser.id, data.pp_token);
  }
});

function signIn() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', 'openid profile email');

  chrome.identity.launchWebAuthFlow(
    { url: authUrl.toString(), interactive: true },
    async (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        addTranscript('pilot', 'Sign-in cancelled or failed.');
        return;
      }

      // Extract access token from redirect URL fragment
      const fragment = new URL(responseUrl).hash.slice(1);
      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');

      if (!accessToken) {
        addTranscript('pilot', 'Sign-in failed — no token received.');
        return;
      }

      try {
        // Fetch Google user profile
        const resp = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`
        );
        const profile = await resp.json();

        currentUser = {
          id: profile.email,
          name: profile.name,
          email: profile.email,
        };

        // Persist so popup reopens stay signed in
        chrome.storage.local.set({ pp_user: currentUser, pp_token: accessToken });

        showMainSection();
        connectWS(currentUser.id, accessToken);
      } catch (e) {
        addTranscript('pilot', 'Failed to fetch user profile.');
      }
    }
  );
}

function signOutUser() {
  chrome.storage.local.remove(['pp_user', 'pp_token']);
  currentUser = null;
  disconnectWS();
  authSection.classList.remove('hidden');
  mainSection.classList.add('hidden');
}

function showMainSection() {
  authSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
  userNameEl.textContent = currentUser?.name?.split(' ')[0] || '';
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function connectWS(userId, token) {
  ws = new WebSocket(BACKEND_WS + SESSION_ID);

  ws.onopen = async () => {
    statusDot.className = 'status-dot connected';
    micBtn.disabled = false;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = String(tab.id);

    ws.send(
      JSON.stringify({
        type: 'auth',
        user_id: userId,
        id_token: token,
        tab_id: currentTabId,
        page_url: tab.url,
        session_id: SESSION_ID,
      })
    );
  };

  ws.onmessage = (event) => handleMessage(JSON.parse(event.data));

  ws.onclose = () => {
    statusDot.className = 'status-dot disconnected';
    micBtn.disabled = true;
  };
}

function disconnectWS() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

function handleMessage(msg) {
  if (msg.type === 'audio_response') {
    playAudio(msg.data);
  } else if (msg.type === 'input_transcription') {
    if (msg.text) {
      addTranscript('user', msg.text);
    }
  } else if (msg.type === 'turn_complete') {
    // Agent finished speaking
  } else if (msg.type === 'status') {
    addTranscript('pilot', msg.message);
  } else if (msg.type === 'error') {
    addTranscript('pilot', msg.message);
  } else if (msg.type === 'pong') {
    // keepalive ack — ignore
  } else if (msg.type === 'request_screenshot') {
    // Relay to service worker for chrome.tabs.captureVisibleTab()
    chrome.runtime.sendMessage({ type: 'capture_screenshot' }, (response) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'screenshot_result',
          data: response?.data || '',
          success: response?.success || false,
          session_id: SESSION_ID,
        }));
      }
    });
  } else if (msg.type === 'execute_webmcp') {
    // Relay WebMCP execution to service worker → content script
    chrome.runtime.sendMessage(
      { type: 'execute_webmcp', tool_name: msg.tool_name, args: msg.args },
      (response) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'action_result',
            success: response?.success || false,
            error: response?.error || null,
            session_id: SESSION_ID,
          }));
        }
      }
    );
  } else if (msg.type === 'execute_dom') {
    // Relay DOM action to service worker → content script
    chrome.runtime.sendMessage(
      { type: 'execute_dom', selector: msg.selector, action: msg.action, value: msg.value },
      (response) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'action_result',
            success: response?.success || false,
            error: response?.error || null,
            session_id: SESSION_ID,
          }));
        }
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Mic — reference pattern: AudioWorklet recorder with VAD
// ---------------------------------------------------------------------------
micBtn.addEventListener('click', toggleMic);

async function toggleMic() {
  if (isListening) {
    stopListening();
  } else {
    await startListening();
  }
}

async function startListening() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    recordingContext = new AudioContext({ sampleRate: 16000 });
    const source = recordingContext.createMediaStreamSource(stream);

    await recordingContext.audioWorklet.addModule('pcm-processor.js');
    const processor = new AudioWorkletNode(recordingContext, 'pcm-processor');
    source.connect(processor);

    // Reference pattern: structured messages with type field
    processor.port.onmessage = (e) => {
      if (e.data.type === 'audio_data' && ws?.readyState === WebSocket.OPEN) {
        const b64 = arrayBufferToBase64(e.data.buffer);
        ws.send(
          JSON.stringify({
            type: 'audio_chunk',
            data: b64,
            session_id: SESSION_ID,
            tab_id: currentTabId,
          })
        );
      }
    };

    // Set up playback context for audio responses (reference: audio-player-worklet)
    await initPlayback();

    isListening = true;
    micBtn.classList.add('listening');
    statusDot.className = 'status-dot listening';
    addTranscript('user', 'Listening...');
  } catch (err) {
    addTranscript('pilot', 'Microphone access denied.');
  }
}

function stopListening() {
  if (recordingContext) {
    recordingContext.close();
    recordingContext = null;
  }
  isListening = false;
  micBtn.classList.remove('listening');
  statusDot.className = 'status-dot connected';
}

// ---------------------------------------------------------------------------
// Audio playback — reference pattern: AudioPlayerProcessor worklet with
// queue + flush for barge-in
// ---------------------------------------------------------------------------
async function initPlayback() {
  if (playbackContext) return;

  playbackContext = new AudioContext({ sampleRate: 24000 });
  await playbackContext.audioWorklet.addModule('audio-player-worklet.js');
  playbackNode = new AudioWorkletNode(playbackContext, 'audio-player-processor');
  playbackNode.connect(playbackContext.destination);
}

function playAudio(b64) {
  if (!playbackNode) return;

  const bytes = base64ToArrayBuffer(b64);
  const pcmData = new Int16Array(bytes);

  playbackNode.port.postMessage(
    { type: 'audio_data', buffer: pcmData.buffer },
    [pcmData.buffer]
  );
}

function flushPlayback() {
  if (playbackNode) {
    playbackNode.port.postMessage({ type: 'flush' });
  }
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------
function addTranscript(role, text) {
  const p = document.createElement('p');
  p.className = role;
  p.textContent = text;
  transcript.querySelector('.hint')?.remove();
  transcript.appendChild(p);
  transcript.scrollTop = transcript.scrollHeight;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
