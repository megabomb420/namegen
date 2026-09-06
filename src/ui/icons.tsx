interface IconProps {
  size?: number;
  'aria-hidden'?: boolean | 'true' | 'false';
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
}

export function StarIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z" />
    </svg>
  );
}

export function StarFilledIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z" />
    </svg>
  );
}

export function CopyIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function MoreIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CloseIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function RemoveIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 7h14M10 7V5h4v2m-7 0l1 13h8l1-13" />
    </svg>
  );
}

export function CheckIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
