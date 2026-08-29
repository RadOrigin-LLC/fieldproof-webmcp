/** Inline icon set — precise 1.75px strokes, drafting-table feel. */
interface IconProps {
  size?: number;
}

const base = (size: number) =>
  ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }) as const;

/** Folder with a corner tab — projects. */
export function IconProjects({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

/** Camera — capture. */
export function IconCapture({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/** Checkbox with tick — punch list. */
export function IconPunch({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

/** Ruled page — daily log. */
export function IconLog({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 3h12v18H6z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}

/** Sliders — more. */
export function IconMore({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 8h14M5 16h14" />
      <circle cx="10" cy="8" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPlus({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconCheck({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m5 13 4.5 4.5L19 7" />
    </svg>
  );
}

export function IconChevron({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** The seal octagon — drawn filled where the seal is verified. */
export function SealOctagon({ size = 14, filled = true }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className="seal-octagon"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.75}
    >
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5z" />
      {filled && <path d="m8.5 12.5 2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function IconPrint({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7 8V4h10v4M7 16H4v-8h16v8h-3" />
      <path d="M7 13h10v7H7z" />
    </svg>
  );
}

export function IconShield({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3z" />
      <path d="m9 12 2 2 4-4.5" />
    </svg>
  );
}
