// Constantes do reCAPTCHA do login compartilhadas entre o servidor (src/auth.ts,
// src/lib/recaptcha.ts) e a tela de login. Não importe nada de servidor aqui.

export const RECAPTCHA_LOGIN_ACTION = "login";

// Vão na URL de resposta do Auth.js (`code`), então não podem revelar se o e-mail existe.
export const LOGIN_ERROR_CODES = {
  recaptchaRejected: "recaptcha_rejected",
  recaptchaUnavailable: "recaptcha_unavailable",
  // Limite de tentativas (src/lib/login-rate-limit.ts): vale também para e-mails inexistentes
  tooManyAttempts: "too_many_attempts",
} as const;
