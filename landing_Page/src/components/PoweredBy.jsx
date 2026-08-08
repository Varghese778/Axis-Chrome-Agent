import { useState } from 'react'
import './PoweredBy.css'

const faqs = [
  {
    q: 'How do I install and start using AXIS?',
    a: 'Download the Axis-Extension.zip file from this landing page, open chrome://extensions in Developer mode, click "Load unpacked", and select the extracted folder. You are ready to go in under 30 seconds!'
  },
  {
    q: 'Is AXIS safe for browsing and private tabs?',
    a: 'Yes. AXIS can only see and interact with the specific browser tab you explicitly grant permission to. It never accesses other tabs, private windows, or background browser activity.'
  },
  {
    q: 'Does AXIS require any local backend or terminal setup?',
    a: 'No! The backend is fully deployed on Google Cloud Run and handles Gemini Live 2.5 WebSockets and Vertex AI image generation automatically.'
  },
  {
    q: 'Which Gemini model powers AXIS?',
    a: 'AXIS is built on Gemini 2.5 Flash Native Audio for real-time WebSocket voice interaction, combined with Vertex AI Image Generation for multimodal tasks.'
  },
  {
    q: 'How does AXIS interact with web page elements?',
    a: 'AXIS analyzes the visual screen coordinates alongside Chrome DOM trees, allowing it to accurately click buttons, fill input fields, scroll, and switch tabs.'
  }
]

export default function PoweredBy() {
  const [openIndex, setOpenIndex] = useState(1)

  const toggleFaq = (idx) => {
    setOpenIndex(openIndex === idx ? -1 : idx)
  }

  return (
    <section className="powered" id="faq">
      <div className="container">
        {/* Top 2 Feature Highlight Cards (CALL-E Image 5 Style) */}
        <div className="powered__highlights-grid">
          <div className="powered__h-card">
            <div className="powered__h-icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
              </svg>
            </div>
            <p className="powered__h-text">
              Direct access to Gemini Live 2.5 Flash Native Audio for real-time voice interaction.
            </p>
          </div>

          <div className="powered__h-card">
            <div className="powered__h-icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
              </svg>
            </div>
            <p className="powered__h-text">
              Explicit tab-scoped permission model. AXIS only sees the tab you active-grant access to.
            </p>
          </div>
        </div>

        {/* Bottom FAQ Split Section (CALL-E Image 5 Style) */}
        <div className="powered__faq-split">
          <div className="powered__faq-left">
            <span className="mono-tag">FAQ</span>
            <h2 className="heading-lg powered__faq-title">
              Here are a few things you might be wondering.
            </h2>
          </div>

          <div className="powered__faq-right">
            <div className="powered__accordion">
              {faqs.map((item, idx) => (
                <div
                  key={idx}
                  className={`powered__faq-item ${openIndex === idx ? 'powered__faq-item--open' : ''}`}
                >
                  <button
                    className="powered__faq-question"
                    onClick={() => toggleFaq(idx)}
                  >
                    <span>{item.q}</span>
                    <svg
                      className="powered__faq-arrow"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {openIndex === idx && (
                    <div className="powered__faq-answer">
                      <p>{item.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
