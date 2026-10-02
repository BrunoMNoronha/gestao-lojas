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
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="p-3 bg-primary text-primary-foreground rounded-xl shadow-md">
            <Store className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Gestão de Lojas</h1>
          <p className="text-sm text-muted-foreground">Sistema de Gestão Comercial e PDV</p>
        </div>

        <Card className="shadow-lg border-border">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-xl">Acessar o Painel</CardTitle>
            <CardDescription>
              Informe suas credenciais para entrar no sistema
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" /> E-mail
                </label>
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Senha
                </label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full mt-2" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Entrando...
                  </>
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          <p>Gestão de Lojas ERP/PDV &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  );
}
