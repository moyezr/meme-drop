const chromeStoreUrl = process.env.NEXT_PUBLIC_CHROME_STORE_URL || "#";

export default function Home() {
  return (
    <main className="pageShell">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Reply with the right meme.</h1>
        <p className="subtitle">
          MemeDrop reads the tweet, picks five relevant meme templates, captions
          them, and lets you drop the best one into your X reply.
        </p>

        <div className="demoFrame" aria-label="MemeDrop demo video">
          <div className="browserBar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <video
            src="/landing-video.webm"
            controls
            muted
            playsInline
            preload="metadata"
            aria-label="MemeDrop product demo"
          />
        </div>
      </section>

      <footer className="footer">
        <div className="footerLinks">
          <a
            href="https://github.com/moyezr/meme-drop"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <span aria-hidden="true">·</span>
          <span>MemeDrop</span>
        </div>
        <p className="footerNote">
          Open to work —{" "}
          <a
            href="https://x.com/MoyezRabbani"
            target="_blank"
            rel="noopener noreferrer"
          >
            DM on X
          </a>{" "}
          or{" "}
          <a href="mailto:moyezrabbani.work@gmail.com">
            moyezrabbani.work@gmail.com
          </a>
        </p>
      </footer>
    </main>
  );
}
