"use client";

import { useState, useSyncExternalStore } from "react";
import Script from "next/script";
import { getSession, signIn } from "next-auth/react";
import { Store, Lock, Mail, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isAppRole } from "@/lib/permissions";
import { landingPathFor, safeInternalPath } from "@/lib/routes";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { LOGIN_ERROR_CODES, RECAPTCHA_LOGIN_ACTION } from "@/lib/recaptcha-shared";
import { INVALID_SESSION_PARAM } from "@/lib/login-paths";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

const MESSAGES = {
  credentials: "Credenciais inválidas. Verifique seu e-mail e senha.",
  recaptchaRejected:
    "A verificação de segurança falhou. Tente novamente; se o problema continuar, recarregue a página.",
  recaptchaUnavailable:
    "Não foi possível concluir a verificação de segurança agora. Aguarde alguns instantes e tente novamente.",
  recaptchaLoad: "Não foi possível carregar a verificação de segurança. Recarregue a página.",
};

type RecaptchaStatus = "disabled" | "loading" | "ready" | "error";

// reCAPTCHA v3 (invisível). Sem a chave do site (desenvolvimento), o script não é carregado e o
// servidor decide se aceita o login sem verificação (ver src/lib/recaptcha.ts).
const INVALID_SESSION_MESSAGE =
  "Sua sessão não vale mais (usuário desativado ou alterado). Entre novamente.";
const noSubscription = () => () => {};

export function LoginForm({ siteKey }: { siteKey?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sessão recusada pelo servidor (usuário desativado depois do login): explica o retorno ao login
  const invalidSession = useSyncExternalStore(
    noSubscription,
    () => new URLSearchParams(window.location.search).has(INVALID_SESSION_PARAM),
    () => false,
  );
  const message = error ?? (invalidSession ? INVALID_SESSION_MESSAGE : null);
  const [recaptchaStatus, setRecaptchaStatus] = useState<RecaptchaStatus>(
    siteKey ? "loading" : "disabled",
  );

  const handleRecaptchaReady = () => {
    if (window.grecaptcha) {
      window.grecaptcha.ready(() => setRecaptchaStatus("ready"));
    } else {
      setRecaptchaStatus("error");
      setError(MESSAGES.recaptchaLoad);
    }
  };

  const handleRecaptchaError = () => {
    setRecaptchaStatus("error");
    setError(MESSAGES.recaptchaLoad);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    let navigating = false;

    try {
      // Um token novo a cada envio: o Google aceita cada token uma única vez.
      let recaptchaToken: string | undefined;
      if (siteKey) {
        try {
          recaptchaToken = await window.grecaptcha!.execute(siteKey, {
            action: RECAPTCHA_LOGIN_ACTION,
          });
        } catch (err) {
          console.error(err);
          setError(MESSAGES.recaptchaLoad);
          return;
        }
      }

      const res = await signIn("credentials", {
        email,
        password,
        ...(recaptchaToken ? { recaptchaToken } : {}),
        redirect: false,
      });

      if (res?.error) {
        if (res.code === LOGIN_ERROR_CODES.recaptchaRejected) {
          setError(MESSAGES.recaptchaRejected);
        } else if (res.code === LOGIN_ERROR_CODES.recaptchaUnavailable) {
          setError(MESSAGES.recaptchaUnavailable);
        } else {
          setError(MESSAGES.credentials);
        }
      } else {
        // Vai para a página pedida (callbackUrl interno e permitido ao perfil) ou para a inicial
        const session = await getSession();
        const role = isAppRole(session?.user?.role) ? session.user.role : null;
        const requested = safeInternalPath(
          new URLSearchParams(window.location.search).get("callbackUrl"),
          window.location.origin,
        );
        // Navegação completa (e não router.push): descarrega o script do reCAPTCHA, que assim não
        // continua ativo nas páginas do painel.
        navigating = true;
        window.location.assign(landingPathFor(role, requested));
      }
    } catch (err) {
      console.error(err);
      setError("Ocorreu um erro ao tentar realizar o login.");
    } finally {
      if (!navigating) setLoading(false);
    }
  };

  const waitingRecaptcha = recaptchaStatus === "loading";

  return (
    <div className="bg-muted/40 relative flex min-h-screen items-center justify-center p-4">
      {siteKey && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`}
          strategy="afterInteractive"
          onReady={handleRecaptchaReady}
          onError={handleRecaptchaError}
        />
      )}
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
            {message && (
              <div
                role="alert"
                className="text-destructive bg-destructive/10 border-destructive/20 mb-4 flex items-center gap-2 rounded-md border p-3 text-sm"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{message}</span>
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

              <Button
                type="submit"
                className="mt-2 w-full"
                disabled={loading || waitingRecaptcha || recaptchaStatus === "error"}
              >
                {loading || waitingRecaptcha ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {loading ? "Entrando..." : "Carregando verificação..."}
                  </>
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>

            {siteKey && (
              // Obrigatório pelo Google porque o selo flutuante do reCAPTCHA fica oculto (globals.css)
              <p className="text-muted-foreground mt-4 text-center text-xs leading-relaxed">
                Este site é protegido pelo reCAPTCHA e se aplicam a{" "}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground underline underline-offset-2"
                >
                  Política de Privacidade
                </a>{" "}
                e os{" "}
                <a
                  href="https://policies.google.com/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground underline underline-offset-2"
                >
                  Termos de Serviço
                </a>{" "}
                do Google.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="text-muted-foreground text-center text-xs">
          <p>Gestão de Lojas ERP/PDV &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  );
}
