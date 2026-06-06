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

const TAGLINE_VERBS = ["plans", "writes", "ships", "hyperreasons"];

function HeroParticles() {
  const dots = useRef(
    Array.from({ length: 18 }, (_, i) => ({
      id: i,
      left: `${8 + ((i * 17) % 84)}%`,
      top: `${6 + ((i * 23) % 88)}%`,
      size: 2 + (i % 3),
      delay: `${(i * 0.37) % 4}s`,
      duration: `${4 + (i % 5)}s`,
    }))
  ).current;

  return (
    <div className="intro-hero-bg" aria-hidden>
      <div className="intro-hero-grid" />
      <div className="intro-hero-scan" />
      {dots.map((dot) => (
        <span
          key={dot.id}
          className="intro-hero-dot"
          style={{
            left: dot.left,
            top: dot.top,
            width: dot.size,
            height: dot.size,
            animationDelay: dot.delay,
            animationDuration: dot.duration,
          }}
        />
      ))}
    </div>
  );
}

function CyclingTagline() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIndex((current) => (current + 1) % TAGLINE_VERBS.length);
        setVisible(true);
      }, 280);
    }, 2600);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="intro-tagline">
      The CRT-native coding swarm that{" "}
      <span className={`intro-tagline-verb ${visible ? "in" : "out"}`}>{TAGLINE_VERBS[index]}</span>{" "}
      before it spends.
    </p>
  );
}

function AnimatedStat({ stat }) {
  return (
    <div className="intro-stat">
      <span className="intro-stat-value">{stat.value}</span>
      <span className="intro-stat-label">{stat.label}</span>
    </div>
  );
}

