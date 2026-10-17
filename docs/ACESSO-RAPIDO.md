# Acesso rápido fora de produção

A tela de login pode mostrar usuários ativos cadastrados (nome, e-mail e perfil). Selecionar um
usuário cria uma sessão normal do Auth.js, sem digitar senha. O usuário conserva suas permissões.
O formulário com senha continua disponível. A lista não cria usuários automaticamente.

## Ativação local

No ambiente do processo ou em arquivo `.env` ignorado pelo Git:

```dotenv
APP_ENV=local
ENABLE_DEV_QUICK_LOGIN=true
DEV_QUICK_LOGIN_DATABASE=localhost:5433/gestao_lojas
```

O último valor deve corresponder exatamente ao `host[:porta]/banco` da `DATABASE_URL` já existente,
sem senha, usuário ou parâmetros de conexão. Reinicie o servidor após mudar a configuração.
Use um banco local isolado e `AUTH_SECRET` próprio; não reutilize banco nem segredo de produção.
Nunca copie a configuração de acesso rápido para produção.

## Política do servidor

| Configuração                                                             | Resultado                        |
| ------------------------------------------------------------------------ | -------------------------------- |
| Flag ausente ou diferente de `true`                                      | Bloqueado                        |
| `APP_ENV` ausente, desconhecido ou `production`                          | Bloqueado                        |
| `VERCEL_ENV` ou `VERCEL_TARGET_ENV` igual a `production`                 | Bloqueado, mesmo com flag ligada |
| Sinal Vercel desconhecido ou incompatível com `APP_ENV`                  | Bloqueado                        |
| `APP_ENV=local` ou `test` com banco fora de loopback                     | Bloqueado                        |
| Banco diferente de `DEV_QUICK_LOGIN_DATABASE` ou URL inválida            | Bloqueado                        |
| Configuração válida não produtiva, inclusive build `NODE_ENV=production` | Permitido                        |

Na Vercel, `VERCEL_ENV=preview` requer `APP_ENV=preview`; `development` requer `APP_ENV=local`.
Homologação em outro provedor usa `APP_ENV=homologation`. Preview/homologação devem usar banco
isolado cujo destino seja explicitamente confirmado por `DEV_QUICK_LOGIN_DATABASE`, além de
segredo de sessão exclusivo. Essa declaração é configuração administrativa, não uma detecção
mágica do conteúdo do banco: o operador deve confirmar que o destino não é produção.

O provider `dev-quick-login` aplica a mesma política mesmo quando chamado diretamente.
Ele consulta novamente a situação e o perfil do usuário; inativos e usuários removidos são
recusados. A senha e o reCAPTCHA do provider convencional permanecem obrigatórios conforme sua
configuração existente. O atalho usa POST e a proteção CSRF do Auth.js.

Sessões do atalho carregam um marcador de origem no JWT. Desativar a flag, mudar de ambiente ou
mudar o destino do banco invalida essas sessões na próxima requisição. Sessões convencionais
não recebem esse marcador. O isolamento do PDV por operador permanece vigente.

Para desativar, remova `ENABLE_DEV_QUICK_LOGIN` ou use `false` e reinicie o processo.
Nenhuma migration é necessária. O recurso vem desligado por padrão.

## Validação

Testes unitários cobrem a matriz de ambiente; integração verifica dados mínimos, revalidação do
usuário e invalidação de JWT. Para o navegador, usando apenas PostgreSQL local descartável:

```powershell
$env:E2E_QUICK_LOGIN_MODE='enabled'
pnpm test:e2e:run tests/e2e/quick-login.spec.ts --project=chromium
$env:E2E_QUICK_LOGIN_MODE='production'
pnpm test:e2e:run tests/e2e/quick-login.spec.ts --project=chromium
```

As duas execuções usam o mesmo build otimizado e as variáveis de teste do Playwright; a segunda
comprova o veto de produção mesmo com a flag ligada. Execute `pnpm build` antes e configure
`TEST_DATABASE_URL` conforme o README. Nunca use o banco real nesses testes.
