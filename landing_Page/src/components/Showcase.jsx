import './Showcase.css'

export default function Showcase() {
  return (
    <section className="showcase" id="showcase">
      <div className="container">
        {/* CALL-E Image 1 & 4 Style: Solid Dark Contrast Card */}
        <div className="showcase__dark-card">
          {/* Left Visual: Creation of Adam Hands + Yellow AXIS Folder Graphic */}
          <div className="showcase__left-visual">
            <div className="showcase__graphic-container">
              <img
                src="/axis_hands_folder.png"
                alt="AXIS Open Source Graphic"
                className="showcase__graphic-img"
              />
            </div>
          </div>

          {/* Right Text Column */}
          <div className="showcase__right-content">
            <span className="mono-tag" style={{ color: '#F5E56B' }}>JOIN US</span>
            <h2 className="heading-lg showcase__title">
              Open source from day one
            </h2>
            <p className="body-lead showcase__desc">
              AXIS is built in the open because we believe great developer tools should be transparent, inspectable, and owned by the community.
            </p>
            <p className="body-sm showcase__subdesc">
              Read, contribute, self-host. You're never locked in, and always in control.
            </p>
            <a
              href="https://github.com/Varghese778/Axis-Chrome-Agent"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-black showcase__github-btn"
            >
              FEEL FREE TO TWEAK IT
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
