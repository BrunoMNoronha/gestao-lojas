import { connection } from "next/server";
import { getQuickLoginOptions } from "@/lib/quick-login";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // Dados pré-login privados do ambiente: jamais pré-renderizar/cachear a lista no build.
  await connection();
  const quickLogin = await getQuickLoginOptions();
  return (
    <LoginForm siteKey={process.env.RECAPTCHA_SITE_KEY || undefined} quickLogin={quickLogin} />
  );
}
