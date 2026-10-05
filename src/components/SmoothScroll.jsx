"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Lets any component talk to the scroller later, without prop drilling:
//   import { getLenis } from "@/components/SmoothScroll";
//   getLenis()?.scrollTo("#results", { offset: -24 });
let instance = null;
export const getLenis = () => instance;

// Modals in this app lock the page by setting overflow: hidden on <body>.
// Lenis scrolls programmatically, which ignores overflow: hidden, so we pause it ourselves.
const isScrollLocked = () =>
  document.body.style.overflow === "hidden" ||
  document.documentElement.style.overflow === "hidden";

export default function SmoothScroll({ children }) {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      // GSAP's ticker drives Lenis, so the whole page runs on ONE animation loop.
      // Two loops (Lenis' own rAF + GSAP) is the classic cause of jitter.
      autoRaf: false,
      lerp: 0.1, // 0.08 = floatier, 0.12 = snappier
      smoothWheel: true,
      // Touch keeps native scrolling (syncTouch is off), which is the most stable on phones.
      // Lets the dropzone's inner scroll area scroll on its own instead of moving the page.
      // Once ImageDropzone gets `data-lenis-prevent`, this can be switched off (it is slightly costlier).
      allowNestedScroll: true,
      // prefers-reduced-motion is honored by Lenis by default (smoothing is turned off).
    });
    instance = lenis;

    // Keep ScrollTrigger in sync with Lenis' virtual position.
    lenis.on("scroll", ScrollTrigger.update);

    const tick = (time) => lenis.raf(time * 1000); // GSAP time is in seconds, Lenis wants ms
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0); // no catch-up jumps after a slow frame

    // Pause Lenis while a modal holds the scroll lock, resume when it lets go.
    let locked = false;
    const syncLock = () => {
      const next = isScrollLocked();
      if (next === locked) return;
      locked = next;
      if (next) lenis.stop();
      else lenis.start();
    };
    syncLock();

    const observer = new MutationObserver(syncLock);
    const watch = { attributes: true, attributeFilter: ["style"] };
    observer.observe(document.body, watch);
    observer.observe(document.documentElement, watch);

    return () => {
      observer.disconnect();
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33); // GSAP defaults
      lenis.destroy();
      instance = null;
    };
  }, []);

  return <>{children}</>;
}