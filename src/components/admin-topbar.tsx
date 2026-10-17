"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ExternalLink,
  LogOut,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Brand, SidebarContent, type AdminNavProps } from "@/components/admin-sidebar";
import { CommandPaletteTrigger } from "@/components/command-palette";
import { InstallAppButton, useInstallAppAction } from "@/components/install-app-button";
import { signOutClearingOfflineData } from "@/lib/offline/sign-out";
import { ROLE_LABELS } from "@/lib/permissions";
import { topbarRoutesFor } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Barra superior fixa do painel: no celular, abre a navegação (gaveta), mostra a marca e a busca.
// Em todos os tamanhos traz os atalhos (PDV sem internet, sincronização offline, catálogo
// público), a instalação do app e o menu do usuário (Minha conta, tema e sair). No celular os
// atalhos ficam no botão "Mais opções".

interface Shortcut {
  href: string;
  label: string;
  icon: LucideIcon;
  // "document": carregamento completo (o /pdv fica fora do layout do painel e do roteador)
  // "external": abre em nova aba (catálogo público)
  kind: "link" | "document" | "external";
}

function useShortcuts({ user, features }: AdminNavProps): Shortcut[] {
  const routes = topbarRoutesFor(user.role, features).map<Shortcut>((route) => ({
    href: route.href,
    label: route.label,
    icon: route.icon,
    kind: route.href.startsWith("/admin") ? "link" : "document",
  }));
  if (features?.catalog) {
    routes.push({ href: "/catalogo", label: "Catálogo", icon: ExternalLink, kind: "external" });
  }
  return routes;
}

function ShortcutButton({ shortcut, active }: { shortcut: Shortcut; active: boolean }) {
  const Icon = shortcut.icon;
  const className = cn(
    buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }),
    "gap-1.5",
  );
  const content = (
    <>
      <Icon />
      {shortcut.label}
    </>
  );
  if (shortcut.kind === "document") {
    return (
      <a href={shortcut.href} className={className}>
        {content}
      </a>
    );
  }
  if (shortcut.kind === "external") {
    return (
      <a
        href={shortcut.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title="Abre o catálogo público em nova aba"
      >
        {content}
      </a>
    );
  }
  return (
    <Link
      href={shortcut.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {content}
    </Link>
  );
}

function ShortcutMenuItem({ shortcut }: { shortcut: Shortcut }) {
  const Icon = shortcut.icon;
  const content = (
    <>
      <Icon /> {shortcut.label}
    </>
  );
  if (shortcut.kind === "link") {
    return (
      <DropdownMenuItem render={<Link href={shortcut.href} prefetch={false} />}>
        {content}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      render={
        shortcut.kind === "external" ? (
          <a href={shortcut.href} target="_blank" rel="noopener noreferrer" />
        ) : (
          <a href={shortcut.href} />
        )
      }
    >
      {content}
    </DropdownMenuItem>
  );
}

// Celular e tablet: atalhos e instalação num só menu
function MoreMenu({ shortcuts }: { shortcuts: Shortcut[] }) {
  const install = useInstallAppAction();
  const InstallIcon = install.icon;
  if (shortcuts.length === 0 && !install.visible) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="Mais opções" title="Mais" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            {shortcuts.map((shortcut) => (
              <ShortcutMenuItem key={shortcut.href} shortcut={shortcut} />
            ))}
            {install.visible && (
              <DropdownMenuItem disabled={install.busy} onClick={() => install.run()}>
                <InstallIcon /> {install.label}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {install.dialog}
    </>
  );
}

function UserMenu({ user }: Pick<AdminNavProps, "user">) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="gap-2 px-2"
            aria-label={`Menu do usuário: ${user.name}`}
          />
        }
      >
        <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
          <UserRound className="size-4" />
        </span>
        <span className="hidden max-w-40 truncate text-sm font-medium lg:inline">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="text-foreground block truncate text-sm">{user.name}</span>
            <span className="block">{ROLE_LABELS[user.role]}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/admin/minha-conta" prefetch={false} />}>
            <UserRound /> Minha conta
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Sun className="dark:hidden" />
              <Moon className="hidden dark:block" />
              Tema
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(v)}>
                <DropdownMenuRadioItem value="light">
                  <Sun /> Claro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon /> Escuro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <Monitor /> Sistema
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => signOutClearingOfflineData()}>
          <LogOut /> Sair do sistema
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AdminTopbar(props: AdminNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const shortcuts = useShortcuts(props);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-40 flex h-14 items-center gap-2 border-b px-3 backdrop-blur lg:px-6">
      {/* Celular e tablet: navegação em gaveta, marca e busca */}
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <Button variant="ghost" size="icon" aria-label="Abrir menu" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <SheetContent side="left" className="bg-sidebar text-sidebar-foreground w-72 gap-0 p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Navegação do painel administrativo
            </SheetDescription>
            <SidebarContent {...props} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <Brand storeName={props.storeName} />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <nav aria-label="Atalhos" className="hidden items-center gap-1 lg:flex">
          {shortcuts.map((shortcut) => (
            <ShortcutButton
              key={shortcut.href}
              shortcut={shortcut}
              active={shortcut.kind === "link" && isActive(shortcut.href)}
            />
          ))}
          <InstallAppButton variant="topbar" />
        </nav>
        <CommandPaletteTrigger variant="icon" className="lg:hidden" />
        <div className="lg:hidden">
          <MoreMenu shortcuts={shortcuts} />
        </div>
        <UserMenu user={props.user} />
      </div>
    </header>
  );
}
