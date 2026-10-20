import type { StaticImageData } from "next/image";
import caixa from "./screenshots/caixa.png";
import contasAReceber from "./screenshots/contas-a-receber.png";
import dashboardDark from "./screenshots/dashboard-dark.png";
import dashboard from "./screenshots/dashboard.png";
import estoque from "./screenshots/estoque.png";
import mobileCatalogo from "./screenshots/mobile-catalogo.png";
import mobilePdv from "./screenshots/mobile-pdv.png";
import mobileProdutos from "./screenshots/mobile-produtos.png";
import pdvDark from "./screenshots/pdv-dark.png";
import pdvOffline from "./screenshots/pdv-offline.png";
import pdv from "./screenshots/pdv.png";
import pedidos from "./screenshots/pedidos.png";
import produtos from "./screenshots/produtos.png";
import insights from "./screenshots/insights.png";
import relatorios from "./screenshots/relatorios.png";

// Capturas reais do sistema com uma loja fictícia, geradas por `pnpm screenshots`
// (tests/screenshots/capture.spec.ts). Import estático: o next/image recebe largura, altura e
// blur prontos, e as imagens ficam fora de public/ (o Service Worker não as pré-baixa).

export interface Screenshot {
  src: StaticImageData;
  /** Versão no tema escuro, quando existe. */
  dark?: StaticImageData;
  alt: string;
}

export const SCREENSHOTS = {
  dashboard: {
    src: dashboard,
    dark: dashboardDark,
    alt: "Painel de controle com as vendas de hoje, da semana e do mês, fiado em aberto e pedidos do catálogo",
  },
  pdv: {
    src: pdv,
    dark: pdvDark,
    alt: "Frente de caixa com produtos no carrinho, total da venda e atalhos de teclado F2, F4, F8 e F10",
  },
  caixa: {
    src: caixa,
    alt: "Tela de caixa com o valor de abertura, suprimentos, sangrias, vendas por forma de pagamento e saldo esperado",
  },
  estoque: {
    src: estoque,
    alt: "Controle de estoque com saldo por produto, alerta de estoque mínimo e últimas movimentações",
  },
  produtos: {
    src: produtos,
    alt: "Cadastro de produtos com preço de custo, preço de venda, margem, unidade e categoria",
  },
  relatorios: {
    src: relatorios,
    alt: "Relatório de vendas filtrado por período e operador, com totais por forma de pagamento",
  },
  insights: {
    src: insights,
    alt: "Insights do Claude com resumo do mês, alertas de estoque e fiado, destaques, oportunidades e ações sugeridas",
  },
  contasAReceber: {
    src: contasAReceber,
    alt: "Contas a receber do fiado com títulos em aberto, parciais e vencimentos por cliente",
  },
  pedidos: {
    src: pedidos,
    alt: "Pedidos recebidos pelo catálogo online, com cliente, itens e valor estimado, prontos para o PDV",
  },
  pdvOffline: {
    src: pdvOffline,
    alt: "PDV sem internet com o indicador de conexão no topo e uma venda em andamento",
  },
  mobileCatalogo: {
    src: mobileCatalogo,
    alt: "Catálogo online da loja no celular, com busca, categorias e produtos disponíveis",
  },
  mobilePdv: {
    src: mobilePdv,
    alt: "Frente de caixa no celular com o carrinho em lista e a barra fixa para finalizar a venda",
  },
  mobileProdutos: {
    src: mobileProdutos,
    alt: "Lista de produtos no celular em cartões, com preço e estoque de cada item",
  },
} satisfies Record<string, Screenshot>;
