import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { isAuthenticated } from "../lib/auth";

interface Props {
  children: ReactNode;
}

export function ProtectedRoute({ children }: Props) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
