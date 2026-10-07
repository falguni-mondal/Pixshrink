"use client";

// Doodle cat with a coffee cup. Pure SVG, no image files.
// Style: thick dark outline, flat fill in the site accent color (var(--accent)), simple
// face with whiskers, a curled tail and little toe lines, like a hand-drawn sticker.
//
// Always-on (CSS, subtle): tail swing, breathing, blink, head bob, an occasional head tilt
// and whisker twitch, cup steam. All of it pauses when the cat is off-screen and stops
// with reduced motion.
//
// Interactive (GSAP):
//   - eyes follow the mouse over `watchRef` (the whole card), desktop only
//   - click / tap / Enter / Space on the cat: jump, purr shiver, hearts (more on combos)
//   - `mood` 0..3: small smile -> bigger smile + blush -> happy closed eyes + open smile
//     -> bigger open smile (hearts burst whenever the mood goes up)
//   - `holdSign`: the cat holds up a "scan me" sign
//   - ref.tapAt(element, onHit): a paw reaches toward the element and taps it
//
// The SVG has overflow visible so the paw can reach past the scene toward the chips. Give
// the cat's wrapper `relative z-10` in the card so the paw draws above them.

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/device";

const VB_W = 320;
const VB_H = 240;
const EYE_X = 149; // between the eyes, for pointer tracking
const EYE_Y = 92;
const ARM_X = 170; // paw shoulder
const ARM_Y = 158;
const ARM_LEN = 104; // drawn length of the paw arm
const ARM_MAX_REACH = 150; // the arm never stretches past this
const MAX_HEARTS_ON_SCREEN = 24;

// Palette: one outline color, one fill (the site accent), a few small details.
const INK = "#111111";
const FILL = "var(--accent)";
const BLUSH_COLOR = "#FF8A8A";
const TONGUE = "#F27B8A";
const HEART = "#F0627A";
const HEART_PATH = "M0 4 C-7 -1 -8 -8 -4 -8 C-2 -8 0 -6.5 0 -5.5 C0 -6.5 2 -8 4 -8 C8 -8 7 -1 0 4Z";

const BLUSH = [0, 0.45, 0.6, 0.75];

const MOUTH_LINES = [
  "M149 109 V112 M149 112 Q144 118 138 113 M149 112 Q154 118 160 113",
  "M149 109 V112 M149 112 Q143 121 135 114 M149 112 Q155 121 163 114",
  "M149 109 V112",
  "M149 109 V112",
];

const CAT_CSS = `
.dc svg{overflow:visible}
@keyframes dc-tail{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg)}}
@keyframes dc-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.015,1.026)}}
@keyframes dc-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.4px)}}
@keyframes dc-tilt{0%,84%,100%{transform:rotate(0)}89%{transform:rotate(-3.5deg)}94%{transform:rotate(2deg)}97%{transform:rotate(0)}}
@keyframes dc-blink{0%,92%,100%{transform:scaleY(1)}94%{transform:scaleY(.08)}96%{transform:scaleY(1)}}
@keyframes dc-whisk{0%,86%,100%{transform:rotate(0)}89%{transform:rotate(4deg)}92%{transform:rotate(-3deg)}95%{transform:rotate(2deg)}}
@keyframes dc-steam{0%{opacity:0;transform:translateY(8px)}30%{opacity:.8}100%{opacity:0;transform:translateY(-18px)}}
.dc-tail{transform-origin:92px 210px;animation:dc-tail 4.6s ease-in-out infinite}
.dc-breathe{transform-origin:150px 220px;animation:dc-breathe 4.2s ease-in-out infinite}
.dc-head{animation:dc-bob 4.2s ease-in-out infinite}
.dc-tilt{transform-origin:149px 134px;animation:dc-tilt 9s ease-in-out infinite}
.dc-blink{transform-origin:149px ${EYE_Y}px;animation:dc-blink 5.4s ease-in-out infinite}
.dc-whisk-l{transform-origin:102px 103px;animation:dc-whisk 8s ease-in-out infinite}
.dc-whisk-r{transform-origin:196px 103px;animation:dc-whisk 8s ease-in-out 3s infinite}
.dc-steam{animation:dc-steam 3.2s ease-in-out infinite;opacity:0}
.dc[data-paused="true"] *{animation-play-state:paused}
.dc-blush{transition:opacity .35s ease}
.dc-pet{cursor:pointer;outline:none}
.dc-pet:focus-visible{outline:3px solid #111;outline-offset:3px}
.dc-cup{cursor:pointer;transition:transform .2s ease;outline:none}
.dc-cup:hover{transform:translateY(-3px)}
.dc-cup-ring{opacity:0}
.dc-cup:focus-visible .dc-cup-ring{opacity:1}
@media (prefers-reduced-motion:reduce){.dc *{animation:none!important}.dc-steam{opacity:.5}.dc-cup{transition:none}.dc-cup:hover{transform:none}}
`;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * @param {{ mood?: 0|1|2|3, holdSign?: boolean, onCupClick?: () => void,
 *           watchRef?: React.RefObject<HTMLElement>, className?: string }} props
 *   mood: 0 small smile ... 3 happy closed eyes (use moodForAmount from lib/donate).
 *   holdSign: the cat holds up a "scan me" sign.
 *   onCupClick: makes the cup a button (for example, open Buy Me a Coffee).
 *   watchRef: element whose pointer movement the eyes follow (default: the cat itself).
 * Ref handle: { tapAt(element, onHit?), pet() }
 */
