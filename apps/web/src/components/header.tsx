"use client";

import { BriefcaseBusiness, LayoutDashboard, Search } from "lucide-react";
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
    <header className="sticky top-0 z-40 border-b border-white/8 bg-[var(--ji-ink)]/95 text-[var(--ji-paper)] backdrop-blur-md">
      <div className="mx-auto flex min-h-16 w-full max-w-[1600px] items-center gap-2 px-3 sm:px-5">
        <Link
          href="/"
          className="mr-auto flex min-h-11 items-center gap-2 rounded-sm pr-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ji-signal)]"
          aria-label="Catapulze Job Intelligence — overzicht"
        >
          <span className="grid size-9 place-items-center border border-[var(--ji-signal)]/40 bg-[var(--ji-signal)]/10 text-[var(--ji-signal)]">
            <BriefcaseBusiness aria-hidden="true" className="size-[18px]" />
          </span>
          <span className="hidden leading-none sm:block">
            <span className="block text-[10px] font-semibold tracking-[0.2em] text-[var(--ji-signal)] uppercase">
              Catapulze
            </span>
            <span className="mt-1 block text-sm font-semibold tracking-tight">
              Job Intelligence
            </span>
          </span>
          <span className="text-sm font-semibold sm:hidden">JI</span>
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
                className={`flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ji-signal)] ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/62 hover:bg-white/6 hover:text-white"
                } ${href === "/" ? "hidden sm:flex" : ""}`}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default Header;
