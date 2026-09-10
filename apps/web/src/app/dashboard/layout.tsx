import { DashboardAuthGuard } from "@/components/auth/dashboard-auth-guard";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardAuthGuard>{children}</DashboardAuthGuard>;
}
