// OWNER: Person B (layout, nav, account switcher).
import type { Metadata } from "next";
import Link from "next/link";
import { Orbitron, Share_Tech_Mono } from "next/font/google";
import "./globals.css";
import AccountSwitcher from "@/components/board/AccountSwitcher";

const display = Orbitron({ variable: "--font-display-face", subsets: ["latin"] });
const mono = Share_Tech_Mono({ variable: "--font-mono-body", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NMC² Ops",
  description: "Component-level ticketing, history and shift handoff for colocation data centers.",
};

const NAV = [
  { href: "/", label: "Floor" },
  { href: "/board", label: "Board" },
  { href: "/shift", label: "Shift" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable} antialiased min-h-screen`}>
        <header className="flex items-center gap-6 border-b border-line bg-panel px-4 h-12">
          <span className="font-[family-name:var(--font-display)] text-neon-cyan neon-text tracking-widest">
            NMC²//OPS
          </span>
          <nav className="flex gap-4 text-sm text-dim">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-neon-magenta">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {/* TODO(Person C): <ReportIssueButton /> */}
            <AccountSwitcher />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
