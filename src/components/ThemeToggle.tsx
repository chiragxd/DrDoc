import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("drdoc.theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem("drdoc.theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button className="icon-btn" onClick={() => setTheme(next)} title={`Theme: ${theme} (switch to ${next})`} aria-label={`Colour theme: ${theme}`}>
      <Icon />
    </button>
  );
}
