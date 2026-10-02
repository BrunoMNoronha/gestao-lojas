// Constantes do reCAPTCHA do login compartilhadas entre o servidor (src/auth.ts,
// src/lib/recaptcha.ts) e a tela de login. Não importe nada de servidor aqui.

export const RECAPTCHA_LOGIN_ACTION = "login";

// Vão na URL de resposta do Auth.js (`code`), então não podem revelar se o e-mail existe.
export const LOGIN_ERROR_CODES = {
  recaptchaRejected: "recaptcha_rejected",
  recaptchaUnavailable: "recaptcha_unavailable",
} as const;
