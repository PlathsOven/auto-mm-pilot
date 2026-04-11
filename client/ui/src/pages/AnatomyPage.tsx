import { AnatomyCanvas } from "../components/studio/anatomy/AnatomyCanvas";

/**
 * Anatomy — top-level mode that mounts the live pipeline canvas.
 *
 * Honours `?stream=<name>` to auto-open the Stream Canvas drawer and
 * `?streams=list` to open the stream-library sidebar.
 */
export function AnatomyPage() {
  return <AnatomyCanvas />;
}