function RevealBlock({ children, className = "", delay = 0, as: Tag = "div" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`intro-reveal ${visible ? "visible" : ""} ${className}`.trim()}
      style={{ transitionDelay: `${delay}s` }}
    >
      {children}
    </Tag>
  );
}

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
    padding: 0.5rem 2.75rem 0.5rem 0.75rem;
    position: relative;
    overflow: hidden;
  }
  .intro-slide-inner {
    width: 100%;
    max-width: 920px;
    height: 100%;
    max-height: 100%;
    overflow: hidden;
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin: 0 auto;
  }
  .intro-slide.cards-slide {
    align-items: stretch;
    padding: 1rem 3.25rem 1rem 1rem;
  }
  .intro-slide.cards-slide .intro-slide-inner {
    max-width: none;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow-y: auto;
  }
  .intro-slide.cards-slide .intro-section-head h2 {
    font-size: clamp(36px, 5.5vw, 52px);
    letter-spacing: 4px;
  }
  .intro-slide.cards-slide .intro-section-head p {
    font-size: clamp(22px, 3vw, 28px);
    margin-top: 0.75rem;
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
    transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .intro-nav-dot.active i {
    background: ${CRT.textSoft};
    border-color: ${CRT.text};
    box-shadow: 0 0 10px ${CRT.text}66;
    transform: scale(1.2);
    animation: intro-nav-pulse 2s ease-in-out infinite;
  }
  @keyframes intro-nav-pulse {
    0%, 100% { box-shadow: 0 0 10px ${CRT.text}66; }
    50% { box-shadow: 0 0 18px ${CRT.text}aa; }
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
    animation: intro-slide-down 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes intro-slide-down {
    from { opacity: 0; transform: translateX(-50%) translateY(-16px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
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

  .intro-reveal {
    opacity: 0;
    transform: translateY(28px);
    transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .intro-reveal.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .intro-hero {
    text-align: center;
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(0.35rem, 1.2vh, 0.75rem);
    padding: 0.25rem 0;
  }
  .intro-hero-bg {
    position: absolute;
    inset: -20% -10%;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }
  .intro-hero-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(${CRT.text}08 1px, transparent 1px),
      linear-gradient(90deg, ${CRT.text}08 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, #000 20%, transparent 75%);
    animation: intro-grid-drift 24s linear infinite;
  }
  @keyframes intro-grid-drift {
    from { transform: perspective(400px) rotateX(8deg) translateY(0); }
    to { transform: perspective(400px) rotateX(8deg) translateY(48px); }
  }
  .intro-hero-scan {
    position: absolute;
    left: 0;
    right: 0;
    height: 120px;
    background: linear-gradient(180deg, transparent, ${CRT.text}12, transparent);
    animation: intro-scan-sweep 6s ease-in-out infinite;
  }
  @keyframes intro-scan-sweep {
    0% { top: -120px; opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 1; }
    100% { top: 100%; opacity: 0; }
  }
  .intro-hero-dot {
    position: absolute;
    border-radius: 50%;
    background: ${CRT.textSoft};
    box-shadow: 0 0 8px ${CRT.text}88;
    animation: intro-dot-float ease-in-out infinite;
    opacity: 0.35;
  }
  @keyframes intro-dot-float {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.2; }
    50% { transform: translate(6px, -14px) scale(1.4); opacity: 0.55; }
  }

  .intro-hero-logo-wrap {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    flex-shrink: 0;
  }
  .intro-hero-logo-wrap::before {
    content: "";
    position: absolute;
    inset: -12%;
    border-radius: 50%;
    background: radial-gradient(circle, ${CRT.text}22 0%, transparent 70%);
    z-index: -1;
    pointer-events: none;
  }
  .intro-hero-logo {
    width: clamp(72px, 14vh, 112px);
    height: clamp(72px, 14vh, 112px);
    object-fit: cover;
    display: block;
    border-radius: 6px;
    box-shadow: 0 6px 24px #00000055, 0 0 24px ${CRT.text}18;
  }

  .intro-hero h1 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(36px, 7.5vh, 68px);
    letter-spacing: clamp(3px, 0.8vw, 6px);
    line-height: 0.95;
    text-shadow: 0 0 20px #dfff3f44, 2px 2px 0 #0005;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .intro-tagline {
    margin: 0;
    max-width: min(680px, 92vw);
    color: ${CRT.textSoft};
    font-size: clamp(16px, 2.6vh, 24px);
    line-height: 1.25;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .intro-tagline-verb {
    display: inline-block;
    color: ${CRT.text};
    text-shadow: 0 0 12px ${CRT.text}44;
    min-width: 9.5ch;
    text-align: center;
    transition: opacity 0.28s ease;
  }
  .intro-tagline-verb.in { opacity: 1; }
  .intro-tagline-verb.out { opacity: 0; }

  .intro-lead {
    margin: 0;
    max-width: min(640px, 92vw);
    color: ${CRT.text};
    font-size: clamp(13px, 1.9vh, 17px);
    line-height: 1.4;
    flex-shrink: 1;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .intro-hero-actions {
    margin: 0;
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .intro-btn-primary {
    padding: 10px 22px;
    border: 2px solid ${CRT.text};
    background: linear-gradient(180deg, #1a5050, #133f3f);
    color: ${CRT.textSoft};
    font: inherit;
    font-size: clamp(16px, 2.4vh, 22px);
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 0 0 16px ${CRT.text}28;
    letter-spacing: 1px;
    position: relative;
    overflow: hidden;
    transition: color 0.2s, box-shadow 0.2s;
  }
  @keyframes intro-btn-pulse {
    0%, 100% { box-shadow: 0 0 16px ${CRT.text}28; }
    50% { box-shadow: 0 0 24px ${CRT.text}44; }
  }
  .intro-btn-primary::after {
    display: none;
  }
  .intro-btn-primary:hover {
    color: #fff;
    box-shadow: 0 0 28px ${CRT.text}55;
  }
  .intro-btn-ghost {
    padding: 10px 18px;
    border: 2px solid #3a6868;
    background: transparent;
    color: ${CRT.textDim};
    font: inherit;
    font-size: clamp(14px, 2vh, 18px);
    text-transform: uppercase;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
  }
  .intro-btn-ghost:hover {
    border-color: ${CRT.textDim};
    color: ${CRT.text};
  }
  .intro-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
    margin: 0;
    padding: clamp(0.4rem, 1vh, 0.65rem) 0 0;
    border-top: 1px solid #3a686866;
    width: 100%;
    max-width: min(720px, 96vw);
    flex-shrink: 0;
  }
  .intro-stat { text-align: center; min-width: 0; }
  .intro-stat-value {
    display: block;
    color: ${CRT.textSoft};
    font-size: clamp(22px, 3.5vh, 34px);
    line-height: 1;
    text-shadow: 0 0 10px #dfff3f33;
    white-space: nowrap;
  }
  .intro-stat-label {
    display: block;
    margin-top: 4px;
    color: ${CRT.text};
    font-size: clamp(10px, 1.4vh, 13px);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .intro-manifesto {
    width: 100%;
    text-align: center;
    overflow: hidden;
  }
  .intro-manifesto h2 {
    margin: 0 0 clamp(0.5rem, 1.5vh, 1rem);
    color: ${CRT.textSoft};
    font-size: clamp(22px, 4vh, 36px);
    letter-spacing: 2px;
    line-height: 1.1;
    text-transform: uppercase;
    text-shadow: 0 0 10px #dfff3f33;
  }
  .intro-manifesto p {
    margin: 0 0 clamp(0.35rem, 1vh, 0.65rem);
    color: ${CRT.text};
    font-size: clamp(12px, 1.8vh, 16px);
    line-height: 1.45;
    max-width: 100%;
    text-align: center;
  }
  .intro-section-head {
    margin-bottom: clamp(0.35rem, 1vh, 0.65rem);
    text-align: center;
    width: 100%;
    flex-shrink: 0;
  }
  .intro-section-head h2 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(22px, 4vh, 34px);
    letter-spacing: 2px;
    text-transform: uppercase;
    text-shadow: 0 0 10px #dfff3f33;
  }
  .intro-section-head p {
    margin: 0.35rem 0 0;
    color: ${CRT.text};
    font-size: clamp(12px, 1.8vh, 16px);
    line-height: 1.3;
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
    transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .intro-showcase-card:hover {
    transform: translateY(-8px) scale(1.02);
    z-index: 2;
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
    transition: border-color 0.3s, box-shadow 0.3s;
  }
  .intro-showcase-card:hover .card-frame {
    border-color: ${CRT.text};
    box-shadow: inset 0 0 18px #00000030, 0 0 24px ${CRT.text}33;
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
    transition: transform 0.5s ease, filter 0.3s;
  }
  .intro-showcase-card:hover .card-image {
    transform: scale(1.06);
    filter: saturate(1) contrast(1.08);
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
    transition: border-color 0.3s, background 0.3s;
  }
  .intro-showcase-card:hover .card-copy {
    border-color: ${CRT.textDim};
    background: #1a5050dd;
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
  .intro-flow-list {
    display: flex;
    flex-direction: column;
    gap: clamp(0.3rem, 0.7vh, 0.5rem);
    width: 100%;
    overflow: hidden;
    flex: 1;
    min-height: 0;
    justify-content: center;
  }
  .intro-flow-item {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 0.65rem;
    padding: clamp(0.4rem, 1vh, 0.65rem) 0.75rem;
    border: 1px solid #3a686866;
    border-radius: 6px;
    background: #0a2222aa;
  }
  .intro-flow-item:hover {
    transform: none;
    box-shadow: none;
  }
  .intro-flow-item .step-num {
    color: ${CRT.led};
    font-size: clamp(18px, 2.8vh, 24px);
    font-weight: bold;
    line-height: 1;
  }
  .intro-flow-item h3 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(13px, 2vh, 17px);
    text-transform: uppercase;
  }
  .intro-flow-item p {
    margin: 0.2rem 0 0;
    color: ${CRT.text};
    font-size: clamp(11px, 1.5vh, 14px);
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .intro-features-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(0.35rem, 0.8vh, 0.55rem);
    width: 100%;
    overflow: hidden;
    flex: 1;
    min-height: 0;
    align-content: center;
  }
  .intro-feature-block {
    padding: clamp(0.4rem, 1vh, 0.65rem) 0.75rem;
    border-left: 3px solid ${CRT.textDim};
    background: #08181899;
    overflow: hidden;
  }
  .intro-feature-block:hover {
    transform: none;
  }
  .intro-feature-block .tag {
    display: block;
    color: ${CRT.led};
    font-size: clamp(10px, 1.3vh, 12px);
    letter-spacing: 2px;
    margin-bottom: 3px;
  }
  .intro-feature-block h3 {
    margin: 0;
    color: ${CRT.textSoft};
    font-size: clamp(13px, 2vh, 16px);
    text-transform: uppercase;
  }
  .intro-feature-block p {
    margin: 0.25rem 0 0;
    color: ${CRT.text};
    font-size: clamp(11px, 1.5vh, 13px);
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .intro-final {
    text-align: center;
    width: 100%;
  }
  .intro-final h2 {
    margin: 0 0 0.65rem;
    color: ${CRT.textSoft};
    font-size: clamp(24px, 4.5vh, 38px);
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .intro-final p {
    margin: 0 auto 1rem;
    max-width: min(560px, 92vw);
    color: ${CRT.text};
    font-size: clamp(13px, 2vh, 17px);
    line-height: 1.4;
  }
  .intro-final .intro-btn-primary {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .intro-reveal,
    .intro-hero-grid,
    .intro-hero-scan,
    .intro-hero-dot,
    .intro-nav-dot.active i {
      animation: none !important;
      transition: none !important;
    }
    .intro-reveal { opacity: 1; transform: none; }
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
          <HeroParticles />
          <div className="intro-slide-inner intro-hero">
            <div className="intro-hero-logo-wrap">
              <img className="intro-hero-logo" src="/crt.jpg" alt="Open IDE on CRT" width={112} height={112} />
            </div>
            <h1>Open IDE</h1>
            <CyclingTagline />
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
                <AnimatedStat key={stat.label} stat={stat} />
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="manifesto" ref={setSlideRef(1)}>
          <div className="intro-slide-inner intro-manifesto">
            <RevealBlock as="h2">{INTRO_MANIFESTO.headline}</RevealBlock>
            {INTRO_MANIFESTO.paragraphs.map((paragraph, index) => (
              <RevealBlock as="p" key={paragraph.slice(0, 24)} delay={0.08 * (index + 1)}>
                {paragraph}
              </RevealBlock>
            ))}
          </div>
        </section>

        <section className="intro-slide cards-slide" id="cards" ref={setSlideRef(2)}>
          <div className="intro-slide-inner">
            <RevealBlock className="intro-section-head">
              <h2>The cards</h2>
              <p>Four agents. One controller. Each card owns a lane in the swarm.</p>
            </RevealBlock>
            <div className="intro-cards-grid">
              {AGENT_CARDS.map((card, index) => (
                <RevealBlock
                  key={card.name}
                  as="article"
                  className={`intro-showcase-card ${card.locked ? "locked" : ""}`}
                  delay={0.1 * index}
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
                </RevealBlock>
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="flow" ref={setSlideRef(3)}>
          <div className="intro-slide-inner">
            <RevealBlock className="intro-section-head">
              <h2>How it works</h2>
              <p>Five steps from repo to shipped code. No black box.</p>
            </RevealBlock>
            <div className="intro-flow-list">
              {INTRO_FLOW.map((item, index) => (
                <RevealBlock key={item.step} as="article" className="intro-flow-item" delay={0.08 * index}>
                  <span className="step-num">{item.step}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                </RevealBlock>
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="features" ref={setSlideRef(4)}>
          <div className="intro-slide-inner">
            <RevealBlock className="intro-section-head">
              <h2>What you get</h2>
              <p>Everything inside the monitor — built for real builds.</p>
            </RevealBlock>
            <div className="intro-features-grid">
              {INTRO_FEATURES.map((feature, index) => (
                <RevealBlock key={feature.tag} as="article" className="intro-feature-block" delay={0.07 * index}>
                  <span className="tag">{feature.tag}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </RevealBlock>
              ))}
            </div>
          </div>
        </section>

        <section className="intro-slide" id="launch" ref={setSlideRef(5)}>
          <div className="intro-slide-inner intro-final">
            <RevealBlock as="h2">Enter the CRT</RevealBlock>
            <RevealBlock as="p" delay={0.1}>
              Your repo is waiting. Your swarm is ready. Hyperreason first — then let the agents
              write.
            </RevealBlock>
            <RevealBlock delay={0.2}>
              <button type="button" className="intro-btn-primary" onClick={onLaunch}>
                Launch Open IDE
              </button>
            </RevealBlock>
          </div>
        </section>
      </div>
    </div>
  );
}
