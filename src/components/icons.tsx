/**
 * Shared inline SVG icons — single visual language, consistent stroke.
 * All icons are decorative unless labelled by the parent control; parents
 * must supply aria-labels where an icon alone would be ambiguous.
 */
interface IconProps {
  className?: string;
}

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Brand mark: friendly train front over a rail line. */
export function BrandMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6 3.5h12a2.5 2.5 0 0 1 2.5 2.5v8a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 14V6A2.5 2.5 0 0 1 6 3.5Z" />
      <path d="M3.5 9.5h17" />
      <circle cx="8.2" cy="13.6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.8" cy="13.6" r="1.15" fill="currentColor" stroke="none" />
      <path d="m7.5 17.5-2 3M16.5 17.5l2 3M4 20.5h16" />
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4.5 12 20 4.5 15.5 20l-3.2-5.3L4.5 12Z" />
      <path d="m12.3 14.7 3.4-3.4" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.8a7.6 7.6 0 0 1 0 10.4" />
    </svg>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 5v14m0 0 5.5-5.5M12 19l-5.5-5.5" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function WarnIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4.2" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5.5 5.5" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function RupeeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 4h10M7 8.5h10M7 4c4.5 0 7 1.8 7 4.5S11.5 13 7 13l7 7" />
    </svg>
  );
}

export function SeatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 4.5h8a2 2 0 0 1 2 2V13H5V6.5a2 2 0 0 1 2-2Z" />
      <path d="M5 13v4.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V13" />
    </svg>
  );
}

export function PulseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 12h4l2.5-6 4 12L16 12h5" />
    </svg>
  );
}

export function TicketIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 7.5h16v3a1.8 1.8 0 0 0 0 3.6v3H4v-3a1.8 1.8 0 0 0 0-3.6v-3Z" />
      <path d="M14.5 7.5v10" strokeDasharray="2 2.4" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 9.5V20h12V9.5" />
    </svg>
  );
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5h16v10H9l-5 4v-14Z" />
    </svg>
  );
}
