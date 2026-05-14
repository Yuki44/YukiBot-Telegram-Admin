import { ReactNode } from "react";
import { I } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

export interface AppBarAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

interface AppBarProps {
  title: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  action?: AppBarAction;
}

export function AppBar({ title, onBack, right, action }: AppBarProps) {
  return (
    <div className="yk-appbar">
      {onBack ? (
        <button className="yk-appbar-back" onClick={onBack} aria-label="Atrás">
          {I.back({ size: 22 })}
        </button>
      ) : (
        <div style={{ width: 8 }} />
      )}
      <div className="yk-appbar-title">{title}</div>
      {right}
      <ThemeToggle />
      {action && (
        <button className="yk-appbar-action" onClick={action.onClick} aria-label={action.label}>
          {action.icon}
        </button>
      )}
    </div>
  );
}
