"use client";

import { Database, LayoutDashboard, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const navigationItems = [
  {
    href: "/",
    icon: LayoutDashboard,
    label: "Overzicht",
  },
  {
    href: "/jobs",
    icon: Search,
    label: "Zoeken",
  },
] as const;

const Header = () => {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-[1600px] items-center gap-2 px-3 sm:gap-6 sm:px-6">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Catapulze Job Intelligence — overzicht"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded bg-primary/15 text-primary">
            <Database aria-hidden="true" className="size-4" />
          </span>
          <span className="font-display text-sm font-semibold tracking-tight whitespace-nowrap">
            Job Intelligence
          </span>
          <span className="hidden font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase sm:inline">
            Catapulze
          </span>
        </Link>

        <nav aria-label="Hoofdnavigatie" className="flex items-center gap-1">
          {navigationItems.map(({ href, icon: Icon, label }) => {
            const isActive =
              href === "/" ? pathname === href : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`min-h-11 items-center gap-2 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                } ${href === "/" ? "hidden sm:flex" : "flex"}`}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default Header;
