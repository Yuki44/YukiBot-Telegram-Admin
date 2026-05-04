import { ReactNode, SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "fill" | "stroke"> {
  size?: number;
  fill?: string;
  stroke?: string;
  sw?: number;
  children?: ReactNode;
}

function Icon({ size = 24, fill = "none", stroke = "currentColor", sw = 2, children, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

type IP = Omit<IconProps, "children">;

export const I = {
  back: (p?: IP) => <Icon {...p}><path d="M15 18l-6-6 6-6" /></Icon>,
  chevR: (p?: IP) => <Icon {...p} size={p?.size ?? 20}><path d="M9 18l6-6-6-6" /></Icon>,
  chevD: (p?: IP) => <Icon {...p} size={p?.size ?? 20}><path d="M6 9l6 6 6-6" /></Icon>,
  search: (p?: IP) => <Icon {...p}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></Icon>,
  plus: (p?: IP) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>,
  close: (p?: IP) => <Icon {...p}><path d="M18 6L6 18M6 6l12 12" /></Icon>,
  more: (p?: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
      <circle cx="5" cy="12" r="1.5" />
    </Icon>
  ),
  settings: (p?: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </Icon>
  ),
  user: (p?: IP) => (
    <Icon {...p}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  ),
  users: (p?: IP) => (
    <Icon {...p}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </Icon>
  ),
  shield: (p?: IP) => <Icon {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Icon>,
  alert: (p?: IP) => (
    <Icon {...p}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
    </Icon>
  ),
  ban: (p?: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93l14.14 14.14" />
    </Icon>
  ),
  silence: (p?: IP) => (
    <Icon {...p}>
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M22 9l-6 6M16 9l6 6" />
    </Icon>
  ),
  list: (p?: IP) => (
    <Icon {...p}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Icon>
  ),
  hash: (p?: IP) => <Icon {...p}><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" /></Icon>,
  link: (p?: IP) => (
    <Icon {...p}>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.72" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.72-1.72" />
    </Icon>
  ),
  word: (p?: IP) => <Icon {...p}><path d="M4 7V4h16v3M9 20h6M12 4v16" /></Icon>,
  bell: (p?: IP) => (
    <Icon {...p}>
      <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </Icon>
  ),
  log: (p?: IP) => (
    <Icon {...p}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </Icon>
  ),
  group: (p?: IP) => (
    <Icon {...p}>
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </Icon>
  ),
  channel: (p?: IP) => (
    <Icon {...p}>
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
    </Icon>
  ),
  flag: (p?: IP) => (
    <Icon {...p}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22V15" />
    </Icon>
  ),
  check: (p?: IP) => <Icon {...p}><path d="M20 6L9 17l-5-5" /></Icon>,
  arrowR: (p?: IP) => <Icon {...p}><path d="M5 12h14M12 5l7 7-7 7" /></Icon>,
  logout: (p?: IP) => <Icon {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></Icon>,
  toggle: (p?: IP) => (
    <Icon {...p}>
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="16" cy="12" r="3" />
    </Icon>
  ),
  help: (p?: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
    </Icon>
  ),
  refresh: (p?: IP) => (
    <Icon {...p}>
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </Icon>
  ),
  sun: (p?: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Icon>
  ),
  moon: (p?: IP) => (
    <Icon {...p}>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </Icon>
  ),
  photo: (p?: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </Icon>
  ),
  video: (p?: IP) => (
    <Icon {...p}>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </Icon>
  ),
  mic: (p?: IP) => (
    <Icon {...p}>
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
    </Icon>
  ),
  file: (p?: IP) => (
    <Icon {...p}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </Icon>
  ),
  text: (p?: IP) => <Icon {...p}><path d="M4 7V4h16v3M9 20h6M12 4v16" /></Icon>,
  sticker: (p?: IP) => (
    <Icon {...p}>
      <path d="M3 12a9 9 0 119 9c0-5 4-9 9-9" />
    </Icon>
  ),
  trash: (p?: IP) => (
    <Icon {...p}>
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </Icon>
  ),
  copy: (p?: IP) => (
    <Icon {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </Icon>
  ),
  star: (p?: IP) => (
    <Icon {...p}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </Icon>
  ),
  eye: (p?: IP) => (
    <Icon {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
  eyeOff: (p?: IP) => (
    <Icon {...p}>
      <path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a19.77 19.77 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 8 11 8a19.6 19.6 0 01-3.16 4.19" />
      <path d="M14.12 14.12a3 3 0 11-4.24-4.24M1 1l22 22" />
    </Icon>
  ),
  lock: (p?: IP) => (
    <Icon {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </Icon>
  ),
  telegram: (p?: IP) => (
    <Icon {...p}>
      <path d="M22 2L2 11l7 3 3 7 4-6 6-13z" />
      <path d="M9 14l6-6" />
    </Icon>
  ),
};
