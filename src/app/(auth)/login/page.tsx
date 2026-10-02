"use client";

import { useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Store, Lock, Mail, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isAppRole } from "@/lib/permissions";
import { landingPathFor, safeInternalPath } from "@/lib/routes";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError("Credenciais inválidas. Verifique seu e-mail e senha.");
      } else {
        // Vai para a página pedida (callbackUrl interno e permitido ao perfil) ou para a inicial
        const session = await getSession();
        const role = isAppRole(session?.user?.role) ? session.user.role : null;
        const requested = safeInternalPath(
          new URLSearchParams(window.location.search).get("callbackUrl"),
          window.location.origin,
        );
        router.push(landingPathFor(role, requested));
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setError("Ocorreu um erro ao tentar realizar o login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-muted/40 relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="bg-primary text-primary-foreground rounded-xl p-3 shadow-md">
            <Store className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Gestão de Lojas</h1>
          <p className="text-muted-foreground text-sm">Sistema de Gestão Comercial e PDV</p>
        </div>

        <Card className="border-border shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-xl">Acessar o Painel</CardTitle>
            <CardDescription>Informe suas credenciais para entrar no sistema</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div
                role="alert"
                className="text-destructive bg-destructive/10 border-destructive/20 mb-4 flex items-center gap-2 rounded-md border p-3 text-sm"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="login-e-mail"
                  className="text-foreground flex items-center gap-1.5 text-xs font-medium"
                >
                  <Mail className="text-muted-foreground h-3.5 w-3.5" /> E-mail
                </Label>
                <Input
                  id="login-e-mail"
                  type="email"
                  autoComplete="username"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="login-senha"
                  className="text-foreground flex items-center gap-1.5 text-xs font-medium"
                >
                  <Lock className="text-muted-foreground h-3.5 w-3.5" /> Senha
                </Label>
                <Input
                  id="login-senha"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="mt-2 w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Entrando...
                  </>
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-muted-foreground text-center text-xs">
          <p>Gestão de Lojas ERP/PDV &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  );
}
