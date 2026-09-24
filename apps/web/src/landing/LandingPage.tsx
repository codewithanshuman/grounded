import logoUrl from "../../../../assets/logo.png";
import fieldHomeUrl from "../../../../assets/grounded-field-home.png";
import monsoonUrl from "../../../../assets/grounded-monsoon.png";
import cloverSkyUrl from "../../../../assets/grounded-clover-sky.png";
import cloverStudioUrl from "../../../../assets/grounded-clover-studio.png";

export function LandingPage({
  cloudConfigured,
  authReady,
  authError,
  onEnterLab,
  onGitHubSignIn,
}: {
  cloudConfigured: boolean;
  authReady: boolean;
  authError: string | null;
  onEnterLab: () => void;
  onGitHubSignIn: () => Promise<void>;
}) {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <a className="landing-brand" href="#top" aria-label="Grounded home">
          <span><img src={logoUrl} alt="" /></span>
          <div><strong>Grounded</strong><small>Jaipur resilience lab</small></div>
        </a>
        <nav aria-label="Landing page">
          <a href="#workflow">How it works</a>
          <a href="#evidence">Evidence</a>
          <button onClick={onEnterLab}>Open live lab</button>
        </nav>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow"><i /> Jaipur · hospital energy resilience</div>
            <h1>Find the failure.<br /><span>Prove the fix.</span></h1>
            <p>Grounded stress-tests a hospital microgrid across reproducible climate futures, explains the exact chain behind critical power loss, and validates the smallest intervention on unseen scenarios.</p>
            <div className="landing-actions">
              <button className="landing-primary" onClick={onEnterLab}><span>Open the live lab</span><b>→</b></button>
              {cloudConfigured && <button className="landing-github" disabled={!authReady} onClick={() => void onGitHubSignIn()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.1c.98 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.78 1.06.78 2.14v3.28c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
                <span>{authReady ? "Continue with GitHub" : "Checking session…"}</span>
              </button>}
            </div>
            {authError && <p className="landing-auth-error">{authError}</p>}
            <div className="landing-proofline">
              <span><b>72 h</b><small>operating horizon</small></span>
              <span><b>Δ15 m</b><small>dispatch resolution</small></span>
              <span><b>245</b><small>policies searched</small></span>
              <span><b>Same seed</b><small>before / after proof</small></span>
            </div>
          </div>

          <div className="landing-visual" aria-label="Illustrated Jaipur resilience district">
            <div className="landing-visual-main"><img src={fieldHomeUrl} alt="Illustrated green field and rural home" /></div>
            <div className="landing-result-card"><small>EXTREME EVENT · VERIFIED REPLAY</small><strong><span>15</span><i>→</i><span>0</span></strong><p>critical failures after the selected policy</p></div>
            <div className="landing-visual-secondary"><img src={monsoonUrl} alt="Illustrated monsoon vegetation and water" /><span>Climate pressure</span></div>
            <div className="landing-coordinate">26.9124° N<br />75.7873° E</div>
          </div>
        </section>

        <section className="landing-signal" aria-label="Grounded capabilities">
          <span>Jaipur climate observations</span><i />
          <span>Measured public operational reference</span><i />
          <span>Browser-executed physics</span><i />
          <span>Inspectable evidence</span>
        </section>

        <section className="landing-workflow" id="workflow">
          <div className="landing-section-heading">
            <small>ONE DECISION PATH</small>
            <h2>From climate stress to a defensible intervention.</h2>
            <p>No black-box score. Each stage leaves evidence a reviewer can inspect.</p>
          </div>
          <div className="landing-steps">
            <article><span>01</span><div><small>STRESS</small><h3>Explore fixed-seed futures</h3><p>Dispatch solar, grid, battery and demand through correlated 72-hour climate events.</p></div></article>
            <article><span>02</span><div><small>DIAGNOSE</small><h3>Trace the breaking point</h3><p>Expose the exact timestep, binding constraint and causal sequence behind critical loss.</p></div></article>
            <article><span>03</span><div><small>OPTIMIZE</small><h3>Search without overfitting</h3><p>Evaluate 245 policies, then challenge the winner on disjoint holdouts and shocks.</p></div></article>
            <article><span>04</span><div><small>PROVE</small><h3>Replay the same future</h3><p>Keep every seed identical so only the intervention can explain the improved outcome.</p></div></article>
          </div>
        </section>

        <section className="landing-evidence" id="evidence">
          <div className="landing-evidence-art">
            <img src={cloverSkyUrl} alt="Illustrated clover beneath a clear blue sky" />
            <div><small>EVIDENCE WORLD</small><strong>Growth follows completed computation—not decoration.</strong></div>
          </div>
          <div className="landing-evidence-copy">
            <small>HONEST BY DESIGN</small>
            <h2>Clear about what is measured—and what is not.</h2>
            <p>Grounded combines Jaipur climate observations with a disclosed measured operational reference. It never relabels reference telemetry as local facility data.</p>
            <ul>
              <li><i>✓</i><span><strong>Source fingerprints</strong><small>Inputs and model boundaries remain visible.</small></span></li>
              <li><i>✓</i><span><strong>Independent validation</strong><small>Search and evaluation populations never overlap.</small></span></li>
              <li><i>✓</i><span><strong>Local commissioning path</strong><small>Real demand, PV and outage exports can replace the reference.</small></span></li>
            </ul>
            <button onClick={onEnterLab}>Inspect the methodology <b>→</b></button>
          </div>
        </section>

        <section className="landing-closing">
          <img src={cloverStudioUrl} alt="Illustrated clover in a warm studio" />
          <div><small>THE LIVE MODEL IS READY</small><h2>Test tomorrow before it arrives.</h2><p>Open the public lab without an account, or sign in to carry a private evidence world across devices.</p></div>
          <button onClick={onEnterLab}>Enter Grounded <span>→</span></button>
        </section>
      </main>

      <footer className="landing-footer"><span>Grounded · Jaipur, India</span><p>Climate resilience decisions with inspectable evidence.</p><button onClick={onEnterLab}>Live application ↗</button></footer>
    </div>
  );
}
