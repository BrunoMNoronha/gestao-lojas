// Destino do login quando a sessão existe, mas não vale mais (usuário desativado ou removido
// depois do login). O parâmetro impede que o proxy mande de volta para "/" quem ainda tem o cookie
// válido: sem ele, "/" (perfil atual do banco: nenhum) e "/login" (cookie válido) se alternariam
// sem fim.
export const INVALID_SESSION_PARAM = "sessao";
export const INVALID_SESSION_LOGIN = `/login?${INVALID_SESSION_PARAM}=invalida`;
