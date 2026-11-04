"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Key,
  Monitor,
  ScrollText,
  Settings,
  Smartphone,
  Users,
} from "lucide-react";

import { cn } from "@vortex/ui/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/dashboard/users", label: "Users", icon: Users },
  { href: "/dashboard/sessions", label: "Sessions", icon: Monitor },
  { href: "/dashboard/oauth-clients", label: "OAuth clients", icon: Key },
  { href: "/dashboard/devices", label: "Devices", icon: Smartphone },
  { href: "/dashboard/audit-log", label: "Audit log", icon: ScrollText },
  { href: "/dashboard/bootstrap-profiles", label: "Bootstrap profiles", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
