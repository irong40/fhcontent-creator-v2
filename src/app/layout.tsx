import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Content Command Center | History Unveiled VA",
  description: "Content automation system for History Unveiled VA",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background font-sans antialiased`}>
        <div className="relative flex min-h-screen flex-col">
          <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-14 max-w-screen-2xl items-center">
              <div className="mr-4 flex">
                <Link className="mr-6 flex items-center space-x-2" href="/">
                  <span className="font-bold text-xl bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">
                    Content Command Center
                  </span>
                </Link>
              </div>
              <nav className="flex items-center gap-6 text-sm">
                <Link href="/plan" className="transition-colors hover:text-foreground/80 text-foreground/60">
                  Plan
                </Link>
                <Link href="/personas" className="transition-colors hover:text-foreground/80 text-foreground/60">
                  Personas
                </Link>
                <Link href="/api/health" className="transition-colors hover:text-foreground/80 text-foreground/60">
                  API Status
                </Link>
              </nav>
              <div className="ml-auto flex items-center gap-4">
                {user && <SignOutButton />}
              </div>
            </div>
          </header>
          <main className="flex-1">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
