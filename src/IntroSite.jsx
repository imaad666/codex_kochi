import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_CARDS,
  INTRO_FEATURES,
  INTRO_FLOW,
  INTRO_MANIFESTO,
  INTRO_STATS,
} from "./agentCards.js";

const CRT = {
  text: "#e7ff4a",
  textDim: "#c7da2e",
  textSoft: "#f2ff8a",
  led: "#e87830",
};

const SECTION_META = [
  { id: "hero", label: "Home" },
  { id: "manifesto", label: "Why" },
  { id: "cards", label: "Cards" },
  { id: "flow", label: "Flow" },
  { id: "features", label: "Features" },
  { id: "launch", label: "Launch" },
];

export const introCss = `
  .intro-shell {
    flex: 1;
    min-height: 0;
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
  }
  .intro-site {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    scroll-snap-type: y mandatory;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }
  .intro-slide {
    scroll-snap-align: start;
    scroll-snap-stop: always;
    min-height: 100%;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem 3rem 1.25rem 1.25rem;
    position: relative;
  }
  .intro-slide-inner {
    width: 100%;
    max-width: 1100px;
    max-height: 100%;
    overflow-y: auto;
  }
  .intro-slide.cards-slide {
    align-items: stretch;
    padding: 1rem 3.25rem 1rem 1rem;
  }
  .intro-slide.cards-slide .intro-slide-inner {
    max-width: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .intro-nav {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: auto;
  }
  .intro-nav-dot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 4px 0;
    font: inherit;
    text-align: right;
  }
  .intro-nav-dot span {
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #6a9090;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .intro-nav-dot:hover span,
  .intro-nav-dot.active span { opacity: 1; color: ${CRT.text}; }
  .intro-nav-dot i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid ${CRT.textDim};
    background: transparent;
    flex-shrink: 0;
    transition: transform 0.15s, background 0.15s;
  }
  .intro-nav-dot.active i {
    background: ${CRT.textSoft};
    border-color: ${CRT.text};
    box-shadow: 0 0 10px ${CRT.text}66;
    transform: scale(1.2);
  }
  .intro-resume-float {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    width: min(96%, 900px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 18px;
    border: 2px solid ${CRT.textDim};
    border-radius: 8px;
    background: #0d2828ee;
    box-shadow: 0 8px 24px #00000055;
  }
  .intro-resume-text {
    color: ${CRT.text};
    font-size: 20px;
    line-height: 1.35;
    min-width: 0;
  }
  .intro-resume-text strong { color: ${CRT.textSoft}; font-size: 22px; }
  .intro-resume-btn {
    flex-shrink: 0;
    padding: 8px 18px;
    border: 2px solid ${CRT.text};
    background: #133f3f;
    color: ${CRT.textSoft};
    font: inherit;
    font-size: 20px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .intro-resume-btn:hover { box-shadow: 0 0 14px ${CRT.text}44; }

  .intro-hero { text-align: center; }
  .intro-hero-logo {
    width: min(168px, 38vw);
    height: auto;
    margin: 0 auto 1.25rem;
    display: block;
    border-radius: 6px;
    box-shadow: 0 8px 32px #00000055;
  }
  .intro-hackathon {
    margin: 0 auto 1.5rem;
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    letter-spacing: -0.02em;
  }
  .intro-hackathon-title {
    margin: 0;
    color: #ececec;
    font-size: clamp(17px, 2.4vw, 22px);
    font-weight: 500;
    line-height: 1.35;
    text-transform: none;
    text-shadow: none;
  }
  .intro-hackathon-by {
    margin: 0.35rem 0 0;
    color: #9b9b9b;
    font-size: clamp(13px, 1.7vw, 15px);
    font-weight: 400;
    line-height: 1.3;
    text-transform: none;
  }
  .intro-kicker {
    display: inline-block;
    margin-bottom: 1rem;
    padding: 6px 16px;
    border: 2px solid ${CRT.textDim};
    color: ${CRT.text};
    font-size: 20px;
    letter-spacing: 4px;
    text-transform: uppercase;
  }
  .intro-hero h1 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(52px, 10vw, 96px);
    letter-spacing: 6px;
    line-height: 0.92;
    text-shadow: 0 0 28px #dfff3f55, 3px 3px 0 #0005;
    text-transform: uppercase;
  }
  .intro-tagline {
    margin: 1.25rem auto 0;
    max-width: 780px;
    color: ${CRT.textSoft};
    font-size: clamp(26px, 4vw, 38px);
    line-height: 1.25;
    letter-spacing: 1px;
  }
  .intro-lead {
    margin: 1.5rem auto 0;
    max-width: 820px;
    color: ${CRT.text};
    font-size: clamp(22px, 3vw, 28px);
    line-height: 1.45;
  }
  .intro-hero-actions {
    margin-top: 2rem;
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .intro-btn-primary {
    padding: 14px 32px;
    border: 3px solid ${CRT.text};
    background: linear-gradient(180deg, #1a5050, #133f3f);
    color: ${CRT.textSoft};
    font: inherit;
    font-size: clamp(26px, 4vw, 34px);
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 0 0 24px ${CRT.text}33;
    letter-spacing: 2px;
  }
  .intro-btn-primary:hover { color: #fff; box-shadow: 0 0 32px ${CRT.text}55; }
  .intro-btn-ghost {
    padding: 14px 24px;
    border: 2px solid #3a6868;
    background: transparent;
    color: ${CRT.textDim};
    font: inherit;
    font-size: clamp(22px, 3vw, 28px);
    text-transform: uppercase;
    cursor: pointer;
  }
  .intro-btn-ghost:hover { border-color: ${CRT.textDim}; color: ${CRT.text}; }
  .intro-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
    margin: 2.5rem 0 0;
    padding: 1.5rem 0;
    border-top: 2px solid #3a686866;
    border-bottom: 2px solid #3a686866;
  }
  .intro-stat { text-align: center; }
  .intro-stat-value {
    display: block;
    color: ${CRT.textSoft};
    font-size: clamp(40px, 6vw, 56px);
    line-height: 1;
    text-shadow: 0 0 16px #dfff3f44;
  }
  .intro-stat-label {
    display: block;
    margin-top: 8px;
    color: ${CRT.text};
    font-size: clamp(16px, 2vw, 20px);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .intro-manifesto h2 {
    margin: 0 0 1.5rem;
    color: ${CRT.textSoft};
    font-size: clamp(32px, 5vw, 48px);
    letter-spacing: 3px;
    line-height: 1.1;
    text-transform: uppercase;
    text-shadow: 0 0 14px #dfff3f44;
  }
  .intro-manifesto p {
    margin: 0 0 1.25rem;
    color: ${CRT.text};
    font-size: clamp(22px, 2.8vw, 28px);
    line-height: 1.5;
    max-width: 900px;
  }
  .intro-section-head { margin-bottom: 1.5rem; text-align: center; }
  .intro-section-head h2 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(36px, 5.5vw, 52px);
    letter-spacing: 4px;
    text-transform: uppercase;
    text-shadow: 0 0 16px #dfff3f44;
  }
  .intro-section-head p {
    margin: 0.75rem 0 0;
    color: ${CRT.text};
    font-size: clamp(22px, 3vw, 28px);
    line-height: 1.35;
  }
  .intro-cards-grid {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: clamp(0.65rem, 1.5vw, 1.25rem);
  }
  .intro-showcase-card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    color: ${CRT.textDim};
  }
  .intro-showcase-card .card-frame {
    display: block;
    position: relative;
    overflow: hidden;
    width: 100%;
    border: 2px solid ${CRT.textDim};
    border-radius: 14px;
    background: #00000024;
    box-shadow: inset 0 0 18px #00000030;
    aspect-ratio: 0.72;
  }
  .intro-showcase-card.locked .card-frame,
  .intro-showcase-card.locked .card-copy {
    border-color: ${CRT.led};
    box-shadow: 0 0 14px ${CRT.led}33;
  }
  .intro-showcase-card .card-image {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    object-position: center;
    filter: saturate(0.85) contrast(1.05);
  }
  .intro-showcase-card.locked .card-image {
    filter: saturate(1) contrast(1.02);
  }
  .intro-showcase-card .card-state {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 3px 8px;
    border: 1px solid currentColor;
    background: #163f3fe6;
    color: ${CRT.text};
    font-size: clamp(12px, 1.2vw, 15px);
    text-transform: uppercase;
  }
  .intro-showcase-card.locked .card-state { color: ${CRT.led}; }
  .intro-showcase-card .card-copy {
    display: block;
    flex: 1;
    margin-top: 8px;
    min-height: 0;
    padding: 10px 12px 12px;
    border: 2px solid ${CRT.textDim};
    border-radius: 10px;
    background: #133f3fcc;
    box-shadow: inset 0 0 14px #00000028;
    text-transform: uppercase;
  }
  .intro-showcase-card .card-name {
    display: block;
    color: ${CRT.textSoft};
    font-size: clamp(22px, 2.4vw, 30px);
    line-height: 1;
    text-shadow: 0 0 9px #dfff3f66;
  }
  .intro-showcase-card .card-role {
    display: block;
    margin-top: 5px;
    color: ${CRT.text};
    font-size: clamp(16px, 1.6vw, 20px);
    letter-spacing: 1px;
  }
  .intro-showcase-card .card-blurb {
    display: block;
    margin-top: 8px;
    color: ${CRT.textSoft};
    font-size: clamp(14px, 1.35vw, 17px);
    line-height: 1.35;
    text-transform: none;
  }
  .intro-flow-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .intro-flow-item {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border: 2px solid #3a686866;
    border-radius: 8px;
    background: #0a2222aa;
  }
  .intro-flow-item .step-num {
    color: ${CRT.led};
    font-size: clamp(28px, 3.5vw, 36px);
    font-weight: bold;
    line-height: 1;
  }
  .intro-flow-item h3 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(22px, 3vw, 28px);
    text-transform: uppercase;
  }
  .intro-flow-item p {
    margin: 0.4rem 0 0;
    color: ${CRT.text};
    font-size: clamp(18px, 2.2vw, 22px);
    line-height: 1.4;
  }
  .intro-features-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  .intro-feature-block {
    padding: 1rem 1.25rem;
    border-left: 4px solid ${CRT.textDim};
    background: #08181899;
  }
  .intro-feature-block .tag {
    display: block;
    color: ${CRT.led};
    font-size: 16px;
    letter-spacing: 3px;
    margin-bottom: 6px;
  }
  .intro-feature-block h3 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(22px, 2.8vw, 26px);
    text-transform: uppercase;
  }
  .intro-feature-block p {
    margin: 0.5rem 0 0;
    color: ${CRT.text};
    font-size: clamp(17px, 2vw, 20px);
    line-height: 1.4;
  }
  .intro-final { text-align: center; }
  .intro-final h2 {
    margin: 0 0 1rem;
    color: ${CRT.textSoft};
    font-size: clamp(36px, 5vw, 52px);
    letter-spacing: 4px;
    text-transform: uppercase;
  }
  .intro-final p {
    margin: 0 auto 2rem;
    max-width: 700px;
    color: ${CRT.text};
    font-size: clamp(22px, 3vw, 28px);
    line-height: 1.4;
  }
  @media (max-width: 1000px) {
    .intro-cards-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 800px) {
    .intro-slide { padding-right: 2.5rem; }
    .intro-nav { right: 8px; }
    .intro-nav-dot span { display: none; }
    .intro-stats { grid-template-columns: repeat(2, 1fr); }
    .intro-features-grid { grid-template-columns: 1fr; }
    .intro-cards-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 520px) {
    .intro-cards-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
    .intro-slide.cards-slide { padding-right: 2rem; }
  }
`;

