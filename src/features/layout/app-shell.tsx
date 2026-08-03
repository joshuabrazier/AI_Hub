"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/features/layout/navbar";
import Sidebar from "@/features/layout/sidebar";
import { SidebarProvider, useSidebar } from "@/features/layout/sidebar-context";
import { NavigationPendingOverlay, NavigationPendingProvider } from "@/features/layout/navigation-pending";
import { isChromelessRoute } from "@/lib/routes";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// AppShell
// Renders the global chrome (Navbar + Sidebar) for the authenticated
// app, but renders bare children on standalone pages (landing, auth)
// so they can use their own full-page layout.
//
// The chrome is the same in all three areas; what differs is the nav inside
// it, which the sidebar resolves from the signed-in user's role.
// -------------------------------------------------------------------
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isChromelessRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <NavigationPendingProvider>
        <Navbar />
        <Sidebar />
        <AppMain>{children}</AppMain>
        <NavigationPendingOverlay />
      </NavigationPendingProvider>
    </SidebarProvider>
  );
}

// Main content - offset for the fixed navbar and sidebar. The left
// padding follows the sidebar width and animates in sync, so content
// slides over smoothly instead of being covered.
function AppMain({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <main
      id="main-content"
      className={cn(
        "pt-20 transition-[padding] duration-300 ease-in-out motion-reduce:transition-none",
        collapsed ? "md:pl-16" : "md:pl-64",
      )}
    >
      {children}
    </main>
  );
}
