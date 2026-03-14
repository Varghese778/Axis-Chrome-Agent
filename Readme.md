# 🧭 Axis: AI-Powered UI Navigator 
**Winner's entry for the Gemini Live Agent Challenge 2026**

---

## 📖 Project Overview
Axis is a next-generation **multimodal UI Navigator** that transforms the browser into an agentic playground. Instead of relying on brittle DOM scrapers or rigid automation scripts, Axis uses the **Gemini 2.0 Multimodal Live API** to truly "see" the screen via screenshots. 

Users can control their entire browsing experience—from searching YouTube to navigating complex cloud consoles—entirely through natural, interruptible voice commands.

### ☸️ Why Axis? (The Pitch)
Standard web automation breaks when a single CSS class changes. Axis is different. It uses visual reasoning to understand UI layout, context, and intent. It bridges the gap between AI reasoning and browser execution, providing a universal hands-free interface for anyone, anywhere.

---

## ✨ Core Features
*   **Gemini Live Integration**: Real-time, low-latency audio streaming for natural conversations.
*   **Multimodal Vision**: The agent interprets screenshots to decide where to click, type, or scroll.
*   **Persistent Permissions**: Elegant onboarding flow to handle Chrome's microphone and security requirements.
*   **Fully Interruptible**: Stop or redirect the agent mid-action—just like talking to a human assistant.
*   **GCP Native**: Scaleably deployed on **Cloud Run** with automated CI/CD via **Cloud Build**.

---

## 🛠 Tech Stack
*   **Frontend**: Chrome Extension (Manifest V3), PCM Audio Processing.
*   **Backend**: Python (FastAPI), WebSockets, **Google GenAI ADK**.
*   **Infrastructure**: Google Cloud Run, Firestore (Session Storage), Secret Manager.
*   **Automation**: Terraform (IaC), Cloud Build (CI/CD).

---

## ⚙️ Setup & Installation (Judges' Guide)

### 1. Load the Chrome Extension
1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer Mode** (top right).
3.  Click **Load Unpacked** and select the `extension/` folder from this repo.
4.  Pin the **Axis** icon and open the sidepanel.

### 2. Backend Deployment (Optional for Local Review)
The backend is already live on Google Cloud. However, to run locally:
1.  Install dependencies: `pip install -r requirements.txt`
2.  Set up your `.env` with `GOOGLE_API_KEY` and `FIRESTORE_PROJECT_ID`.
3.  Run the server: `python backend/main.py`
4.  Update `IS_PROD = false` in `sidepanel.js`.

---

## 🧑‍⚖️ Submission Assets

### 🏗️ Architecture
We've provided a clear architecture diagram highlighting the flow between the Extension, our GCP-hosted ADK bridge, and the Gemini Live API.
- [View Architecture Diagram](./infra/architecture.png)

### 📹 Demonstration
Our 4-minute demo showcases real-time multimodal interaction and the agent's ability to handle complex navigation tasks.
- [Watch Demo Video](https://your-video-link-here)

### ☁️ Proof of Deployment (GCP)
- **Live Endpoint**: [https://axis-backend-461115625041.us-central1.run.app](https://axis-backend-461115625041.us-central1.run.app)
- **Infrastructure Code**: See [`/infra/main.tf`](./infra/main.tf) for our Terraform configuration and [`/infra/cloudbuild.yaml`](./infra/cloudbuild.yaml) for our deployment pipeline.
https://axis-backend-461115625041.us-central1.run.app
---

## 🧪 Challenges & Learnings
- **Audio Jitter**: We implemented a custom PCM jitter buffer on the frontend to ensure the Gemini voice remains smooth even over variable network conditions.
- **Context Sync**: Navigating between "Restricted" Chrome pages and public sites required a robust state-management system to keep the agent from getting "lost" in transition.

**Built with ❤️ for the Gemini Live Agent Challenge.**