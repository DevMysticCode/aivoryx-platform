/**
 * Categorical accents for dashboard surfaces (KPI icons, tinted backgrounds).
 * Five map onto existing semantic tokens (teal = primary, blue = info, green =
 * success, amber = warning, red = danger) so they follow light/dark and tenant
 * themes; orange and purple have dedicated `--tone-*` tokens. Class strings are
 * written out in full so Tailwind can see them.
 */
export type DashboardTone = 'teal' | 'blue' | 'green' | 'amber' | 'orange' | 'purple' | 'red';

export interface ToneClasses {
  /** icon chip background */
  chip: string;
  /** icon / accent text colour */
  text: string;
  /** very subtle card tint */
  tint: string;
  /** thin accent border */
  border: string;
  /** solid dot / bar fill */
  solid: string;
}

export const TONE: Record<DashboardTone, ToneClasses> = {
  teal: {
    chip: 'bg-primary-soft',
    text: 'text-primary',
    tint: 'bg-primary-soft/40',
    border: 'border-primary/20',
    solid: 'bg-primary',
  },
  blue: {
    chip: 'bg-info-soft',
    text: 'text-info',
    tint: 'bg-info-soft/40',
    border: 'border-info/20',
    solid: 'bg-info',
  },
  green: {
    chip: 'bg-success-soft',
    text: 'text-success',
    tint: 'bg-success-soft/40',
    border: 'border-success/20',
    solid: 'bg-success',
  },
  amber: {
    chip: 'bg-warning-soft',
    text: 'text-warning',
    tint: 'bg-warning-soft/40',
    border: 'border-warning/25',
    solid: 'bg-warning',
  },
  orange: {
    chip: 'bg-tone-orange-soft',
    text: 'text-tone-orange',
    tint: 'bg-tone-orange-soft/40',
    border: 'border-tone-orange/20',
    solid: 'bg-tone-orange',
  },
  purple: {
    chip: 'bg-tone-purple-soft',
    text: 'text-tone-purple',
    tint: 'bg-tone-purple-soft/40',
    border: 'border-tone-purple/20',
    solid: 'bg-tone-purple',
  },
  red: {
    chip: 'bg-danger-soft',
    text: 'text-danger',
    tint: 'bg-danger-soft/40',
    border: 'border-danger/20',
    solid: 'bg-danger',
  },
};
