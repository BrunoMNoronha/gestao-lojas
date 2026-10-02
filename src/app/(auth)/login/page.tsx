import { LoginForm } from "./login-form";

// A chave do site do reCAPTCHA é pública, mas é lida no servidor (RECAPTCHA_SITE_KEY) e repassada
// ao formulário, sem depender de variável NEXT_PUBLIC_.
export default function LoginPage() {
  return <LoginForm siteKey={process.env.RECAPTCHA_SITE_KEY || undefined} />;
}
