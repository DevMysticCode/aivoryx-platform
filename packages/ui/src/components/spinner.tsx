import { cn } from '../cn.js';

export interface SpinnerProps {
  className?: string;
  /** Visually-hidden label for assistive tech — the spinner itself is `aria-hidden`. */
  label?: string;
}

/**
 * A small inline loading indicator for in-flight actions (button pending
 * state, an inline "loading more" row). Not for whole-page/content loading —
 * that stays on the existing Skeleton pattern. Respects
 * `prefers-reduced-motion` by falling back to a static (non-spinning) ring.
 */
export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          className="opacity-25"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
