import './App.css'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Features from './components/Features'
import HowItWorks from './components/HowItWorks'
import Showcase from './components/Showcase'
import PoweredBy from './components/PoweredBy'
import Accessibility from './components/Accessibility'
import Footer from './components/Footer'

function App() {
  return (
    <div className="app-root">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Showcase />
        <PoweredBy />
        <Accessibility />
      </main>
      <Footer />
    </div>
  )
}

export default App
