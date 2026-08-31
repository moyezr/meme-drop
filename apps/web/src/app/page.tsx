import Image from "next/image";
import { HumorDemo } from "./humor-demo";
import { landingApiExample } from "./landing-examples";
import { SiteFooter } from "./site-footer";

const productSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "MemeDrop",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  description: "The humor layer for AI agents: an authenticated API that turns text context into captioned meme images. Private beta; paid checkout is not open.",
  url: "https://memedrop.moyezrabbani.dev",
  featureList: ["Context-aware meme selection", "AI-assisted captions", "Rendered meme images", "Credit-based generation"],
  author: { "@type": "Person", name: "Moyez Rabbani", url: "https://moyezrabbani.dev" },
};

export default function Home() {
  return (
    <div className="landing">
      <a className="skipLink" href="#main-content">Skip to content</a>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }} />
      <header className="landingNav landingWidth">
        <a className="landingBrand" href="/" aria-label="MemeDrop home">MemeDrop<span aria-hidden="true">.</span></a>
        <nav aria-label="Main navigation">
          <a href="#demo">The demo</a>
          <a href="#credits">Credits</a>
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
          <HumorDemo />
          <div className="howItWorks" aria-label="How MemeDrop works">
            <div><span>01</span><h3>Read the room.</h3><p>Your agent sends a moment worth reacting to.</p></div>
            <div><span>02</span><h3>Find the funny.</h3><p>MemeDrop matches a template and writes the caption.</p></div>
            <div><span>03</span><h3>Drop the meme.</h3><p>Fetch the image. Use it in your app, chat, or reply.</p></div>
          </div>
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
        <section id="for-agents" className="landingSection landingWidth agentSection" aria-labelledby="agents-title">
          <div className="agentCopy">
            <p className="landingEyebrow">SERIOUS API. UNSERIOUS OUTPUT.</p>
            <h2 id="agents-title">A tool call.<br />With comic timing.</h2>
            <p className="sectionDescription">Add meme generation to your agent&apos;s toolkit. One HTTPS request in. Captioned images out.</p>
            <a className="landingTextLink" href="/docs/">Read the API docs <span aria-hidden="true">↗</span></a>
            <p className="agentFinePrint">API key and credits required. Image downloads are authenticated and available for 30 days.</p>
          </div>
          <div className="agentCode">
            <div className="codeHeader"><span>agent → MemeDrop</span><span>HTTPS / JSON</span></div>
            <pre><code>{landingApiExample}</code></pre>
            <div className="codeResult"><span className="betaDot" /><span>Returns image URLs, ready for your agent to fetch.</span></div>
          </div>
        </section>
        <section className="landingSection landingWidth reactionSection" aria-labelledby="reaction-title">
          <figure className="reactionMeme exampleMeme">
            <figcaption>can't fail tests if there are no tests</figcaption>
            <Image src="/examples/roll-safe.jpg" alt="Roll Safe pointing at his temple: a joke about deleting failing tests instead of fixing code." width={702} height={395} sizes="(max-width: 720px) 90vw, 360px" />
          </figure>
          <div>
            <p className="landingEyebrow">CONTEXT MAKES THE JOKE.</p>
            <h2 id="reaction-title">Not just a random meme.</h2>
            <p className="sectionDescription">The right reaction to a broken build. A meeting that could&apos;ve been an email. Or your agent being a little too helpful.</p>
            <p className="reactionAside">Built for the moments that don&apos;t need another paragraph.</p>
          </div>
        </section>
        <section id="credits" className="landingSection landingWidth" aria-labelledby="credits-title">
          <div className="creditPanel">
            <div><p className="landingEyebrow">CREDITS, SIMPLY.</p><h2 id="credits-title">One meme. One credit.</h2><p className="sectionDescription">Only completed memes use credits. Failed generations don&apos;t. Retrying the same request with the same idempotency key doesn&apos;t charge twice.</p></div>
            <div className="creditAvailability"><span className="smallBadge">Private beta</span><h3>Paid packs aren&apos;t on sale yet.</h3><p>One-time credit packs are planned. Prices and purchase terms will be published before checkout opens.</p><a className="landingTextLink" href="mailto:moyezrabbani.work@gmail.com?subject=MemeDrop%20beta%20access">Ask about beta access <span aria-hidden="true">↗</span></a></div>
          </div>
        </section>
        <section className="landingSection landingWidth faqSection" aria-labelledby="faq-title">
          <div><p className="landingEyebrow">THE SHORT VERSION.</p><h2 id="faq-title">A few good questions.</h2></div>
          <div className="faqList">
            <details><summary>What does MemeDrop actually do?</summary><p>MemeDrop is an AI-assisted meme-generation API. It reads your text, selects a relevant meme template, writes a caption, and returns a rendered image for your agent or application.</p></details>
            <details><summary>Do I need the Chrome extension?</summary><p>No. AI agents use the HTTPS API directly. The video shows our original extension workflow; the Chrome Web Store release is still pending.</p></details>
            <details><summary>Can I use it today?</summary><p>The API is in private beta. Sign in to manage API keys, then contact us to arrange access and credits. Self-service credit purchases are not available yet.</p></details>
            <details><summary>What happens to my input and images?</summary><p>Text is processed to generate your meme, including by our AI provider. Raw input and captions aren&apos;t stored as text in application records. Generated images are stored for 30 days. See our <a href="/privacy-policy/">privacy policy</a> for details and provider limitations.</p></details>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
