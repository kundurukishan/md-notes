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
