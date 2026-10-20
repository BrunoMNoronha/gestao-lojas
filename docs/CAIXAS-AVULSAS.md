# Caixas e unidades avulsas

Cadastre a unidade avulsa como **UN** e a embalagem fechada como **CX**. No cadastro da caixa,
selecione o produto avulso e informe a quantidade inteira de unidades por caixa. Cada avulso tem
uma única caixa de origem nesta versão. Preços e saldos são próprios de cada apresentação.

Comprar três caixas é uma entrada de quantidade 3 no produto CX. A compra não cria três
cadastros. Com três caixas de 12 unidades, abrir uma caixa e vender uma lata deixa duas caixas
fechadas e 11 latas avulsas.

## Abertura física

No estoque, ADMIN e MANAGER podem usar **Abrir caixas**. No PDV, quem pode operar o terminal pode
confirmar a abertura sugerida quando faltam avulsas. A sugestão usa o mínimo de caixas necessário
e desconta as caixas que já estão no carrinho para venda inteira.

Confirmar declara que a embalagem foi aberta fisicamente. A abertura gera uma saída de caixas e
uma entrada de unidades, vinculadas pelo mesmo registro de conversão. Ela é independente da venda:
se o operador desistir de vender, as avulsas permanecem disponíveis. Não há remontagem automática
de caixas a partir das avulsas.

## Integridade e custos

A saída, a entrada e o registro da conversão são gravados juntos. A operação tem uma chave única
persistida no navegador para repetir uma tentativa cujo resultado ficou incerto, sem converter
duas vezes. O servidor valida o vínculo, o fator confirmado e o saldo, incluindo as caixas
reservadas pelo carrinho. Produtos excluídos não podem ser convertidos.

A conversão preserva os preços de venda e os custos de referência do cadastro. No histórico,
registra o custo total transferido da caixa e o rateio exato em centavos: custo-base por unidade
e número de unidades que recebem um centavo adicional. Por exemplo, custo de aquisição de R$ 56
para 12 unidades resulta em quatro unidades a R$ 4,66 e oito a R$ 4,67, totalizando R$ 56. Esse
registro não introduz controle de lotes nem um novo método de custo médio. O preço de venda da
caixa não determina o custo das avulsas. Custos permanecem restritos aos perfis de gestão.

## Conexão e recuperação

Abrir caixas exige conexão nesta versão. Em `/pdv`, as vendas pendentes devem ser enviadas e os
saldos locais atualizados antes da abertura. Pendências que impedem esse envio bloqueiam a abertura.
Depois da confirmação, a cópia local deve refletir a conversão antes de liberar as novas avulsas.
Se a atualização falhar, recuperar a mesma tentativa e sincronizar os saldos; não abrir outra caixa
para compensar uma resposta perdida.

Sem internet, continuam disponíveis as vendas de caixas fechadas e avulsas já conhecidas pela
cópia local. Conversões não entram na fila offline. Reembalagem, kits e abertura offline não fazem
parte desta versão.

## Validação

Os testes de integração usam somente PostgreSQL local descartável com `test` no nome e verificam
quantidades, histórico, custo total, repetição, concorrência, permissões e operações mistas. Os
testes unitários conferem a sugestão e a reserva de caixas; os testes de navegador exercitam o
cadastro, a confirmação física e a atualização dos saldos do PDV.

A migration deve ser aplicada junto da atualização do aplicativo. Use `pnpm db:deploy` no ambiente
alvo autorizado; a implementação não aplica migrations automaticamente ao banco da loja.
