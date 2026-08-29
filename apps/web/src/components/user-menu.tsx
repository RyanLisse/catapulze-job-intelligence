import { Button } from "@ji/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ji/ui/components/dropdown-menu";
import { Skeleton } from "@ji/ui/components/skeleton";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-11 w-20" />;
  }

  if (!session) {
    return (
      <Button
        render={<Link href="/login" />}
        nativeButton={false}
        variant="ghost"
        className="h-11 px-3 text-white/72 hover:bg-white/10 hover:text-white"
      >
        Inloggen
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="h-11 text-white/72" />}
      >
        {session.user.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mijn account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    router.push("/");
                  },
                },
              });
            }}
          >
            Uitloggen
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
