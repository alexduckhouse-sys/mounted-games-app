import type { Message } from '../messages';

export const timing = {
  "timing.start": "Start race · flag down",
  "timing.skip": "Score without start time",
  "timing.storage": "The start time couldn’t be saved on this phone. Free some storage or score without a start time.",
  "timing.jump": "Jump to race",
  "timing.choose": "Choose a race",
  "timing.estimated": " (estimated)",
  "timing.review": "Review race pace",
  "timing.explain": "Estimates include changeovers and score-entry time. Published times stay as set.",
  "timing.loadError": "Pace estimates couldn’t be loaded. Open this page again when there is signal.",
  "timing.empty": "No recorded slots to compare yet.",
  "timing.waiting": "Waiting for five comparable slots",
  "timing.estimate": "About {minutes} min per slot · {samples} samples",
  "timing.holds": "Long holds left out: {count}",
  "timing.error": "Typical error in past checks: {minutes} min.",
  "timing.share": "Share clip"
} satisfies Record<string, Message>;
