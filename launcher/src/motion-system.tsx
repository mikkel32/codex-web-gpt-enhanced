import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";

export const SPRING = { type: "spring", stiffness: 380, damping: 34, mass: .8 } as const;
export const SURFACE_SPRING = { type: "spring", stiffness: 240, damping: 28, mass: .9 } as const;
export const arrival = {
  hidden: { opacity: 0, y: 24, scale: .975 },
  show: { opacity: 1, y: 0, scale: 1, transition: SURFACE_SPRING },
};

export function KineticHeading({ text, className = "" }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  return <h1 className={`kinetic-heading ${className}`} aria-label={text}>
    {text.split(" ").map((word, index) => <Fragment key={index}><span className="kinetic-word-mask" aria-hidden="true">
      <motion.span initial={reduced ? false : { y: "110%", rotateX: -35, opacity: 0 }}
        animate={{ y: "0%", rotateX: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 165, damping: 23, delay: Math.min(index * .045, .28) }}>{word}</motion.span>
    </span>{index < text.split(" ").length - 1 ? " " : ""}</Fragment>)}
  </h1>;
}

export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  return <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 24, scale: .975 }}
    animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SURFACE_SPRING, delay }}>{children}</motion.div>;
}

/** Pointer-driven depth with no animation loop after the springs have settled. */
export function CinematicMark({ large = false, active = false }: { large?: boolean; active?: boolean }) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-1, 1], [13, -13]), { stiffness: 120, damping: 19 });
  const rotateY = useSpring(useTransform(x, [-1, 1], [-18, 18]), { stiffness: 120, damping: 19 });
  const lightX = useTransform(rotateY, [-18, 18], ["20%", "80%"]);
  const lightY = useTransform(rotateX, [-13, 13], ["80%", "20%"]);
  const lightPosition = useTransform([lightX, lightY], values => `${values[0]} ${values[1]}`);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reset = () => { if (document.hidden) { x.set(0); y.set(0); } };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, [x, y]);
  return <div ref={host} className={`cinematic-mark ${large ? "is-large" : ""}${active ? " is-working" : ""}`}
    aria-hidden="true" onPointerMove={event => {
      if (reduced || event.pointerType === "touch") return;
      const rect = event.currentTarget.getBoundingClientRect();
      x.set(((event.clientX - rect.left) / rect.width - .5) * 2);
      y.set(((event.clientY - rect.top) / rect.height - .5) * 2);
    }} onPointerLeave={() => { x.set(0); y.set(0); }}>
    <motion.div className="cinematic-mark-arrival" initial={reduced ? false : { opacity: 0, y: 38, rotateY: -32, rotateX: 18, scale: .75 }}
      animate={{ opacity: 1, y: 0, rotateY: 0, rotateX: 0, scale: 1 }} transition={{ type: "spring", stiffness: 105, damping: 17, delay: .12 }}>
      <motion.div className="cinematic-mark-plane" style={reduced ? undefined : { rotateX, rotateY }}>
        <div className="cinematic-mark-shadow" /><BrandMark />
        <motion.div className="cinematic-mark-light" style={{ backgroundPosition: lightPosition }} />
        <div className="cinematic-mark-edge" />
      </motion.div>
    </motion.div>
  </div>;
}
