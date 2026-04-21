import { motion } from "framer-motion";
import { PositLogo } from "./PositLogo";

interface PositSplashProps {
  /** Optional status copy beneath the wordmark. */
  message?: string;
}

/**
 * Full-screen brand moment shown during app boot and post-login until the
 * first WebSocket tick arrives. Matches the body background gradient so the
 * transition into the app feels continuous, and breathes the mark so the
 * user knows we haven't hung.
 *
 * Exit-fade is driven by `<AnimatePresence>` in the caller — this component
 * only owns its own entrance + idle breathing.
 */
export function PositSplash({ message }: PositSplashProps) {
  return (
    <motion.div
      key="posit-splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{
        background:
          "radial-gradient(900px 600px at 12% 0%, rgba(79, 91, 213, 0.09), transparent 60%)," +
          "radial-gradient(700px 500px at 95% 100%, rgba(123, 108, 240, 0.07), transparent 60%)," +
          "linear-gradient(160deg, #eaeaef 0%, #f4f4f7 40%, #f0f0f5 100%)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center"
      >
        <motion.div
          animate={{ opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 2.6, ease: "easeInOut", repeat: Infinity }}
        >
          <PositLogo size={38} />
        </motion.div>
        {message && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="mt-5 text-[11px] font-medium tracking-wide text-mm-text-dim"
          >
            {message}
          </motion.p>
        )}
      </motion.div>
    </motion.div>
  );
}
