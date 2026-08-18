import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type IconName =
  | 'home'
  | 'design'
  | 'printer'
  | 'undo'
  | 'redo'
  | 'refresh'
  | 'flask'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'type'
  | 'input'
  | 'line'
  | 'image'
  | 'code'
  | 'copy'
  | 'eye'
  | 'eyeOff'
  | 'group'
  | 'ungroup'
  | 'layoutRow'
  | 'layoutColumn'
  | 'justifyStart'
  | 'justifyCenter'
  | 'justifyEnd'
  | 'justifySpread'
  | 'alignLeft'
  | 'alignHCenter'
  | 'alignRight'
  | 'alignTop'
  | 'alignVCenter'
  | 'alignBottom'
  | 'alignCrossStart'
  | 'alignCrossCenter'
  | 'alignCrossEnd'
  | 'rotate'
  | 'duplicate'
  | 'trash'
  | 'bringFront'
  | 'sendBack'
  | 'dither'
  | 'invert'
  | 'save'
  | 'saveCopy'
  | 'filePlus'
  | 'upload'
  | 'plus'
  | 'minus'
  | 'more'
  | 'edit'
  | 'bookmark'
  | 'settings'
  | 'x'

const ICONS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  design: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V4h10v4" />
      <path d="M6 14h12v6H6z" />
      <rect x="4" y="8" width="16" height="8" rx="1.5" />
    </>
  ),
  undo: (
    <>
      <path d="M8 7 4 11l4 4" />
      <path d="M4 11h9a5 5 0 1 1 0 10H9" />
    </>
  ),
  redo: (
    <>
      <path d="m16 7 4 4-4 4" />
      <path d="M20 11h-9a5 5 0 1 0 0 10h4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 5v5h-5" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6L5.5 19A2 2 0 0 0 7.3 22h9.4a2 2 0 0 0 1.8-3L14 9V3" />
      <path d="M8.2 15h7.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M17 14.5A7 7 0 0 1 9.5 7 7 7 0 1 0 17 14.5z" />,
  monitor: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  type: (
    <>
      <path d="M5 7V5h14v2" />
      <path d="M12 5v14" />
      <path d="M8 19h8" />
    </>
  ),
  input: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="1.5" />
      <path d="M7 12h6" />
      <path d="M13 10v4" />
    </>
  ),
  line: <path d="M5 19 19 5" />,
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="m8 16 3.5-3.5L16 16l2-2 2 2" />
    </>
  ),
  code: (
    <>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M6 16H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h9.5A1.5 1.5 0 0 1 16 5v1" />
    </>
  ),
  eye: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 5 20 21" />
      <path d="M10.6 10.6A2.5 2.5 0 0 0 12 14.5" />
      <path d="M8 8.4C5 10 3 12 3 12s3.5 6 9 6c1.5 0 2.9-.4 4.1-1" />
      <path d="M14.5 9.2A6.6 6.6 0 0 1 21 12s-.6 1-1.7 2.2" />
    </>
  ),
  group: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1" />
      <rect x="12" y="12" width="8" height="8" rx="1" />
      <path d="M14 8h4v4M10 16H6v-4" />
    </>
  ),
  ungroup: (
    <>
      <rect x="3" y="4" width="7" height="7" rx="1" />
      <rect x="14" y="13" width="7" height="7" rx="1" />
    </>
  ),
  layoutRow: (
    <>
      <rect x="3" y="6" width="7" height="12" rx="1" />
      <rect x="14" y="6" width="7" height="12" rx="1" />
    </>
  ),
  layoutColumn: (
    <>
      <rect x="5" y="3" width="14" height="7" rx="1" />
      <rect x="5" y="14" width="14" height="7" rx="1" />
    </>
  ),
  justifyStart: (
    <>
      <path d="M4 5v14" />
      <rect x="7" y="7" width="5" height="10" rx="1" />
      <rect x="14" y="7" width="5" height="10" rx="1" />
    </>
  ),
  justifyCenter: (
    <>
      <path d="M12 5v14" />
      <rect x="4" y="7" width="5" height="10" rx="1" />
      <rect x="15" y="7" width="5" height="10" rx="1" />
    </>
  ),
  justifyEnd: (
    <>
      <path d="M20 5v14" />
      <rect x="5" y="7" width="5" height="10" rx="1" />
      <rect x="12" y="7" width="5" height="10" rx="1" />
    </>
  ),
  justifySpread: (
    <>
      <path d="M4 5v14M20 5v14" />
      <rect x="7" y="7" width="4" height="10" rx="1" />
      <rect x="13" y="7" width="4" height="10" rx="1" />
    </>
  ),
  alignLeft: (
    <>
      <path d="M4 5v14" />
      <path d="M8 8h12M8 12h8M8 16h12" />
    </>
  ),
  alignHCenter: (
    <>
      <path d="M12 5v14" />
      <path d="M6 8h12M8 12h8M6 16h12" />
    </>
  ),
  alignRight: (
    <>
      <path d="M20 5v14" />
      <path d="M4 8h12M8 12h8M4 16h12" />
    </>
  ),
  alignTop: (
    <>
      <path d="M5 4h14" />
      <path d="M8 8v12M12 8v8M16 8v12" />
    </>
  ),
  alignVCenter: (
    <>
      <path d="M5 12h14" />
      <path d="M8 6v12M12 8v8M16 6v12" />
    </>
  ),
  alignBottom: (
    <>
      <path d="M5 20h14" />
      <path d="M8 4v12M12 8v8M16 4v12" />
    </>
  ),
  alignCrossStart: (
    <>
      <path d="M4 6h16" />
      <rect x="6" y="9" width="5" height="10" rx="1" />
      <rect x="13" y="9" width="5" height="10" rx="1" />
    </>
  ),
  alignCrossCenter: (
    <>
      <path d="M4 12h16" />
      <rect x="6" y="6" width="5" height="12" rx="1" />
      <rect x="13" y="6" width="5" height="12" rx="1" />
    </>
  ),
  alignCrossEnd: (
    <>
      <path d="M4 18h16" />
      <rect x="6" y="4" width="5" height="10" rx="1" />
      <rect x="13" y="4" width="5" height="10" rx="1" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 5v5h-5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M6 16H5.5A1.5 1.5 0 0 1 4 14.5V5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V6" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M8 7v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7" />
    </>
  ),
  bringFront: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <rect x="4" y="4" width="12" height="12" rx="1.5" />
    </>
  ),
  sendBack: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="1.5" />
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
    </>
  ),
  dither: (
    <>
      <path d="M6 7h.01M10 7h.01M14 7h.01M18 7h.01M8 11h.01M12 11h.01M16 11h.01M6 15h.01M10 15h.01M14 15h.01M18 15h.01M8 19h.01M12 19h.01M16 19h.01" />
    </>
  ),
  invert: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" />
      <path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" stroke="none" />
    </>
  ),
  save: (
    <>
      <path d="M5 5h11l3 3v11H5z" />
      <path d="M8 5v5h8V5" />
      <path d="M8 19v-6h8v6" />
    </>
  ),
  saveCopy: (
    <>
      <path d="M8 8h9l3 3v9H8z" />
      <path d="M4 16V5h10" />
    </>
  ),
  filePlus: (
    <>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="M12 12v6M9 15h6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V6" />
      <path d="m8 10 4-4 4 4" />
      <path d="M5 18h14" />
    </>
  ),
  plus: <path d="M12 6v12M6 12h12" />,
  minus: <path d="M6 12h12" />,
  more: (
    <>
      <circle cx="12" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  bookmark: (
    <>
      <path d="M7 4h10v16l-5-3.5L7 20z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.2v2.1M12 18.7v2.1M4.6 6.5l1.5 1.5M17.9 16l1.5 1.5M3.2 12h2.1M18.7 12h2.1M4.6 17.5l1.5-1.5M17.9 8l1.5-1.5" />
    </>
  ),
  x: <path d="M7 7l10 10M17 7 7 17" />
}

interface IconProps {
  name: IconName
  size?: number
}

export default function Icon({ name, size = 16 }: IconProps) {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  name: IconName
  label: string
  size?: number
}

export function IconButton({
  name,
  label,
  size = 16,
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`${className} is-icon`.trim()}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon name={name} size={size} />
    </button>
  )
}
