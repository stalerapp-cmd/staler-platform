import { motion, useInView, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Section that animates in and out with the scroll, in both directions:
 * scrolling down it rises from below and leaves upwards; scrolling back up it
 * comes down from above. Respects "reduce motion".
 */
export function Reveal({ children, className, delay = 0, amount = 0.2 }: { children: ReactNode; className?: string; delay?: number; amount?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { amount });
  const [out, setOut] = useState({ y: 56, rotate: 0.6 });
  useEffect(() => {
    if (inView || !ref.current) return;
    // Out of view: remember which side it left from, so it comes back from there.
    const above = ref.current.getBoundingClientRect().top < 0;
    setOut(above ? { y: -56, rotate: -0.6 } : { y: 56, rotate: 0.6 });
  }, [inView]);
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, ...out, scale: 0.97 }}
      animate={inView ? { opacity: 1, y: 0, rotate: 0, scale: 1 } : { opacity: 0, ...out, scale: 0.97 }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1], delay: inView ? delay : 0 }}
    >
      {children}
    </motion.div>
  );
}

/** Thin progress thread across the top while reading the page. */
export function ScrollThread({ className }: { className: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });
  return <motion.div aria-hidden="true" style={{ scaleX }} className={`fixed inset-x-0 top-0 z-50 h-1 origin-left rtl:origin-right ${className}`} />;
}
