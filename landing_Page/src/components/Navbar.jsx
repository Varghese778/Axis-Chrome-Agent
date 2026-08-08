import { useState, useEffect } from 'react'
import './Navbar.css'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}>
      <div className="container navbar__inner">
        {/* Brand Logo */}
        <a href="#" className="navbar__brand">
          <svg className="navbar__logo-icon" viewBox="0 0 40 40" width="26" height="26">
            <circle cx="20" cy="20" r="18" fill="#042828" stroke="#E8C9CF" strokeWidth="1.5" />
            <polygon points="20,7 24,20 20,17 16,20" fill="#A25524" />
            <polygon points="20,33 16,20 20,23 24,20" fill="#E8C9CF" />
          </svg>
          <span className="navbar__brand-name">AXIS<span className="navbar__trademark">™</span></span>
        </a>

        {/* Navigation Links */}
        <nav className="navbar__nav">
          <a href="#features" className="navbar__link">Features</a>
          <a href="#how-it-works" className="navbar__link">How it works</a>
          <a href="#accessibility" className="navbar__link">Accessibility</a>
          <a href="#faq" className="navbar__link">FAQ</a>
        </nav>

        {/* Action Buttons */}
        <div className="navbar__actions">
          <a
            href="https://github.com/Varghese778/Axis-Chrome-Agent"
            target="_blank"
            rel="noopener noreferrer"
            className="navbar__github-btn"
          >
            GITHUB
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          </a>
          <a href="/Axis-Extension.zip" download="Axis-Extension.zip" className="btn-black navbar__cta">
            INSTALL EXTENSION
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 11L11 1M11 1H3M11 1V9" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  )
}
