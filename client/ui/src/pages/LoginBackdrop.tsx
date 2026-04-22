import { motion } from "framer-motion";

const ORB_DRIFT_DURATION_S = 18;
const ORB_PULSE_DURATION_S = 7;
const RING_ROTATION_DURATION_S = 90;
const BACKDROP_FADE_MS = 0.6;

/**
 * Full-bleed ambient stage behind the login card. Three layers:
 *   1. Base gradient — matches PositSplash so the post-login handoff stays
 *      continuous in palette.
 *   2. Two blurred indigo/violet orbs, drifting slowly, that give the glass
 *      card something saturated to refract.
 *   3. A concentric-rings motif (huge echo of the brand mark) that rotates on
 *      a slow loop to keep the composition breathing.
 *
 * All motion goes through framer-motion, which honours `prefers-reduced-motion`
 * via its built-in reducer. Pointer-events are off throughout — the form
 * above must own every click.
 */
export function LoginBackdrop() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: BACKDROP_FADE_MS, ease: "easeOut" }}
      className="pointer-events-none fixed inset-0 overflow-hidden"
      aria-hidden
      style={{
        background:
          "radial-gradient(1100px 700px at 18% 8%, rgba(79, 91, 213, 0.18), transparent 62%)," +
          "radial-gradient(900px 600px at 82% 88%, rgba(138, 124, 240, 0.16), transparent 62%)," +
          "radial-gradient(700px 500px at 50% 50%, rgba(180, 170, 255, 0.08), transparent 70%)," +
          "linear-gradient(160deg, #e5e5ee 0%, #ececf3 40%, #e9e9f2 100%)",
      }}
    >
      {/* Indigo orb — top-left, drifts down + right on a slow loop */}
      <motion.div
        initial={{ x: 0, y: 0, opacity: 0.32 }}
        animate={{
          x: [0, 40, 0],
          y: [0, 24, 0],
          opacity: [0.32, 0.38, 0.32],
        }}
        transition={{
          duration: ORB_DRIFT_DURATION_S,
          ease: "easeInOut",
          repeat: Infinity,
        }}
        className="absolute -left-[6%] top-[8%] h-[560px] w-[560px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, #6b77e0 0%, #4f5bd5 45%, transparent 72%)",
          filter: "blur(72px)",
        }}
      />

      {/* Violet orb — bottom-right, counter-phase pulse for gentle life */}
      <motion.div
        initial={{ x: 0, y: 0, opacity: 0.26 }}
        animate={{
          x: [0, -28, 0],
          y: [0, -18, 0],
          opacity: [0.26, 0.34, 0.26],
        }}
        transition={{
          duration: ORB_PULSE_DURATION_S * 2.4,
          ease: "easeInOut",
          repeat: Infinity,
        }}
        className="absolute -right-[4%] bottom-[4%] h-[520px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at 65% 65%, #a193f4 0%, #7b6cf0 45%, transparent 72%)",
          filter: "blur(72px)",
        }}
      />

      {/* Concentric-rings motif — giant echo of the brand mark, rotating very
          slowly so the composition has one moving anchor behind the card. */}
      <motion.svg
        className="absolute left-1/2 top-1/2"
        style={{
          width: 920,
          height: 920,
          marginLeft: -460,
          marginTop: -460,
          opacity: 0.14,
        }}
        viewBox="0 0 24 24"
        fill="none"
        animate={{ rotate: 360 }}
        transition={{
          duration: RING_ROTATION_DURATION_S,
          ease: "linear",
          repeat: Infinity,
        }}
      >
        <circle cx="9" cy="9" r="6" stroke="#4f5bd5" strokeWidth="0.15" />
        <circle cx="15" cy="15" r="5" stroke="#4f5bd5" strokeWidth="0.15" />
        <circle cx="9" cy="9" r="3.2" stroke="#4f5bd5" strokeWidth="0.1" />
        <circle cx="15" cy="15" r="2.6" fill="#4f5bd5" fillOpacity="0.35" />
      </motion.svg>

      {/* Subtle vignette — tightens the edges so the card reads as the focal
          point even on ultrawide viewports. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(15, 17, 41, 0.08) 100%)",
        }}
      />
    </motion.div>
  );
}
