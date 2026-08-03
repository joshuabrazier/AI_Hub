"use client";

import Link from "next/link";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { User, Settings, LogOut, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { MESSAGES } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/auth-client";

type UserMenuProps = {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
  };
};

// -------------------------------------------------------------------
// UserMenu
// -------------------------------------------------------------------
export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      const response = await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push(ROUTES.PUBLIC_HOME);
            toast.success("User signed out successfully");
          },
        },
      });

      if (!response.data?.success) {
        if (response.error) {
          toast.error(response.error.message);
        }
        return;
      }

      return;
    } catch (err) {
      console.error("Error signing out user:", err);
      toast.error(MESSAGES.SOMETHING_WENT_WRONG);
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2" size="lg">
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name ?? user.email}
              width={32}
              height={32}
              className="rounded-full object-cover"
            />
          ) : (
            <User className="h-4 w-4" />
          )}

          <span className="sr-only md:not-sr-only md:block">{user.name ?? user.email}</span>

          <ChevronsUpDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-64 overflow-hidden p-0">
        {/* Brand accent - matches the bar on dialogs/popups across the app */}
        <div aria-hidden="true" className="h-1.5 w-full bg-primary" />

        {/* Identity */}
        <div className="flex items-center gap-3 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name ?? user.email}
                width={36}
                height={36}
                className="size-9 rounded-full object-cover"
              />
            ) : (
              <User className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{user.name ?? "User"}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <DropdownMenuSeparator className="my-0" />

        {/* Actions */}
        <div className="p-1">
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href={ROUTES.SETTINGS}>
              <Settings className="mr-2 size-4" />
              Settings
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={async () => {
              await handleSignOut();
            }}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 size-4" />
            Sign Out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
