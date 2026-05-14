import { I } from "./Icon";
import { useTheme } from "../lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="yk-appbar-action"
      title={isDark ? "Modo claro" : "Modo oscuro"}
    >
      {isDark ? I.sun({ size: 20 }) : I.moon({ size: 20 })}
    </button>
  );
}
