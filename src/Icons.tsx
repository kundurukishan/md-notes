// A small set of stroke icons (Lucide-style) so the app ships with no icon font.
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type P = { size?: number };
const svg = (size: number | undefined, children: React.ReactNode) => (
  <svg {...base} width={size ?? 16} height={size ?? 16} aria-hidden="true">
    {children}
  </svg>
);

export const IconNotes = ({ size }: P) => svg(size, <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></>);
export const IconPin = ({ size }: P) => svg(size, <><path d="M12 17v5" /><path d="M9 10.8V4h6v6.8l3 3.2v2H6v-2z" /></>);
export const IconTag = ({ size }: P) => svg(size, <><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" /><circle cx="7.5" cy="7.5" r="1.2" /></>);
export const IconUntagged = ({ size }: P) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M5.7 5.7l12.6 12.6" /></>);
export const IconPlus = ({ size }: P) => svg(size, <><path d="M12 5v14M5 12h14" /></>);
export const IconSearch = ({ size }: P) => svg(size, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconSettings = ({ size }: P) => svg(size, <><path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.8l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.8v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>);
export const IconEye = ({ size }: P) => svg(size, <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconPencil = ({ size }: P) => svg(size, <><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></>);
export const IconTrash = ({ size }: P) => svg(size, <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>);
export const IconFolder = ({ size }: P) => svg(size, <><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" /></>);
export const IconSidebar = ({ size }: P) => svg(size, <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>);
export const IconSort = ({ size }: P) => svg(size, <><path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" /></>);
export const IconX = ({ size }: P) => svg(size, <><path d="M18 6 6 18M6 6l12 12" /></>);
export const IconCheck = ({ size }: P) => svg(size, <><path d="M5 12.5 10 17 19 7.5" /></>);
export const IconCheckCircle = ({ size }: P) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>);
export const IconGrip = ({ size }: P) => svg(size, <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>);
export const IconCalendar = ({ size }: P) => svg(size, <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
export const IconSun = ({ size }: P) => svg(size, <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconList = ({ size }: P) => svg(size, <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></>);
export const IconChevron = ({ size }: P) => svg(size, <><path d="m9 6 6 6-6 6" /></>);
export const IconMore = ({ size }: P) => svg(size, <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>);
export const IconSubtask = ({ size }: P) => svg(size, <><path d="M5 4v9a3 3 0 0 0 3 3h11" /><path d="m15 12 4 4-4 4" /></>);
export const IconDetails = ({ size }: P) => svg(size, <><path d="M4 6h16M4 12h16M4 18h10" /></>);
export const IconTextColor = ({ size }: P) => svg(size, <><path d="m6 16 6-12 6 12M8.5 11h7" /><path d="M4 20.5h16" strokeWidth={2.6} stroke="var(--accent)" /></>);
export const IconBold = ({ size }: P) => svg(size, <><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" strokeWidth={2.2} /></>);
export const IconItalic = ({ size }: P) => svg(size, <><path d="M19 4h-9M14 20H5M15 4 9 20" /></>);
export const IconStrike = ({ size }: P) => svg(size, <><path d="M16 6.5C15.3 5 13.8 4 12 4c-2.5 0-4.5 1.5-4.5 3.6 0 1.5.9 2.6 2.8 3.4M4 12h16M8 17.5c.7 1.5 2.2 2.5 4 2.5 2.5 0 4.5-1.5 4.5-3.6 0-.8-.2-1.4-.6-1.9" /></>);
export const IconHighlight = ({ size }: P) => svg(size, <><path d="m9 11-5 5v3h3l5-5" /><path d="m21.6 6.4-4-4a1.4 1.4 0 0 0-2 0L9 9l6 6 6.6-6.6a1.4 1.4 0 0 0 0-2" /></>);
export const IconListBullet = ({ size }: P) => svg(size, <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></>);
export const IconListNumbered = ({ size }: P) => svg(size, <><path d="M10 6h10M10 12h10M10 18h10M4 4.5l1.5-.5v4M3.8 10.5c.4-.6 1.8-.8 2 .1.2.8-2 2-2 3.4h2.4M3.8 16.5h2.1l-1 1.4c1 0 1.4.5 1.4 1s-.6 1.2-1.5 1.1c-.5 0-.9-.3-1.1-.6" /></>);
export const IconChecklist = ({ size }: P) => svg(size, <><rect x="3" y="4" width="6" height="6" rx="1.2" /><path d="m4.5 7 1 1 2-2" /><rect x="3" y="14" width="6" height="6" rx="1.2" /><path d="M13 7h8M13 17h8" /></>);
export const IconUndo = ({ size }: P) => svg(size, <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const IconRedo = ({ size }: P) => svg(size, <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>);
export const IconChevronDown = ({ size }: P) => svg(size, <><path d="m6 9 6 6 6-6" /></>);
