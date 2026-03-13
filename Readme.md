# ☸️ Axis: Voice-Driven UI Navigator
**Built for the Gemini Live Agent Challenge 2026**

[![Deploy to Cloud Run](https://storage.googleapis.com/cloudrun/button.svg)](https://console.cloud.google.com/cloudshell/editor?shellonly=true&cloudshell_image=gcr.io/cloudrun/button&cloudshell_git_repo=YOUR_REPO_URL)

**Hackathon Category:** UI Navigator ☸️  
**Agent Development Kit (ADK) Used:** Yes  
**Google Cloud Services:** Cloud Run, Cloud Build, Firestore, Secret Manager  

## 📖 Project Overview
Axis is a next-generation visual UI understanding agent that acts as a user's hands on the screen. By observing the browser display via a Chrome Extension and interpreting visual elements using the **Gemini 2.0 Multimodal Live API**, Axis allows users to navigate the web, automate cross-application workflows, and perform complex UI interactions entirely through natural, interruptible voice commands.

### The Problem & Value Proposition
Standard screen readers and web macros are rigid and break easily when UI layouts change. Axis solves this by using Gemini's multimodal reasoning to "see" the screen contextually. The value is a truly universal web navigator that bridges the accessibility gap and hyper-automates tedious browser tasks without relying purely on static DOM access.

## ✨ Features & Functionality
* **Real-Time Multimodal Interaction:** Streams audio inputs and predictive browser screenshots via WebSockets to the Gemini Live agent.
* **Interruptible Voice Control:** Users can interrupt the agent mid-task to course-correct its web navigation.
* **Visual DOM Execution:** Translates Gemini's spatial understanding into executable JavaScript actions (clicking, typing, scrolling) via Manifest V3 content scripts.

## 🛠 Technologies Used
* **AI/Models:** Gemini 2.0 Pro Multimodal Live API, Agent Development Kit (ADK).
* **Backend:** Python 3.11, FastAPI, WebSockets, Asyncio.
* **Frontend/Client:** Chrome Extension (Manifest V3), JavaScript, HTML/CSS.
* **Google Cloud (GCP):** Cloud Run (Backend Hosting), Cloud Build (CI/CD), Firestore (Session & State Management), Terraform (Infrastructure as Code).

## 🧑‍⚖️ Hackathon Submission Assets (For Judges)

### 1. Demonstration Video
[Link to your <4 Minute YouTube/Drive Video Here]
*Highlights: Real-time navigation, interruptibility, and problem pitch.*

### 2. Architecture Diagram
![Architecture Diagram](./infra/architecture.png) 
*(Note: Upload your diagram to an `infra/` folder and link it here. It must show Chrome Ext -> WebSockets -> Cloud Run/ADK -> Gemini API -> Firestore).*

### 3. Proof of Google Cloud Deployment
* **Live Backend Endpoint:** `https://your-cloud-run-url.a.run.app`
* **Proof Video/Screenshot:** [Link to your GCP Console Screen Recording]
* **Infrastructure as Code (Bonus):** See [`/infra/cloudbuild.yaml`](./infra/cloudbuild.yaml) and [`/infra/main.tf`](./infra/main.tf) for our automated Cloud Build and Terraform deployment pipelines.

### 4. Published Content (Bonus)
* **Blog/Post:** [Link to your LinkedIn/Medium post using #GeminiLiveAgentChallenge]
* **GDG Profile:** [Link to your Google Developer Group Profile]

---

## ⚙️ Spin-Up Instructions (Reproducibility)

Judges can reproduce this project either locally or deploy it directly to their own GCP environment.

### Option A: Run Locally
1. **Clone the repository:**
   ```bash
   git clone [https://github.com/YOUR_GITHUB/axis-chrome-agent.git](https://github.com/YOUR_GITHUB/axis-chrome-agent.git)
   cd axis-chrome-agent