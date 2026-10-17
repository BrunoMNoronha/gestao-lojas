"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Monitor, Moon, Package, Search, Sun, UserRound, Users } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { getCustomerOptions, getProductOptions } from "@/actions/browse";
import type { ProductItem } from "@/actions/products";
import { type AppRole, can } from "@/lib/permissions";
import { type NavFeatures, routesFor } from "@/lib/routes";
import {
  openCommandPalette,
  setCommandPaletteOpen,
  useCommandPaletteOpen,
} from "@/lib/command-palette";
import { signOutClearingOfflineData } from "@/lib/offline/sign-out";
import { cn, formatCurrency } from "@/lib/utils";

interface CommandPaletteProps {
  user: { name: string; role: AppRole };
  features?: NavFeatures;
}

type CustomerOption = Awaited<ReturnType<typeof getCustomerOptions>>[number];

interface SearchResults {
  q: string;
  products: ProductItem[];
  customers: CustomerOption[];
  error: boolean;
}

const MIN_QUERY = 2;
const MAX_RESULTS = 6;

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// Filtro local das telas e ações: cada palavra digitada precisa ser o começo de uma palavra do
// rótulo ou das palavras-chave (sem acento e sem diferenciar maiúsculas), e o rótulo que começa
// com o termo vem primeiro. O fuzzy padrão do cmdk casava "sair" com "Contas a Receber" e não
// achava "relatorio" em "Relatórios".
function filterCommand(value: string, search: string, keywords?: string[]) {
  const terms = normalize(search).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  const label = normalize(value);
  const words = [label, ...(keywords ?? []).map(normalize)].join(" ").split(/[\s()/·-]+/);
  if (!terms.every((term) => words.some((word) => word.startsWith(term)))) return 0;
  return label.startsWith(terms[0]) ? 1 : 0.8;
}

