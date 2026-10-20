// Preload do servidor nos testes de navegador (NODE_OPTIONS=--import): responde ao `siteverify`
// do reCAPTCHA sem acessar o Google, aprovando o login com score alto. Nenhum código de teste
// entra no produto; as demais requisições seguem para o fetch original.
const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(SITEVERIFY_URL)) {
    return Response.json({ success: true, score: 0.9, action: "login", hostname: "localhost" });
  }
  return originalFetch(input, init);
};
