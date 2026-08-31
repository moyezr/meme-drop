export function SiteFooter() {
  return (
    <footer className="landing landingFooter landingWidth">
      <div>
        <a className="landingBrand" href="/">MemeDrop<span aria-hidden="true">.</span></a>
        <p>A little less robotic.</p>
        <p>Built by Moyez Rabbani.</p>
      </div>
      <div className="footerDetails">
        <nav aria-label="Footer navigation">
          <a href="/docs/">API docs</a>
          <a href="/#credits">Credits</a>
          <a href="/terms/">Terms</a>
          <a href="/privacy-policy/">Privacy</a>
          <a href="/refund-policy/">Refunds</a>
        </nav>
        <a className="footerSupport" href="mailto:moyezrabbani.work@gmail.com">moyezrabbani.work@gmail.com <span aria-hidden="true">↗</span></a>
        <p>Private beta · Paid checkout is not open.</p>
      </div>
    </footer>
  );
}
