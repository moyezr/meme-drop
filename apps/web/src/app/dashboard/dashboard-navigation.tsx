"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/api-keys", label: "API keys" },
  { href: "/dashboard/billing", label: "Billing" },
] as const;

export function DashboardNavigation() {
  const pathname = usePathname();
  return (
    <nav className="dashboardNav" aria-label="Dashboard navigation">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
      <span aria-disabled="true">Usage</span>
    </nav>
  );
}
