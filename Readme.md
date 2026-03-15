# 🧭 Axis: Gemini-Powered Chrome Extension 

**Hackathon Category:** UI Navigator ☸️  
**Agent Framework:** Google Agent Development Kit (ADK) v0.3.0+  
**Google Cloud Services:** Vertex AI · Cloud Run · Cloud Build · Firestore · Artifact Registry · Google OAuth 2.0  

**Gemini Models Used:**
| Purpose | Model |
|---|---|
| Live voice sessions | `gemini-live-2.5-flash-native-audio` |
| Text chat sessions | `gemini-2.5-flash` |
| Session headline generation | `gemini-2.5-flash` |
| Image generation | `gemini-2.5-flash-image` |


**Backend:** Hosted on **Google Cloud Run** (us-central1) — always on, no local server required.

[Live Endpoint Health Check](https://axis-backend-461115625041.us-central1.run.app/health)  

[![Deploy to Cloud Run](https://storage.googleapis.com/cloudrun/button.svg)](https://console.cloud.google.com/cloudshell/editor?shellonly=true&cloudshell_image=gcr.io/cloudrun/button&cloudshell_git_repo=https://github.com/Varghese778/Axis-Chrome-Agent.git)

---

## 📖 Project Overview

Axis is a next-generation **visual UI understanding agent** that acts as a user's hands on the screen. By observing the browser display via a Chrome Extension and interpreting visual elements using the **Gemini Live 2.5 Flash Native Audio API**, Axis allows users to navigate the web, automate cross-application workflows, and perform complex UI interactions entirely through natural, interruptible voice commands.

♿ **The Problem & Value Proposition**

Standard screen readers and web macros are rigid and break easily when UI layouts change. Axis solves this by using Gemini's multimodal reasoning to "see" the screen contextually. 

For individuals living with motor disabilities, ALS, Parkinson's, or spinal cord injuries, Axis offers something transformative: a browser that responds to your voice the way a human assistant would — seeing what you see, understanding what you mean, and executing with precision. No plugins. No fragile CSS selectors. Just Gemini, a screenshot, and your voice.

---

### ☸️ Why Axis?

Standard web automation breaks when a single CSS class changes. Axis is different.

It uses visual reasoning to understand UI layout, context, and intent — making it a universal hands-free interface that goes beyond convenience. For people with motor disabilities, repetitive strain injuries, or conditions like ALS, Parkinson's, or quadriplegia, interacting with a browser through a keyboard and mouse can be exhausting, painful, or impossible. Axis changes that.

By combining Gemini's multimodal understanding with real-time voice control, Axis lets anyone navigate the browser and automate multi-step workflows — using only their voice. No rigid commands. No memorised shortcuts. Just natural conversation with a browser that listens, sees, and acts.

Axis bridges the gap between AI reasoning and browser execution, giving physical independence back to people who need it most.

---

## ✨ Core Features

- **🎙️ Live Voice Navigation** — Talk to your browser. Axis sees the screen and acts — clicking, typing, scrolling, and navigating across sites through natural, interruptible voice commands.

- **💬 AI Chat Mode** — Full text-based agent with the same screenshot awareness and DOM execution as voice mode. Sessions are saved and searchable.

- **👁️ Visual Screen Understanding** — Uses real-time screenshots instead of DOM scrapers. Works on any website regardless of UI framework, shadow DOMs, or dynamic content.

- **🖼️ AI Image Generation** — Ask Axis to generate an image mid-conversation. Powered by `gemini-2.5-flash-image`. Download with one click.

- **📁 File Upload** — Drag and drop PDFs, images, or documents onto the session panel. Axis reads and reasons about them in context.

- **🕘 Session History** — Every session auto-saved to Firestore with a Gemini-generated headline summary, so you know where to get back.

- **♿ Accessibility First** — Built for users with motor disabilities, ALS, Parkinson's, or any condition that makes keyboard and mouse interaction difficult, and for users fascinated with AI Automation out of the chat box.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **AI Models** | `gemini-live-2.5-flash-native-audio` · `gemini-2.5-flash` · `gemini-2.5-flash-image` |
| **Agent Framework** | Google Agent Development Kit (ADK) v0.3.0+ |
| **AI SDK** | `google-genai` v0.8.0+ |
| **Backend** | Python · FastAPI · WebSockets · Asyncio |
| **Frontend** | Chrome Extension (Manifest V3) · Vanilla JS · HTML · CSS |
| **Database** | Google Firestore (Session & Transcript Storage) |
| **Hosting** | Google Cloud Run (us-central1) |
| **CI/CD** | Google Cloud Build · Artifact Registry |
| **Auth** | Google OAuth 2.0 via `chrome.identity` |
| **Infrastructure** | Terraform · `cloudbuild.yaml` |
| **Rate Limiting** | Slowapi (Backend Protection) |
| **Email** | SMTP (feedback delivery) |
| **HTTP Client** | httpx (Async Tool Execution) |

---

## ⚙️ Spin up instructions (Judges' Guide)

#### Option A — Use the Hosted Version (Recommended)
The backend is already live on Google Cloud Run. No setup required.

1. Download the extension zip: [Google Drive](https://drive.google.com/file/d/1Chchfy7CQhUxtMlPEJh1a40fTOHsAc_J/view?usp=sharing)
2. Unzip the file
3. Open Chrome → go to `chrome://extensions`
4. Enable **Developer Mode** (toggle, top right)
5. Click **Load unpacked** → select the unzipped `extension/` folder
6. Pin the **Axis** icon from the Chrome toolbar → click to open
7. Sign in with your Google account and start using Axis

> > **Note:** Axis requests access to your Google account name and profile picture for authentication and personalisation. No other account data is accessed or stored beyond your session history within the app.


#### Option B — Run Locally
1. Clone the repo and install dependencies:
```bash
   pip install -r requirements.txt
```
2. Copy `.env.example` to `.env` and fill in your GCP credentials:
```
   GOOGLE_GENAI_USE_VERTEXAI=1
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_CLOUD_LOCATION=us-central1
   GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
   FIREBASE_PROJECT_ID=your-firebase-project
```
3. Start the backend:
```bash
   uvicorn app:app --host 0.0.0.0 --port 8080
```
4. In `extension/sidepanel/sidepanel.js`, set `IS_PROD = false`
5. Load the extension as described in Option A

---

## 🧪 Learning Curve

### 🦾 AI & Multimodal Reasoning
- **Navigation Desync** — Tracking explicit Window IDs is critical for agents operating in sidepanels to prevent the agent from getting "lost" during tab switches.
- **Latency vs. Quality** — Using PCM 16kHz audio format via ADK allowed for near-instant response times, bridging the gap between "interaction" and "conversation."
- **Visual Logic** — Gemini excels at identifying clickable elements purely from visual context, making it far more robust than traditional automation scripts that rely on brittle CSS selectors.
- **Context Pruning** — Screenshots are large. Without pruning, the context window bloats fast and hits Error 1007. Axis keeps only the last screenshot as image data, replaces older ones with a text placeholder, and caps history at 20 turns to keep Gemini sharp.

### ☁️ Cloud & Production Stability
- **Gemini Live API** — Getting the API to work reliably required navigating undocumented model aliasing bugs, SDK version dependencies, and regional availability constraints that only surfaced at runtime.
- **Cloud Run Entrypoints** — Deploying for the first time revealed how much implicit setup a local environment handles invisibly — credentials, permissions, environment variables, and the shape of the entrypoint file all had to be explicitly configured from scratch.
- **Security Hygiene** — Implemented proper `.gcloudignore` rules after discovering sensitive credential files were being accidentally bundled into source uploads. Manually purged all previously uploaded source zips from the GCS staging bucket.
- **Rate Limiting on Cloud Run** — All traffic arrives from the same load balancer IP, causing the rate limiter to throttle all users simultaneously. Fixed by reading the real client IP from `X-Forwarded-For`. Added exponential backoff with 3 retries and live status updates to the UI on quota hits.
- **Graceful Degradation** — Built a noise filter to ignore single-character mic artifacts, output sanitisation to strip internal agent monologue before it reaches the user, and a one-click connection recovery screen instead of a full page crash.

The biggest learning was that multimodal agent development is still a frontier. The tooling is powerful but young — model strings change, SDK versions matter more than expected, and the gap between "it works locally" and "it works in production" is wider than in traditional web development. Shipping Axis under a 4-day deadline made every one of these lessons land hard and fast.

*#PressureIsAPrivilege*

---

## 📁 Project Structure
```
AXIS/
├── agent/                  # ADK agent + tools
│   ├── Axis_agent.py       # Main agent definition + system prompt
│   └── tools/              # screenshot, DOM, browser, session, imagegen tools
├── backend/                # FastAPI server
│   ├── main.py             # WebSocket handlers, REST endpoints
│   ├── config.py           # Environment configuration
│   └── firestore_client.py # Firestore session storage
├── extension/              # Chrome MV3 extension
│   ├── sidepanel/          # Main UI (idle, live, chat, settings views)
│   ├── content/            # DOM action scripts
│   └── background/         # Service worker, tab capture, mic
├── infra/                  # Cloud Run, Terraform, Cloud Build configs
├── app.py                  # Cloud Run entrypoint
└── requirements.txt
```

**Developer:** Sharon Varghese  
**Built for the Gemini Live Agent Challenge 2026.**