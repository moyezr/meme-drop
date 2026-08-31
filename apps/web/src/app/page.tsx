import Image from "next/image";
import "./landing.css";

export default function Home() {
  return (
    <div className="landing">
      <header className="landingNav landingWidth">
        <a className="landingBrand" href="/" aria-label="MemeDrop home">MemeDrop<span aria-hidden="true">.</span></a>
        <nav aria-label="Main navigation">
          <a href="#demo">The demo</a>
          <a href="/docs/">API docs <span aria-hidden="true">↗</span></a>
          <a className="landingNavCta" href="/sign-in">Dashboard</a>
        </nav>
      </header>
      <main id="main-content">
        <section className="landingHero landingWidth" aria-labelledby="hero-title">
          <p className="landingEyebrow"><span className="betaDot" /> Built for AI agents · Private beta</p>
          <h1 id="hero-title">Your agent has answers.<br /><span>Give it a sense of humor.</span></h1>
          <p className="landingLead">The humor layer for AI agents. Send the context.<br className="desktopBreak" /> Get a captioned meme that gets the joke.</p>
          <div className="landingActions">
            <a className="landingButton" href="/docs/">Build with MemeDrop <span aria-hidden="true">↗</span></a>
            <a className="landingTextLink" href="#demo">Watch the demo <span aria-hidden="true">↓</span></a>
          </div>
          <div className="humorPreview">
            <div className="contextCard">
              <span className="cardLabel">YOUR AGENT&apos;S CONTEXT</span>
              <p>“The agent fixed one bug.<br />Production now has three.”</p>
              <span className="contextSource"><span aria-hidden="true">&gt;_</span> a very normal Friday deploy</span>
            </div>
            <div className="humorConnector" aria-hidden="true"><span /><b>m.</b><span /></div>
            <figure className="exampleMeme">
              <figcaption>when the fix needs a fix</figcaption>
              <Image src="/examples/disaster-girl.jpg" alt="Disaster Girl smiling in front of a burning house: when the fix needs a fix." width={500} height={375} priority />
            </figure>
          </div>
          <p className="exampleNote">Illustrative example. Actual results depend on the context.</p>
        </section>
        <section id="demo" className="landingSection landingWidth demoSection" aria-labelledby="demo-title">
          <p className="landingEyebrow">LESS EXPLAINING. MORE SHOWING.</p>
          <h2 id="demo-title">A little context. A better punchline.</h2>
          <p className="sectionDescription">Watch the original extension demo. Same idea, now built for agents.</p>
          <div className="demoFrame">
            <div className="browserBar" aria-hidden="true"><span /><span /><span /><small>MemeDrop / extension demo</small></div>
            <video src="/landing-video.webm" controls muted playsInline preload="metadata" aria-label="Original MemeDrop Chrome extension demo" />
          </div>
          <p className="exampleNote">Original extension workflow. Chrome Web Store release is pending.</p>
        </section>
      </main>
      <footer className="landingFooter landingWidth">
        <div><a className="landingBrand" href="/">MemeDrop<span aria-hidden="true">.</span></a><p>A little less robotic.</p></div>
        <nav aria-label="Footer navigation"><a href="/docs/">API docs</a><a href="/privacy-policy/">Privacy</a><a href="mailto:moyezrabbani.work@gmail.com">Support</a></nav>
      </footer>
    </div>
  );
}
