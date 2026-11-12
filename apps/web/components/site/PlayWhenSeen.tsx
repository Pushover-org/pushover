"use client";
// Holds an element's CSS animations until it scrolls into view, so the examination on a phone plays
// when the receipt is on screen, not before. Without JavaScript the animations simply run on load.
import { useEffect } from "react";

export function PlayWhenSeen({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el || !("IntersectionObserver" in window)) return;
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight * 0.8) return; // already on screen: let it play now
    el.dataset["wait"] = "true";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset["wait"] = "false";
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id]);
  return null;
}
