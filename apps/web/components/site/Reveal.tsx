"use client";
// Fades a block up the first time it enters the viewport. Content is visible without JS and
// with reduced motion; the hidden start state is only applied once JS has run.
import { createElement, useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({ children, className, as = "div" }: { children: ReactNode; className?: string | undefined; as?: "div" | "li" | "ul" | "section" }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"static" | "hidden" | "shown">("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92) return;
    setState("hidden");
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return createElement(
    as,
    {
      ref,
      className,
      style:
        state === "static"
          ? undefined
          : { opacity: state === "shown" ? 1 : 0, transform: state === "shown" ? "none" : "translateY(28px)", transition: "opacity 0.9s var(--ease), transform 0.9s var(--ease)" },
    },
    children,
  );
}
