import './HowItWorks.css'

export default function HowItWorks() {
  return (
    <section className="hiw" id="how-it-works">
      <div className="container">
        {/* Split Hero Card (CALL-E Image 3 Style) */}
        <div className="hiw__split-card">
          {/* Left Text Column */}
          <div className="hiw__text-col">
            <span className="mono-tag">I'M AXIS</span>
            <h2 className="heading-lg hiw__title">
              Less thinking, more doing. AXIS handles the browser, you live your life.
            </h2>
            <p className="body-lead hiw__desc">
              Unlike legacy extensions built on rigid scripts, AXIS treats every web request as a goal-driven task. Tell AXIS what you need done, and it handles it end-to-end — adapting in real time to whatever page you're on.
            </p>
          </div>

          {/* Right Card Column (Canvas Note) */}
          <div className="hiw__note-col">
            <div className="hiw__paper-note">
              <div className="hiw__note-dots">
                <span /><span /><span /><span /><span /><span /><span />
              </div>
              <p className="hiw__note-text">
                "I'm AXIS — your voice compass for the open web. I sit in your browser toolbar, listen to your natural voice, see your active tab using Gemini 2.5 Flash, and click or type for you."
              </p>
              <div className="hiw__note-footer">
                <span className="hiw__note-tag">#GeminiAgentChallenge</span>
                <span className="hiw__note-tag">MV3 Chrome Extension</span>
              </div>
            </div>
          </div>
        </div>

        {/* Installation Steps Section */}
        <div className="hiw__steps-section">
          <div className="hiw__steps-header">
            <span className="mono-tag">INSTALLATION GUIDE</span>
            <h3 className="heading-md">3 simple steps to start using AXIS</h3>
          </div>

          <div className="hiw__steps-grid">
            <div className="hiw__step-card">
              <span className="hiw__step-num">STEP 01</span>
              <h4 className="hiw__step-title">Download Extension Zip</h4>
              <p className="hiw__step-desc">
                Click to download the official <code className="hiw__code">Axis-Extension.zip</code> package and extract it to a folder on your device.
              </p>
              <a href="/Axis-Extension.zip" download="Axis-Extension.zip" className="btn-pill hiw__step-btn">
                DOWNLOAD .ZIP
              </a>
            </div>

            <div className="hiw__step-card">
              <span className="hiw__step-num">STEP 02</span>
              <h4 className="hiw__step-title">Open Developer Mode</h4>
              <p className="hiw__step-desc">
                Navigate to <code className="hiw__code">chrome://extensions</code> in Chrome and toggle <strong>Developer mode</strong> ON in the top right.
              </p>
            </div>

            <div className="hiw__step-card">
              <span className="hiw__step-num">STEP 03</span>
              <h4 className="hiw__step-title">Load Unpacked Extension</h4>
              <p className="hiw__step-desc">
                Click <strong>"Load unpacked"</strong> at top left and select the extracted extension folder. AXIS will instantly appear in your toolbar!
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
