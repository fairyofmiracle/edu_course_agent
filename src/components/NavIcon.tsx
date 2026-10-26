const PATHS = {
  courses:
    "M5 7.5h10.5v11H5zM8.5 7.5V5.5H19v11h-3.5",
  plus: "M12 6v12M6 12h12",
  overview: "M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z",
  plan: "M8 7h11M8 12h11M8 17h7M5 7h.1M5 12h.1M5 17h.1",
  competencies: "M8 15.5 12 5l4 10.5M9.2 12.2h5.6",
  lectures: "M5 6.5h14v9H5zM9 18.5h6",
  seminars: "M6.5 16.5h8a3 3 0 0 0 3-3v-5a3 3 0 0 0-3-3h-8a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3zM8 19.2l2.2-2.7",
  tests: "M8 12.2 10.4 14.5 16 9M6 5.5h12v13H6z",
  checks: "M8 5.5h8l1.5 2V19H6.5V7.5zM9 12.2l1.8 1.8L15 10",
  help: "M12 17.2h.1M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1.2.9-1.2 1.7V14",
} as const;

export function NavIcon({ name }: { name: keyof typeof PATHS }) {
  const path = PATHS[name];
  const circle = name === "help";
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {circle ? <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" /> : null}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
