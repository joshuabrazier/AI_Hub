"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// -------------------------------------------------------------------
// SidebarContext
// Shares the sidebar's collapsed state so the sidebar itself and the
// main content area can animate together (content shifts as the rail
// expands/collapses, rather than being covered by it).
// -------------------------------------------------------------------
type SidebarContextValue = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Start expanded ("out") so the nav is visible on first login.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed((prev) => !prev), setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider");
  return context;
}
