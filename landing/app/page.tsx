const chromeStoreUrl = process.env.NEXT_PUBLIC_CHROME_STORE_URL || "#launch-assets";

const highlights = ["Fast suggestions", "Captioned templates", "Personal library"];

const steps = [
  {
    number: "01",
    title: "Open a reply",
    body: "MemeDrop detects the tweet context when you open X's composer.",
  },
  {
    number: "02",
    title: "Pick from ranked memes",
    body: "Visual suggestions appear first, so you do not wait for captions before choosing.",
  },
  {
    number: "03",
    title: "Drop it in",
    body: "Click or drag a meme into the reply box. Caption rendering finishes when needed.",
  },
];

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <nav className="nav" aria-label="Primary navigation">
          <a className="brand" href="/">
            <span className="brandMark" aria-hidden="true">
              M
            </span>
            <span>MemeDrop</span>
          </a>
          <div className="navLinks">
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
            <a className="navCta" href={chromeStoreUrl}>
              Install
            </a>
          </div>
        </nav>

        <div className="heroGrid">
          <div className="heroCopy">
            <p className="eyebrow">Chrome extension for X replies</p>
            <h1>Drop the right meme before the moment dies.</h1>
            <p className="lede">
              MemeDrop reads the tweet you are replying to, ranks your meme library,
              and prepares captioned suggestions you can click or drag into the composer.
            </p>
            <div className="heroActions">
              <a className="primary" href={chromeStoreUrl}>
                Add to Chrome
              </a>
              <a className="secondary" href="#demo">
                Watch demo
              </a>
            </div>
            <div className="trustRow" aria-label="Product highlights">
              {highlights.map((highlight) => (
                <span key={highlight}>{highlight}</span>
              ))}
            </div>
          </div>

          <div className="demoCard" id="demo" aria-label="MemeDrop product demo preview">
            <div className="browserBar" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="tweetCard">
              <p className="tweetAuthor">@founder</p>
              <p>shipping the MVP today, the tests can catch up emotionally</p>
            </div>
            <div className="suggestionPopover">
              <div className="popoverHead">
                <strong>MemeDrop</strong>
                <span>5 matches</span>
              </div>
              <div className="memeRow">
                <article className="memeTile hot">
                  <div className="memeArt">THIS IS FINE</div>
                  <span>tiny disaster</span>
                </article>
                <article className="memeTile">
                  <div className="memeArt split">
                    ME
                    <br />
                    ALSO ME
                  </div>
                  <span>hypocrisy</span>
                </article>
                <article className="memeTile">
                  <div className="memeArt cinema">
                    ABSOLUTE
                    <br />
                    CINEMA
                  </div>
                  <span>overreaction</span>
                </article>
              </div>
            </div>
            <p className="assetNote">Replace this panel with your recorded demo video.</p>
          </div>
        </div>
      </section>

      <section className="steps" id="how">
        <div className="sectionCopy">
          <p className="eyebrow">How it works</p>
          <h2>Rank fast. Caption in the background. Insert when ready.</h2>
        </div>
        <div className="stepGrid">
          {steps.map((step) => (
            <article key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="privacy" id="privacy">
        <div>
          <p className="eyebrow">Built for a small beta</p>
          <h2>Launch lean, learn from usage, improve the meme set.</h2>
        </div>
        <p>
          MemeDrop starts with a curated template set and lightweight feedback logging.
          The first production version should be shipped as a private or unlisted Chrome
          extension until account identity and abuse controls are stronger.
        </p>
      </section>

      <section className="assetBlock" id="launch-assets">
        <p className="eyebrow">Launch assets</p>
        <h2>Demo video, store screenshots, and privacy copy are the remaining inputs.</h2>
        <p>
          The implementation is ready for your real product assets. The exact list is
          tracked in <code>LAUNCH_ASSETS.md</code>.
        </p>
      </section>
    </main>
  );
}
