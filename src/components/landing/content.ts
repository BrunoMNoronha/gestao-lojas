import {
  Banknote,
  BarChart3,
  Boxes,
  Command,
  HandCoins,
  MessageCircle,
  Moon,
  Package,
  Palette,
  ScanBarcode,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SCREENSHOTS, type Screenshot } from "./screenshots";

// Textos da landing page (src/app/page.tsx). Só o que o sistema faz hoje: nada de números
// inventados ou depoimentos.

export const NAV_LINKS = [
  { href: "#demonstracao", label: "Demonstração" },
  { href: "#funcionalidades", label: "Funcionalidades" },
  { href: "#offline", label: "PDV offline" },
  { href: "#celular", label: "Celular" },
  { href: "#perfis", label: "Perfis" },
  { href: "#duvidas", label: "Dúvidas" },
] as const;

export const AUDIENCES = ["Lojas físicas", "Mercados", "Agropecuárias", "Distribuidores"] as const;

export const HIGHLIGHTS = [
  { value: "F2 · F4 · F8 · F10", label: "Venda inteira pelo teclado" },
  { value: "Até 12 h", label: "Vendendo sem internet" },
  { value: "5 formas", label: "Dinheiro, PIX, crédito, débito e fiado" },
  { value: "3 perfis", label: "Administrador, gerente e vendedor" },
] as const;

export interface Feature {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  shot: Screenshot;
  /** Captura de celular sobreposta à do painel. */
  phone?: Screenshot;
}

export const FEATURES: Feature[] = [
  {
    id: "pdv",
    icon: ScanBarcode,
    eyebrow: "Frente de caixa",
    title: "Um PDV feito para fila de balcão",
    description:
      "Busque por nome, código interno ou código de barras, inclusive com a câmera do celular, e feche a venda sem tirar a mão do teclado.",
    bullets: [
      "Atalhos F2 (buscar), F4 (cliente), F8 (desconto) e F10 (finalizar)",
      "Quantidade fracionada para itens vendidos por quilo, litro ou metro",
      "Comprovante pronto para imprimir ao confirmar a venda",
      "Pedidos do catálogo online entram direto no carrinho",
    ],
    shot: SCREENSHOTS.pdv,
  },
  {
    id: "caixa",
    icon: Banknote,
    eyebrow: "Caixa",
    title: "Abertura, sangria e fechamento sem planilha",
    description:
      "Cada operador abre o próprio caixa e o sistema calcula o saldo esperado. No fechamento, a diferença aparece na hora.",
    bullets: [
      "Suprimento e sangria com motivo registrado",
      "Vendas e recebimentos separados por forma de pagamento",
      "Histórico de caixas com valor contado e diferença",
    ],
    shot: SCREENSHOTS.caixa,
  },
  {
    id: "estoque",
    icon: Boxes,
    eyebrow: "Estoque",
    title: "Saldo certo, do fornecedor à prateleira",
    description:
      "Entradas com custo e fornecedor, ajustes com motivo e baixa automática a cada venda. O estoque mínimo avisa antes de faltar.",
    bullets: [
      "Abra uma caixa fechada em unidades avulsas, com custo proporcional",
      "Histórico de movimentações por produto",
      "Alerta de produtos abaixo do estoque mínimo",
    ],
    shot: SCREENSHOTS.estoque,
  },
  {
    id: "produtos",
    icon: Package,
    eyebrow: "Produtos",
    title: "Cadastro com margem calculada",
    description:
      "Preço de custo, preço de venda e margem lado a lado, com categorias, código de barras e unidade de venda.",
    bullets: [
      "Unidades UN, KG, LT, CX e M",
      "Margem de lucro padrão definida nas configurações da loja",
      "Escolha quais produtos aparecem no catálogo online",
    ],
    shot: SCREENSHOTS.produtos,
  },
  {
    id: "relatorios",
    icon: BarChart3,
    eyebrow: "Relatórios",
    title: "Vendas por período e por operador",
    description:
      "Filtre o período, veja os totais por forma de pagamento e abra qualquer venda para reimprimir o comprovante ou estornar.",
    bullets: [
      "Detalhe de cada venda com itens, cliente e operador",
      "Estorno com motivo, que devolve o estoque e ajusta o caixa",
      "Painel com as vendas de hoje, da semana e do mês",
    ],
    shot: SCREENSHOTS.relatorios,
  },
  {
    id: "fiado",
    icon: HandCoins,
    eyebrow: "Contas a receber",
    title: "Fiado sob controle",
    description:
      "Venda no fiado para clientes cadastrados e acompanhe cada título até a quitação, com pagamentos parciais.",
    bullets: [
      "Prazo de vencimento e limite de crédito configuráveis",
      "Bloqueio opcional para clientes com título vencido",
      "Recebimentos entram no caixa do operador",
    ],
    shot: SCREENSHOTS.contasAReceber,
  },
  {
    id: "catalogo",
    icon: MessageCircle,
    eyebrow: "Catálogo online",
    title: "Sua vitrine na internet, com pedido pelo WhatsApp",
    description:
      "O cliente monta o carrinho no catálogo público da loja e envia o pedido pelo WhatsApp. No painel, o pedido vira venda no PDV com um clique.",
    bullets: [
      "Busca, categorias e filtro de disponíveis",
      "Mostra só “Disponível” ou “Indisponível”, nunca o saldo do estoque",
      "Cadastro do cliente do pedido com checagem de duplicidade",
    ],
    shot: SCREENSHOTS.pedidos,
    phone: SCREENSHOTS.mobileCatalogo,
  },
];

