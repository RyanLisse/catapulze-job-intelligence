"use client";
import Link from "next/link";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  const links = [{ label: "Dashboard", to: "/dashboard" }] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex items-center gap-4 text-lg">
          <Link href="/" className="font-semibold tracking-tight">
            Job Intelligence
          </Link>
          {links.map(({ to, label }) => (
            <Link key={to} href={to} className="text-muted-foreground">
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
