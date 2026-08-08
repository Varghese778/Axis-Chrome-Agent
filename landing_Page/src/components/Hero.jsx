import './Hero.css'

export default function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="container hero__inner">
        {/* Partner Badge */}
        <div className="hero__badge-row">
          <div className="badge-partner">
            POWERED BY GOOGLE VERTEX AI & GEMINI 2.5 FLASH
          </div>
        </div>

        {/* Main Headline */}
        <h1 className="heading-xl hero__title">
          Navigate the web with <span className="u-line">your voice</span>
        </h1>

        {/* Subtitle */}
        <p className="body-lead hero__subtitle">
          Multimodal vision AI for your browser. AXIS sees your active screen, understands natural context, and executes actions hands-free.
        </p>

        {/* Action Callout Box (Solid Cream Container) */}
        <div className="hero__callout-card">
          <div className="hero__callout-text-group">
            <span className="hero__callout-title">Ready to experience AXIS?</span>
            <span className="hero__callout-sub">Free standalone Chrome Extension (.zip package)</span>
          </div>
          <a href="/Axis-Extension.zip" download="Axis-Extension.zip" className="btn-black hero__callout-btn">
            DOWNLOAD EXTENSION (.ZIP)
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
        </div>

        {/* Bottom Split Grid (CALL-E Image 1 Layout) */}
        <div className="hero__bottom-grid">
          {/* Left Column: Backend Health Service */}
          <div className="hero__bottom-col">
            <span className="mono-tag">BACKEND SERVICE STATUS</span>
            <div className="hero__health-box">
              <div className="hero__health-status">
                <span className="hero__health-dot" />
                <span>Backend Live on Cloud Run</span>
              </div>
              <a
                href="https://axis-backend-461115625041.us-central1.run.app/health"
                target="_blank"
                rel="noopener noreferrer"
                className="hero__health-link"
              >
                CHECK LIVE HEALTH
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 11L11 1M11 1H3M11 1V9" />
                </svg>
              </a>
            </div>
          </div>

          {/* Right Column: Tech Stack Icons */}
          <div className="hero__bottom-col">
            <span className="mono-tag">MULTIMODAL TECH STACK</span>
            
            <div className="hero__icons-row">
              <div className="hero__icon-card" title="Gemini Live 2.5 Flash">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
                </svg>
              </div>
              <div className="hero__icon-card" title="Vertex AI">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div className="hero__icon-card" title="Google Cloud Run">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
                </svg>
              </div>
              <div className="hero__icon-card" title="Firestore DB">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
                </svg>
              </div>
              <div className="hero__icon-card" title="Chrome Extension MV3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="12" cy="12" r="4"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
