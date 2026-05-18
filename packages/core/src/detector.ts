import type { DetectedTech } from "./types.js";

/**
 * Every detector implements this interface.
 * This is the Strategy Pattern — each detector
 * knows how to read one type of file.
 */
export interface Detector {
  /** Human-readable name */
  name: string;

  /** Files this detector looks for (glob patterns) */
  filePatterns: string[];

  /**
   * Analyze a project directory and return detected technologies.
   * Return empty array if nothing found (never throw).
   */
  detect(projectPath: string): Promise<DetectedTech[]>;
}
