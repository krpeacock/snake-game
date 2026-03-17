export interface SnakeColors {
  /** UI accent color — title, score labels, controls (default: '#1e61f0') */
  accent?: string;
  /** Snake head color (default: '#f7a8b8') */
  head?: string;
  /** Snake body color (default: '#ffffff') */
  body?: string;
  /** Food color (default: '#55cdfc') */
  food?: string;
  /** Beat visualizer colors for beats 1–4 (default: trans pride palette) */
  beat?: [string, string, string, string];
}

export const DEFAULT_COLORS = {
  accent: '#1e61f0',
  head:   '#f7a8b8',
  body:   '#ffffff',
  food:   '#55cdfc',
  beat:   ['#55cdfc', '#ffffff', '#f7a8b8', '#ffffff'] as [string, string, string, string],
} as const;

export function resolveColors(colors?: SnakeColors): Required<SnakeColors> {
  return {
    accent: colors?.accent ?? DEFAULT_COLORS.accent,
    head:   colors?.head   ?? DEFAULT_COLORS.head,
    body:   colors?.body   ?? DEFAULT_COLORS.body,
    food:   colors?.food   ?? DEFAULT_COLORS.food,
    beat:   colors?.beat   ?? DEFAULT_COLORS.beat,
  };
}
