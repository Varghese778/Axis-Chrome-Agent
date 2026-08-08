import './Footer.css'

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="footer">
      <div className="container footer__inner">
        {/* Top Split */}
        <div className="footer__top-row">
          <div className="footer__brand-col">
            <a href="#" className="footer__logo">
              <svg viewBox="0 0 40 40" width="24" height="24">
                <circle cx="20" cy="20" r="18" fill="#0A0F1D" stroke="#38BDF8" strokeWidth="1.5"/>
                <polygon points="20,7 24,20 20,17 16,20" fill="#FACC15" />
                <polygon points="20,33 16,20 20,23 24,20" fill="#38BDF8" />
              </svg>
              <span>AXIS™</span>
            </a>
            <p className="footer__tagline">
              Voice-driven browser agent built on Gemini Live 2.5 Flash & Vertex AI.
            </p>
          </div>

          <div className="footer__links-cols">
            <div className="footer__col">
              <span className="mono-tag">PRODUCT</span>
              <a href="#features" className="footer__link">Features</a>
              <a href="#how-it-works" className="footer__link">How It Works</a>
              <a href="#showcase" className="footer__link">Showcase</a>
              <a href="#accessibility" className="footer__link">Accessibility</a>
              <a href="#faq" className="footer__link">FAQ</a>
            </div>

            <div className="footer__col">
              <span className="mono-tag">RESOURCES</span>
              <a
                href="https://github.com/Varghese778/Axis-Chrome-Agent"
                target="_blank"
                rel="noopener noreferrer"
                className="footer__link"
              >
                GitHub Repository
              </a>
              <a href="/Axis-Extension.zip" download="Axis-Extension.zip" className="footer__link">
                Download Extension (.zip)
              </a>
              <a
                href="https://axis-backend-461115625041.us-central1.run.app/health"
                target="_blank"
                rel="noopener noreferrer"
                className="footer__link"
              >
                Backend Health API
              </a>
            </div>
          </div>
        </div>

        {/* Bottom Copy Row */}
        <div className="footer__bottom-row">
          <span className="footer__copy">
            © {currentYear} Sharon Varghese · Gemini Live Agent Challenge 2026
          </span>
          <div className="footer__badges">
            <span className="footer__pill">DEPLOYED ON CLOUD RUN</span>
            <span className="footer__pill">GEMINI 2.5 FLASH</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