export default function IntroSite({ onLaunch, onResume, savedSession }) {
  const hasResume = Boolean(savedSession?.hasProgress);
  const promptPreview = savedSession?.prompt
    ? savedSession.prompt.slice(0, 56) + (savedSession.prompt.length > 56 ? "…" : "")
    : "";

  const scrollRef = useRef(null);
  const slideRefs = useRef([]);
  const wheelLock = useRef(false);
  const touchStart = useRef({ x: 0, y: 0, t: 0 });
  const [activeIndex, setActiveIndex] = useState(0);

  const goToSection = useCallback((index) => {
    const clamped = Math.max(0, Math.min(SECTION_META.length - 1, index));
    slideRefs.current[clamped]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveIndex(clamped);
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = slideRefs.current.indexOf(visible.target);
        if (index >= 0) setActiveIndex(index);
      },
      { root, threshold: [0.45, 0.6, 0.75] }
    );

    slideRefs.current.forEach((slide) => {
      if (slide) observer.observe(slide);
    });

    return () => observer.disconnect();
  }, []);

  const handleWheel = useCallback(
    (event) => {
      if (wheelLock.current) return;
      const delta = event.deltaY;
      if (Math.abs(delta) < 28) return;

      const slide = slideRefs.current[activeIndex];
      const inner = slide?.querySelector(".intro-slide-inner");
      if (inner && inner.scrollHeight > inner.clientHeight + 4) {
        const atTop = inner.scrollTop <= 0;
        const atBottom = inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 4;
        if (delta > 0 && !atBottom) return;
        if (delta < 0 && !atTop) return;
      }

      event.preventDefault();
      wheelLock.current = true;
      goToSection(activeIndex + (delta > 0 ? 1 : -1));
      window.setTimeout(() => {
        wheelLock.current = false;
      }, 700);
    },
    [activeIndex, goToSection]
  );

  const handleTouchStart = useCallback((event) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  }, []);

  const handleTouchEnd = useCallback(
    (event) => {
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStart.current.x;
      const dy = touch.clientY - touchStart.current.y;
      const dt = Date.now() - touchStart.current.t;
      if (dt > 600) return;

      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < 48) return;

      if (absY >= absX) {
        goToSection(activeIndex + (dy < 0 ? 1 : -1));
        return;
      }
      goToSection(activeIndex + (dx < 0 ? 1 : -1));
    },
    [activeIndex, goToSection]
  );

  const setSlideRef = (index) => (node) => {
    slideRefs.current[index] = node;
  };

  return (
    <div className="intro-shell">
      {hasResume ? (
        <div className="intro-resume-float">
          <p className="intro-resume-text">
            <strong>Session waiting</strong>
            {promptPreview ? <> — &ldquo;{promptPreview}&rdquo;</> : null}
          </p>
          <button type="button" className="intro-resume-btn" onClick={onResume}>
            Resume
          </button>
        </div>
      ) : null}

      <nav className="intro-nav" aria-label="Sections">
        {SECTION_META.map((section, index) => (
          <button
            key={section.id}
            type="button"
            className={`intro-nav-dot ${activeIndex === index ? "active" : ""}`}
            onClick={() => goToSection(index)}
            aria-label={`Go to ${section.label}`}
            aria-current={activeIndex === index ? "true" : undefined}
          >
            <span>{section.label}</span>
            <i />
          </button>
        ))}
      </nav>

      <div
        className="intro-site crt-scroll"
        ref={scrollRef}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <section className="intro-slide" id="hero" ref={setSlideRef(0)}>
          <div className="intro-slide-inner intro-hero">
            <img className="intro-hero-logo" src="/crt.jpg" alt="Open IDE on CRT" width={168} height={168} />
            <div className="intro-hackathon">
              <p className="intro-hackathon-title">Built at the Codex Community Hackathon</p>
              <p className="intro-hackathon-by">by Imaad</p>
            </div>
            <h1>Open IDE</h1>
            <p className="intro-tagline">The CRT-native coding swarm that plans before it spends.</p>
            <p className="intro-lead">
              Connect a repo. Describe what you want built. Altbot hyperreasons across three
              architectural branches, picks a winner, and deploys specialized agents into a live
              workspace — every file saved, runnable, and pushable.
            </p>
            <div className="intro-hero-actions">
              <button type="button" className="intro-btn-primary" onClick={onLaunch}>
                Start building
              </button>
              {hasResume ? (
                <button type="button" className="intro-btn-ghost" onClick={onResume}>
                  Resume session
                </button>
              ) : null}
            </div>
            <div className="intro-stats">
              {INTRO_STATS.map((stat) => (
                <div key={stat.label} className="intro-stat">
                  <span className="intro-stat-value">{stat.value}</span>
                  <span className="intro-stat-label">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="manifesto" ref={setSlideRef(1)}>
          <div className="intro-slide-inner intro-manifesto">
            <h2>{INTRO_MANIFESTO.headline}</h2>
            {INTRO_MANIFESTO.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section className="intro-slide cards-slide" id="cards" ref={setSlideRef(2)}>
          <div className="intro-slide-inner">
            <div className="intro-section-head">
              <h2>The cards</h2>
              <p>Four agents. One controller. Each card owns a lane in the swarm.</p>
            </div>
            <div className="intro-cards-grid">
              {AGENT_CARDS.map((card) => (
                <article
                  key={card.name}
                  className={`intro-showcase-card ${card.locked ? "locked" : ""}`}
                >
                  <span className="card-frame">
                    <img className="card-image" src={card.image} alt="" />
                    <span className="card-state">{card.locked ? "Controller" : card.role}</span>
                  </span>
                  <span className="card-copy">
                    <span className="card-name">{card.name}</span>
                    <span className="card-role">{card.role}</span>
                    <span className="card-blurb">{card.introBlurb}</span>
                  </span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="flow" ref={setSlideRef(3)}>
          <div className="intro-slide-inner">
            <div className="intro-section-head">
              <h2>How it works</h2>
              <p>Five steps from repo to shipped code. No black box.</p>
            </div>
            <div className="intro-flow-list">
              {INTRO_FLOW.map((item) => (
                <article key={item.step} className="intro-flow-item">
                  <span className="step-num">{item.step}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="features" ref={setSlideRef(4)}>
          <div className="intro-slide-inner">
            <div className="intro-section-head">
              <h2>What you get</h2>
              <p>Everything inside the monitor — built for real builds.</p>
            </div>
            <div className="intro-features-grid">
              {INTRO_FEATURES.map((feature) => (
                <article key={feature.tag} className="intro-feature-block">
                  <span className="tag">{feature.tag}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="launch" ref={setSlideRef(5)}>
          <div className="intro-slide-inner intro-final">
            <h2>Enter the CRT</h2>
            <p>
              Your repo is waiting. Your swarm is ready. Hyperreason first — then let the agents
              write.
            </p>
            <button type="button" className="intro-btn-primary" onClick={onLaunch}>
              Launch Open IDE
            </button>
          </div>
        </section>
      </div>

    </div>
  );
}
