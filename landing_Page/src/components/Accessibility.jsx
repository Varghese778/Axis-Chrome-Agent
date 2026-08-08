import './Accessibility.css'

const useCases = [
  {
    tag: 'MOTOR ACCESSIBILITY',
    title: 'Motor Disabilities & Mobility',
    desc: 'For users living with ALS, Parkinson\'s, spinal cord injuries, or severe RSI — AXIS enables complete browser independence without touching a physical keyboard or mouse.'
  },
  {
    tag: 'HANDS-FREE CONTROL',
    title: 'Natural Voice Independence',
    desc: 'Navigate multi-step checkout flows, fill out complex forms, and control dynamic web applications purely using natural conversational commands.'
  },
  {
    tag: 'MULTIMODAL REASONING',
    title: 'Universal Visual Compatibility',
    desc: 'Unlike traditional screen readers that fail on missing ARIA tags, AXIS reads the visual screen coordinates using Gemini 2.5 Flash to interact with any website.'
  }
]

export default function Accessibility() {
  return (
    <section className="a11y" id="accessibility">
      <div className="container">
        {/* Section Header */}
        <div className="a11y__header">
          <span className="mono-tag">ACCESSIBILITY FIRST</span>
          <h2 className="heading-lg a11y__title">
            Built for people who need hands-free control most
          </h2>
          <p className="body-lead a11y__subtitle">
            Standard screen readers break when web interfaces change. AXIS uses multimodal AI vision to see what you see and carry out your intent.
          </p>
        </div>

        {/* 3 Use Case Cards Grid */}
        <div className="a11y__grid">
          {useCases.map((item, idx) => (
            <div key={idx} className="a11y__card">
              <span className="a11y__card-tag">{item.tag}</span>
              <h3 className="a11y__card-title">{item.title}</h3>
              <p className="a11y__card-desc">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Creator Quote Card */}
        <div className="a11y__quote-card">
          <p className="a11y__quote-text">
            "For individuals living with motor disabilities, AXIS offers something fundamental: a browser that responds to your voice the way a human assistant would — seeing your screen, understanding your intent, and acting with precision."
          </p>
          <div className="a11y__quote-meta">
            <div className="a11y__quote-avatar">
              <span>SV</span>
            </div>
            <div>
              <div className="a11y__quote-author">Sharon Varghese</div>
              <div className="a11y__quote-role">Creator of AXIS · Gemini Live Agent Challenge 2026</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
