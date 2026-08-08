import './Features.css'

export default function Features() {
  return (
    <section className="features" id="features">
      <div className="container">
        {/* Section Header */}
        <div className="features__header">
          <h2 className="heading-lg features__title">
            Why developers & users choose AXIS
          </h2>
          <p className="body-lead features__subtitle">
            Automating web interaction gives you back the one thing AI hasn't yet — hands-free independence.
          </p>
        </div>

        {/* 3 Large Cards Grid (CALL-E Image 2 Style) */}
        <div className="features__grid">
          {/* Card 1 */}
          <div className="features__card">
            <div className="features__card-head">
              <span className="features__num">01</span>
              <h3 className="heading-md features__card-title">Quick Zero-Setup Install</h3>
              <p className="body-sm features__card-desc">
                Start using AXIS immediately via standalone Chrome Extension. No local Python script or terminal required.
              </p>
            </div>
            
            <div className="features__visual features__visual--1">
              <div className="features__chip">Chrome MV3</div>
              <div className="features__chip">Cloud Run REST</div>
              <div className="features__chip">Live WS Agent</div>
              <div className="features__chip">Gemini 2.5 Flash</div>
            </div>
          </div>

          {/* Card 2 */}
          <div className="features__card">
            <div className="features__card-head">
              <div className="features__card-top-row">
                <span className="features__num">02</span>
                <span className="features__badge-dev">LIVE AGENT</span>
              </div>
              <h3 className="heading-md features__card-title">Goal-Driven Action</h3>
              <p className="body-sm features__card-desc">
                Speak your goal. AXIS analyzes your tab, creates an execution path, clicks buttons, types fields, and handles popups.
              </p>
            </div>

            <div className="features__visual features__visual--2">
              <div className="features__mock-window">
                <div className="features__mock-header">
                  <span className="features__dot" />
                  <span className="features__dot" />
                  <span className="features__dot" />
                  <span className="features__mock-title">AXIS Goal Planner</span>
                </div>
                <div className="features__mock-body">
                  <div className="features__step features__step--done">
                    <span className="features__step-check">✓</span>
                    <span>Analyzed active viewport context</span>
                  </div>
                  <div className="features__step features__step--active">
                    <span className="features__step-spinner" />
                    <span>Executing: Click "Add to Cart"</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div className="features__card">
            <div className="features__card-head">
              <span className="features__num">03</span>
              <h3 className="heading-md features__card-title">Multimodal Vision AI</h3>
              <p className="body-sm features__card-desc">
                Because Gemini sees the screen visually, AXIS works on any website — including shadow DOMs and custom web apps.
              </p>
            </div>

            <div className="features__visual features__visual--3">
              <div className="features__audio-bar-box">
                <div className="features__waveform">
                  <span style={{ height: '40%' }} />
                  <span style={{ height: '85%' }} />
                  <span style={{ height: '60%' }} />
                  <span style={{ height: '100%' }} />
                  <span style={{ height: '50%' }} />
                  <span style={{ height: '75%' }} />
                  <span style={{ height: '30%' }} />
                </div>
                <span className="features__audio-label">Gemini Audio Stream Active</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
