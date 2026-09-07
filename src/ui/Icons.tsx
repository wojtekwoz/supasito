import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({ viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props });

export const Plus = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>;
export const Folder = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /></svg>;
export const Crosshair = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="8" cy="8" r="4.5" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" /></svg>;
export const Send = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>;
export const Stop = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)} fill="currentColor" stroke="none"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>;
export const Reload = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v3h-3" /></svg>;
export const External = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V9" /><path d="M9.5 2H14v4.5M14 2 7.5 8.5" /></svg>;
export const Desktop = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="1.5" y="3" width="13" height="8.5" rx="1.5" /><path d="M5.5 14h5M8 11.5V14" /></svg>;
export const Tablet = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><path d="M7 12.5h2" /></svg>;
export const Phone = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7 12.5h2" /></svg>;
export const Gear = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" /></svg>;
export const Check = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
export const X = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const Chevron = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 3.5 10.5 8 6 12.5" /></svg>;
export const Doc = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 1.5h5l3.5 3.5v9.5h-8.5z" /><path d="M9 1.5V5h3.5M6 8.5h4M6 11h4" /></svg>;
export const Pen = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m2.5 13.5.8-3.2 7.5-7.5a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-7.5 7.5z" /></svg>;
export const Terminal = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="m4.5 6 2.5 2-2.5 2M8.5 10.5h3" /></svg>;
export const Search = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>;
export const Globe = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="8" cy="8" r="6.5" /><path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" /></svg>;
export const Branch = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="4" cy="3.5" r="1.5" /><circle cx="4" cy="12.5" r="1.5" /><circle cx="12" cy="5.5" r="1.5" /><path d="M4 5v6M12 7c0 3-8 1.5-8 4" /></svg>;
export const Shield = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M8 1.5 13 3.5v4c0 3.2-2.1 5.6-5 7-2.9-1.4-5-3.8-5-7v-4z" /></svg>;
export const Question = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="8" cy="8" r="6.5" /><path d="M6 6.2a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.3M8 11.6v.1" /></svg>;
export const Sparkle = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" /></svg>;
export const Trash = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 4.5h10M6.5 2.5h3M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>;
export const Camera = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.8l1-1.5h3.4l1 1.5h1.8A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /><circle cx="8" cy="8.5" r="2.4" /></svg>;
export const Code = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9.5 2.5l-3 11" /></svg>;
export const Book = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h3.5v11.5H4a1.5 1.5 0 0 0-1.5 1.5zM13.5 3.5A1.5 1.5 0 0 0 12 2H8.5v11.5H12a1.5 1.5 0 0 1 1.5 1.5z" /></svg>;
export const Robot = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="2.5" y="5" width="11" height="8.5" rx="2" /><path d="M8 5V2.75M5.75 8.5V11M10.25 8.5V11" /><circle cx="8" cy="2" r="0.8" fill="currentColor" stroke="none" /></svg>;
/** Diagonal arrows pointing out / in, as on the macOS full-screen button: the preview growing to the whole window, and back. */
export const Expand = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M14 2 9.5 6.5M10 2h4v4M2 14l4.5-4.5M6 14H2v-4" /></svg>;
export const Collapse = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M14 2 9.5 6.5M9.5 2.5v4h4M2 14l4.5-4.5M6.5 13.5v-4h-4" /></svg>;
export const Minus = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 8h10" /></svg>;
export const Bubble = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H7.5L4 14v-3A1.5 1.5 0 0 1 2.5 9.5z" /></svg>;
export const Signal = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 13v-2.5M6.5 13V8M10 13V5.5M13.5 13V3" /></svg>;

/** The app mark: the Supasito "s" on its coral tile (a flat cut of the app icon in src-tauri/icons/Supasito.icon). */
export const Mark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" {...p}>
    <defs><linearGradient id="mark-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF7B5F" /><stop offset="1" stopColor="#EE4A31" /></linearGradient></defs>
    <rect width="16" height="16" rx="4" fill="url(#mark-g)" />
    <svg x="2.5" y="2.5" width="11" height="11" viewBox="221 168 900 900"><path fill="#FFE6DD" d="M620 226H919C940 226 945 245 932 260L705 471C692 483 698 496 716 496C862 496 979 604 979 743C979 889 862 1010 712 1010H385C363 1010 356 990 373 973L616 752C628 741 622 731 605 730C469 728 363 623 363 488C363 342 475 226 620 226Z" /></svg>
  </svg>
);