const DonateCat = forwardRef(function DonateCat(
  { mood = 0, holdSign = false, onCupClick, watchRef, className = "" },
  ref,
) {
  const level = clamp(Math.round(Number(mood) || 0), 0, 3);

  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const jumpRef = useRef(null);
  const shiverRef = useRef(null);
  const pupilsRef = useRef(null);
  const heartsRef = useRef(null);
  const signRef = useRef(null);
  const armRef = useRef(null);
  const armTlRef = useRef(null);

  const levelRef = useRef(level);
  levelRef.current = level;
  const prevLevelRef = useRef(level);
  const comboRef = useRef(0);
  const lastPetRef = useRef(0);

  /* ------------------------------- hearts ------------------------------- */

  const spawnHearts = useCallback((count) => {
    const layer = heartsRef.current;
    if (!layer) return;
    const reduced = prefersReducedMotion();

    for (let i = 0; i < count; i++) {
      if (layer.childElementCount >= MAX_HEARTS_ON_SCREEN) return;
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", HEART_PATH);
      el.setAttribute("fill", HEART);
      el.setAttribute("stroke", INK);
      el.setAttribute("stroke-width", "1.6");
      el.setAttribute("stroke-linejoin", "round");
      layer.appendChild(el);

      const x = EYE_X + (Math.random() - 0.5) * 70;
      const y = 50 + Math.random() * 14;
      const size = 0.8 + Math.random() * 0.6;
      const tl = gsap.timeline({ onComplete: () => el.remove() });

      if (reduced) {
        // Cat stays still: the heart just fades in and out in place.
        tl.set(el, { x, y: y - 24, scale: size, opacity: 0, transformOrigin: "50% 50%" })
          .to(el, { opacity: 1, duration: 0.3 })
          .to(el, { opacity: 0, duration: 0.9 });
      } else {
        tl.set(el, { x, y, scale: 0.3, opacity: 0, transformOrigin: "50% 50%" }, i * 0.07)
          .to(el, { opacity: 1, scale: size, duration: 0.2, ease: "back.out(2)" })
          .to(
            el,
            {
              x: x + (Math.random() - 0.5) * 44,
              y: y - 52 - Math.random() * 26,
              duration: 1.4,
              ease: "power1.out",
            },
            "<0.05",
          )
          .to(el, { opacity: 0, duration: 0.5, ease: "power1.in" }, "-=0.55");
      }
    }
  }, []);

  /* --------------------------------- pet --------------------------------- */

  const pet = useCallback(() => {
    const now = performance.now();
    comboRef.current = now - lastPetRef.current < 1800 ? comboRef.current + 1 : 1;
    lastPetRef.current = now;

    // More clicks in a row (and a higher mood) make more hearts.
    const count = Math.min(
      1 + Math.floor(comboRef.current / 2) + (levelRef.current >= 3 ? 1 : 0),
      6,
    );
    spawnHearts(count);

    if (prefersReducedMotion()) return;
    const jump = jumpRef.current;
    const shiver = shiverRef.current;
    if (!jump || !shiver) return;

    gsap.killTweensOf([jump, shiver]);
    gsap
      .timeline()
      .to(jump, { y: -16, duration: 0.17, ease: "power2.out" })
      .to(jump, { y: 0, duration: 0.4, ease: "bounce.out" });
    gsap.fromTo(
      shiver,
      { x: -0.9 },
      {
        x: 0.9,
        duration: 0.045,
        repeat: 11,
        yoyo: true,
        ease: "none",
        onComplete: () => gsap.set(shiver, { x: 0 }),
      },
    );
  }, [spawnHearts]);

  /* ---------------------------- paw tap (handle) ---------------------------- */

  const tapAt = useCallback((target, onHit) => {
    const arm = armRef.current;
    const svg = svgRef.current;
    if (!arm || !svg || !target || prefersReducedMotion()) {
      onHit?.(); // no paw, but the chip still gets its reaction
      return;
    }

    const box = svg.getBoundingClientRect();
    const unit = box.width / VB_W || 1;
    const t = target.getBoundingClientRect();
    const dx = (t.left + t.width / 2 - box.left) / unit - ARM_X;
    const dy = (t.top + t.height / 2 - box.top) / unit - ARM_Y;

    // 0 deg = straight down; positive GSAP rotation turns clockwise (toward the left).
    const angle = clamp((-Math.atan2(dx, Math.max(dy, 12)) * 180) / Math.PI, -75, 75);
    const reach = clamp(Math.hypot(dx, dy), 30, ARM_MAX_REACH) / ARM_LEN;

    armTlRef.current?.kill();
    gsap.set(arm, { svgOrigin: `${ARM_X} ${ARM_Y}`, rotation: angle, scaleY: 0.2, opacity: 0 });
    armTlRef.current = gsap
      .timeline()
      .to(arm, { opacity: 1, scaleY: reach, duration: 0.16, ease: "power2.out" })
      .add(() => onHit?.())
      .to(arm, { scaleY: reach * 0.9, duration: 0.07, yoyo: true, repeat: 1, ease: "power1.inOut" })
      .to(arm, { scaleY: 0.2, opacity: 0, duration: 0.18, ease: "power2.in" });
  }, []);

  useImperativeHandle(ref, () => ({ tapAt, pet }), [tapAt, pet]);

  /* ------------------------------- effects ------------------------------- */

  // Pause the looping CSS animations while off-screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      el.dataset.paused = entry.isIntersecting ? "false" : "true";
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Eyes follow the mouse (desktop only).
  useEffect(() => {
    const host = watchRef?.current || rootRef.current;
    const pupils = pupilsRef.current;
    if (!host || !pupils || prefersReducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const xTo = gsap.quickTo(pupils, "x", { duration: 0.3, ease: "power3.out" });
    const yTo = gsap.quickTo(pupils, "y", { duration: 0.3, ease: "power3.out" });

    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      const svg = svgRef.current;
      if (!svg) return;
      const box = svg.getBoundingClientRect();
      const cx = box.left + (EYE_X / VB_W) * box.width;
      const cy = box.top + (EYE_Y / VB_H) * box.height;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const strength = Math.min(1, dist / 180); // looks straight ahead when the pointer is close
      xTo((dx / dist) * 3.2 * strength);
      yTo((dy / dist) * 2.6 * strength);
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
    };

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      gsap.killTweensOf(pupils);
      gsap.set(pupils, { clearProps: "transform" });
    };
  }, [watchRef]);

  // A higher mood makes the cat happier: a burst of hearts.
  useEffect(() => {
    if (level > prevLevelRef.current) spawnHearts(level + 1);
    prevLevelRef.current = level;
  }, [level, spawnHearts]);

  // The sign slides up when holdSign turns on.
  useEffect(() => {
    const el = signRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: holdSign ? 1 : 0, y: 0 });
      return;
    }
    const tween = gsap.to(
      el,
      holdSign
        ? { opacity: 1, y: 0, duration: 0.45, ease: "back.out(1.6)" }
        : { opacity: 0, y: 34, duration: 0.25, ease: "power2.in" },
    );
    return () => tween.kill();
  }, [holdSign]);

  // Clean up everything on unmount.
  useEffect(() => {
    const hearts = heartsRef.current;
    return () => {
      armTlRef.current?.kill();
      gsap.killTweensOf([
        jumpRef.current,
        shiverRef.current,
        pupilsRef.current,
        armRef.current,
        signRef.current,
      ]);
      if (hearts) {
        gsap.killTweensOf(Array.from(hearts.children));
        hearts.replaceChildren();
      }
    };
  }, []);

  const onPetKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pet();
    }
  };
  const onCupKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCupClick?.();
    }
  };

  const cupProps = onCupClick
    ? {
        role: "button",
        tabIndex: 0,
        "aria-label": "Buy me a coffee",
        onClick: onCupClick,
        onKeyDown: onCupKey,
        className: "dc-cup",
      }
    : {};

  const happyEyes = level >= 2;

  return (
    <div ref={rootRef} data-paused="false" className={`dc w-full ${className}`}>
      <style>{CAT_CSS}</style>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="group"
        aria-label="A doodle cat sitting next to a cup of coffee"
        className="block h-auto w-full"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* ground shadow */}
        <ellipse cx="150" cy="222" rx="84" ry="8" fill={INK} opacity="0.1" />

        <g ref={jumpRef}>
          <g ref={shiverRef}>
            <g
              className="dc-pet"
              role="button"
              tabIndex={0}
              aria-label="Pet the cat"
              onClick={pet}
              onKeyDown={onPetKey}
            >
              {/* tail: outlined tube (dark stroke under, accent stroke on top) */}
              <g className="dc-tail" fill="none">
                <path d="M92 210 C56 216 38 190 44 162 C48 144 60 136 70 140" stroke={INK} strokeWidth="18" />
                <path d="M92 210 C56 216 38 190 44 162 C48 144 60 136 70 140" stroke={FILL} strokeWidth="11" />
              </g>

              {/* body */}
              <g className="dc-breathe" stroke={INK} strokeWidth="3.6">
                <path
                  d="M124 130 C112 144 110 160 111 178 C90 182 80 202 90 214 C96 220 108 220 118 220 L182 220 C196 220 206 214 206 200 C206 188 198 178 190 174 C184 160 168 144 166 132Z"
                  fill={FILL}
                />
                {/* front legs and haunch line */}
                <path d="M134 166 L132 210 M156 164 L158 210 M180 178 C172 186 170 198 172 212" fill="none" />
                {/* paws */}
                <ellipse cx="133" cy="214" rx="12" ry="7" fill={FILL} />
                <ellipse cx="160" cy="214" rx="12" ry="7" fill={FILL} />
                <path
                  d="M128 216 v-5 M134 217 v-6 M140 216 v-5 M155 216 v-5 M161 217 v-6 M167 216 v-5"
                  fill="none"
                  strokeWidth="2.4"
                />
              </g>

              {/* sign (shown with holdSign), drawn before the head so the chin overlaps it */}
              <g ref={signRef} style={{ opacity: 0 }} aria-hidden="true">
                <rect x="108" y="150" width="84" height="62" fill="#fff" stroke={INK} strokeWidth="3.4" />
                <rect x="114" y="156" width="14" height="14" fill={INK} />
                <rect x="118" y="160" width="6" height="6" fill="#fff" />
                <rect x="172" y="156" width="14" height="14" fill={INK} />
                <rect x="176" y="160" width="6" height="6" fill="#fff" />
                <rect x="114" y="190" width="14" height="14" fill={INK} />
                <rect x="118" y="194" width="6" height="6" fill="#fff" />
                <rect x="134" y="158" width="6" height="6" fill={INK} />
                <rect x="144" y="170" width="6" height="6" fill={INK} />
                <rect x="134" y="182" width="6" height="6" fill={INK} />
                <rect x="150" y="196" width="6" height="6" fill={INK} />
                <rect x="172" y="192" width="14" height="8" fill={FILL} stroke={INK} strokeWidth="2" />
                <ellipse cx="108" cy="152" rx="10" ry="8" fill={FILL} stroke={INK} strokeWidth="3" />
                <ellipse cx="192" cy="152" rx="10" ry="8" fill={FILL} stroke={INK} strokeWidth="3" />
              </g>

              {/* head */}
              <g className="dc-head">
                <g className="dc-tilt">
                  <path
                    d="M118 130 C98 124 90 100 98 82 C100 70 100 58 106 46 Q108 40 113 45 C120 52 128 60 134 64 C146 61 160 61 170 64 C176 56 186 40 192 32 Q197 28 199 34 C202 46 202 58 200 70 C208 86 208 106 192 122 C184 128 176 132 168 133 C150 138 134 136 118 130Z"
                    fill={FILL}
                    stroke={INK}
                    strokeWidth="3.6"
                  />

                  {/* blush */}
                  <ellipse className="dc-blush" cx="114" cy="106" rx="9" ry="5.5" fill={BLUSH_COLOR} style={{ opacity: BLUSH[level] }} />
                  <ellipse className="dc-blush" cx="184" cy="106" rx="9" ry="5.5" fill={BLUSH_COLOR} style={{ opacity: BLUSH[level] }} />

                  {/* eyes: the blink group wraps both looks so either can blink */}
                  <g className="dc-blink">
                    <g ref={pupilsRef} style={{ display: happyEyes ? "none" : undefined }}>
                      <ellipse cx="126" cy={EYE_Y} rx="4.6" ry="6.4" fill={INK} />
                      <ellipse cx="172" cy={EYE_Y} rx="4.6" ry="6.4" fill={INK} />
                      <circle cx="127.6" cy="89.4" r="1.6" fill="#fff" />
                      <circle cx="173.6" cy="89.4" r="1.6" fill="#fff" />
                    </g>
                    {happyEyes && (
                      <path d="M118 94 Q126 84 134 94 M164 94 Q172 84 180 94" stroke={INK} strokeWidth="3" fill="none" />
                    )}
                  </g>

                  {/* nose and mouth */}
                  <path d="M143 102 h12 l-6 7z" fill={INK} stroke={INK} strokeWidth="2" />
                  <path d={MOUTH_LINES[level]} stroke={INK} strokeWidth="2.4" fill="none" />
                  {level >= 2 && (
                    <path
                      d={level === 3 ? "M136 114 Q149 134 162 114 Q149 120 136 114Z" : "M139 114 Q149 128 159 114 Q149 119 139 114Z"}
                      fill={TONGUE}
                      stroke={INK}
                      strokeWidth="2.4"
                    />
                  )}

                  {/* whiskers */}
                  <g className="dc-whisk-l" stroke={INK} strokeWidth="2.4" fill="none">
                    <path d="M102 98 L74 94 M102 103 L76 104 M104 108 L80 116" />
                  </g>
                  <g className="dc-whisk-r" stroke={INK} strokeWidth="2.4" fill="none">
                    <path d="M196 98 L224 94 M196 103 L222 104 M194 108 L218 116" />
                  </g>
                </g>
              </g>

              {/* paw arm for chip taps: starts invisible, drawn at its real position */}
              <g ref={armRef} style={{ opacity: 0 }} aria-hidden="true">
                <path
                  d={`M${ARM_X - 10} ${ARM_Y} H${ARM_X + 10} V${ARM_Y + ARM_LEN - 14} Q${ARM_X + 10} ${ARM_Y + ARM_LEN} ${ARM_X} ${ARM_Y + ARM_LEN} Q${ARM_X - 10} ${ARM_Y + ARM_LEN} ${ARM_X - 10} ${ARM_Y + ARM_LEN - 14}Z`}
                  fill={FILL}
                  stroke={INK}
                  strokeWidth="3.4"
                />
                <ellipse cx={ARM_X} cy={ARM_Y + ARM_LEN - 6} rx="11" ry="9" fill={FILL} stroke={INK} strokeWidth="3.4" />
                <path
                  d={`M${ARM_X - 5} ${ARM_Y + ARM_LEN - 4} v-4 M${ARM_X} ${ARM_Y + ARM_LEN - 3} v-5 M${ARM_X + 5} ${ARM_Y + ARM_LEN - 4} v-4`}
                  stroke={INK}
                  strokeWidth="2"
                  fill="none"
                />
              </g>
            </g>
          </g>
        </g>

        {/* coffee cup: white cup with an accent sleeve, clickable when onCupClick is given */}
        <g {...cupProps}>
          <rect className="dc-cup-ring" x="212" y="116" width="94" height="110" rx="6" fill="none" stroke={INK} strokeWidth="3" strokeDasharray="5 4" />
          <ellipse cx="254" cy="216" rx="36" ry="6" fill="#fff" stroke={INK} strokeWidth="3.4" />
          <path d="M282 172 Q300 174 298 190 Q295 204 278 200" fill="none" stroke={INK} strokeWidth="3.6" />
          <path d="M226 160 H282 L276 208 Q275 214 269 214 H239 Q233 214 232 208Z" fill="#fff" stroke={INK} strokeWidth="3.6" />
          <path d="M228.5 177 H279.5 L277 196 H231Z" fill={FILL} stroke={INK} strokeWidth="2.6" />
          <ellipse cx="254" cy="160" rx="28" ry="5" fill="#8A5A2B" stroke={INK} strokeWidth="3" />
          <g fill="none" stroke="#9A9A9A" strokeWidth="3">
            <path className="dc-steam" d="M246 148 C240 140 252 134 246 124" />
            <path className="dc-steam" style={{ animationDelay: "1s" }} d="M256 146 C250 138 262 130 256 118" />
            <path className="dc-steam" style={{ animationDelay: "2s" }} d="M266 148 C260 141 272 135 266 126" />
          </g>
        </g>

        {/* hearts float up from here (elements are added by code) */}
        <g ref={heartsRef} pointerEvents="none" aria-hidden="true" />
      </svg>
    </div>
  );
});

export default memo(DonateCat);