// Paleta de comandos (Ctrl/Cmd+K): telas do menu, ações rápidas e busca de produtos e clientes.
// A lista de telas segue a mesma matriz de acesso da sidebar; as buscas usam Server Actions que
// já checam a permissão no servidor, aqui `can()` só evita consultas que voltariam vazias.
export function CommandPalette({ user, features }: CommandPaletteProps) {
  const open = useCommandPaletteOpen();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  // Item destacado (controlado): os resultados do servidor chegam depois que o cmdk já escolheu o
  // primeiro item, então sem tela/ação correspondente o primeiro produto/cliente é destacado aqui
  const [selected, setSelected] = useState("");

  const navItems = routesFor(user.role, features, { includeTopbar: true });
  const canProducts = can(user.role, "catalog.view");
  const canCustomers = can(user.role, "customers.view");
  const q = query.trim();
  const searching = q.length >= MIN_QUERY && (canProducts || canCustomers);
  const current = searching && results?.q === q ? results : null;
  const loading = searching && !current;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (e.repeat) return;
        if (open) {
          setQuery("");
          setResults(null);
          setSelected("");
        }
        setCommandPaletteOpen(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || !searching) return;
    let active = true;
    const timer = setTimeout(() => {
      void Promise.all([
        canProducts ? getProductOptions(q) : Promise.resolve([] as ProductItem[]),
        canCustomers ? getCustomerOptions(q) : Promise.resolve([] as CustomerOption[]),
      ])
        .then(([products, customers]) => {
          if (!active) return;
          setResults({ q, products, customers, error: false });
          const first = products[0]
            ? `produto-${products[0].id}`
            : customers[0]
              ? `cliente-${customers[0].id}`
              : "";
          if (first) setSelected((prev) => prev || first);
        })
        .catch(() => {
          if (active) setResults({ q, products: [], customers: [], error: true });
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, searching, q, canProducts, canCustomers]);

  function onOpenChange(next: boolean) {
    setCommandPaletteOpen(next);
    if (!next) {
      setQuery("");
      setResults(null);
      setSelected("");
    }
  }

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  const products = current?.products.slice(0, MAX_RESULTS) ?? [];
  const customers = current?.customers.slice(0, MAX_RESULTS) ?? [];
  const hasRemote = products.length > 0 || customers.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="sm:max-w-lg">
      <Command filter={filterCommand} value={selected} onValueChange={setSelected}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Buscar tela, ação, produto ou cliente…"
          aria-label="Buscar na paleta de comandos"
        />
        <CommandList className="max-h-[min(24rem,60vh)]">
          {!loading && !hasRemote && (
            <CommandEmpty>
              {current?.error ? "Não foi possível buscar agora." : "Nenhum resultado."}
            </CommandEmpty>
          )}

          <CommandGroup heading="Ir para">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  <Icon />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>

          {/* Resultados do servidor: já vêm filtrados, por isso forceMount ignora o filtro local */}
          {loading && (
            <p role="status" className="text-muted-foreground px-3 py-2 text-xs">
              Buscando…
            </p>
          )}
          {products.length > 0 && (
            <CommandGroup heading="Produtos" forceMount>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`produto-${p.id}`}
                  forceMount
                  onSelect={() =>
                    run(() =>
                      router.push(`/admin/produtos?q=${encodeURIComponent(p.sku || p.name)}`),
                    )
                  }
                >
                  <Package />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    {p.sku && <span className="text-muted-foreground"> · {p.sku}</span>}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatCurrency(p.salePrice)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {customers.length > 0 && (
            <CommandGroup heading="Clientes" forceMount>
              {customers.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`cliente-${c.id}`}
                  forceMount
                  onSelect={() =>
                    run(() => router.push(`/admin/clientes?q=${encodeURIComponent(c.name)}`))
                  }
                >
                  <Users />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {(c.document || c.phone) && (
                    <span className="text-muted-foreground text-xs">{c.document || c.phone}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandSeparator />
          <CommandGroup heading="Ações">
            <CommandItem
              value="Minha conta"
              keywords={["perfil", "senha", user.name]}
              onSelect={() => run(() => router.push("/admin/minha-conta"))}
            >
              <UserRound />
              Minha conta
            </CommandItem>
            <CommandItem
              value="Tema claro"
              keywords={["aparência", "light"]}
              data-checked={theme === "light"}
              onSelect={() => run(() => setTheme("light"))}
            >
              <Sun />
              Tema claro
            </CommandItem>
            <CommandItem
              value="Tema escuro"
              keywords={["aparência", "dark"]}
              data-checked={theme === "dark"}
              onSelect={() => run(() => setTheme("dark"))}
            >
              <Moon />
              Tema escuro
            </CommandItem>
            <CommandItem
              value="Tema do sistema"
              keywords={["aparência", "system", "automático"]}
              data-checked={!theme || theme === "system"}
              onSelect={() => run(() => setTheme("system"))}
            >
              <Monitor />
              Tema do sistema
            </CommandItem>
            <CommandItem
              value="Sair do sistema"
              keywords={["logout", "desconectar"]}
              onSelect={() => run(() => void signOutClearingOfflineData())}
            >
              <LogOut />
              Sair do sistema
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 border-t px-3 py-2 text-xs">
          <span>↑↓ navegar</span>
          <span>Enter abrir</span>
          <span>Esc fechar</span>
        </div>
      </Command>
    </CommandDialog>
  );
}

const subscribeNoop = () => () => {};

// Só no cliente: no servidor (e na hidratação) assume "Ctrl", depois troca para ⌘ no Mac
function useIsMac() {
  return useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );
}

export function CommandPaletteTrigger({
  variant,
  onClick,
  className,
}: {
  variant: "sidebar" | "icon";
  onClick?: () => void;
  className?: string;
}) {
  const isMac = useIsMac();

  function handleClick() {
    onClick?.();
    openCommandPalette();
  }

  if (variant === "icon") {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Abrir paleta de comandos"
        title="Buscar"
        className={className}
        onClick={handleClick}
      >
        <Search />
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      aria-label="Abrir paleta de comandos"
      aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
      className={cn("text-muted-foreground w-full justify-start gap-2 font-normal", className)}
      onClick={handleClick}
    >
      <Search />
      <span className="flex-1 text-left">Buscar…</span>
      <kbd className="bg-muted pointer-events-none rounded border px-1.5 font-mono text-[10px] font-medium">
        {isMac ? "⌘ K" : "Ctrl K"}
      </kbd>
    </Button>
  );
}