export const OFFLINE_STEPS = [
  {
    title: "Prepare o aparelho",
    description:
      "Com internet, o PDV guarda no aparelho os produtos, preços e clientes do operador, junto com uma autorização de até 12 horas.",
  },
  {
    title: "Venda sem rede",
    description:
      "Se a conexão cair, a venda continua: cada venda entra numa fila no aparelho, com recibo provisório. O carrinho resiste até a recarregar a página.",
  },
  {
    title: "Sincronize e confira",
    description:
      "Quando a internet volta, as vendas sobem sozinhas. O que divergir, como preço alterado ou estoque negativo, fica para o gerente aprovar ou descartar.",
  },
] as const;

export const ROLES = [
  {
    title: "Administrador",
    icon: ShieldCheck,
    description: "Dono da loja: vê e configura tudo.",
    can: [
      "Configurações da loja, catálogo e fiado",
      "Cadastro de usuários e perfis",
      "Tudo o que o gerente faz",
    ],
  },
  {
    title: "Gerente",
    icon: BarChart3,
    description: "Cuida da operação do dia a dia.",
    can: [
      "Painel, relatórios e estorno de vendas",
      "Produtos, estoque e fornecedores",
      "Caixas dos operadores e conciliação offline",
    ],
  },
  {
    title: "Vendedor",
    icon: ScanBarcode,
    description: "Atende o balcão sem acesso ao que não precisa.",
    can: [
      "Frente de caixa, online e sem internet",
      "O próprio caixa e os recebimentos do fiado",
      "Consulta de produtos, estoque e clientes",
    ],
  },
] as const;

export const MORE_FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Command,
    title: "Busca por comandos",
    description: "Ctrl+K abre qualquer tela ou ação do painel pelo nome.",
  },
  {
    icon: Smartphone,
    title: "App instalável",
    description: "Instale no computador, no Android ou no iPhone, com atalho direto para o PDV.",
  },
  {
    icon: Moon,
    title: "Modo escuro",
    description: "Claro, escuro ou automático, conforme o sistema do aparelho.",
  },
  {
    icon: Users,
    title: "Clientes",
    description: "Cadastro com documento, telefone e endereço, usado no fiado e nos pedidos.",
  },
  {
    icon: Truck,
    title: "Fornecedores",
    description: "Vincule as entradas de mercadoria ao fornecedor e ao custo pago.",
  },
  {
    icon: Palette,
    title: "Com a cara da sua loja",
    description: "Nome, endereço, redes sociais e mensagem do comprovante configuráveis.",
  },
];

export const FAQ = [
  {
    question: "Preciso de internet para vender?",
    answer:
      "Não o tempo todo. Prepare o PDV com internet uma vez por turno e ele continua vendendo por até 12 horas sem conexão. As vendas ficam guardadas no aparelho e sobem sozinhas quando a rede volta. O fiado é a única forma de pagamento que exige conexão.",
  },
  {
    question: "Funciona no celular?",
    answer:
      "Sim. Todas as telas se adaptam ao celular: o carrinho do PDV vira lista com barra fixa para finalizar, a lista de produtos vira cartões e a câmera lê o código de barras. Também dá para instalar como app.",
  },
  {
    question: "Cada funcionário vê só o que precisa?",
    answer:
      "Sim. Há três perfis (administrador, gerente e vendedor) e cada tela confere a permissão no servidor, não só no menu. O vendedor não vê relatórios, configurações nem usuários.",
  },
  {
    question: "Como o cliente faz um pedido pelo catálogo?",
    answer:
      "Ele abre o catálogo público da loja, escolhe os produtos e envia o pedido pelo WhatsApp da loja. O link do pedido abre no painel, onde a equipe registra o pedido e o converte em venda no PDV.",
  },
  {
    question: "Que tipo de loja pode usar?",
    answer:
      "Qualquer comércio com balcão: mercados, agropecuárias, distribuidores e lojas em geral. Há venda por unidade, quilo, litro, metro e caixa, inclusive abrindo caixas fechadas em unidades avulsas.",
  },
] as const;
