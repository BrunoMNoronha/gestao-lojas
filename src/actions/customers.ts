"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { Prisma, ReceivableStatus } from "@prisma/client";
import {
  documentLookupValues,
  maskedSearchTerms,
  normalizeDocument,
  normalizePhone,
} from "@/lib/masks";

export interface CustomerItem {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    sales: number;
  };
}

export interface CustomerInput {
  id?: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

// Campos devolvidos ao cliente após criar/editar (sem deletedAt e syncVersion)
const CUSTOMER_SELECT = {
  id: true,
  name: true,
  document: true,
  phone: true,
  email: true,
  address: true,
  createdAt: true,
  updatedAt: true,
} as const;
const CUSTOMER_NOT_FOUND = "Cliente não encontrado. Ele pode ter sido excluído; atualize a tela.";

// update com `where: { id, deletedAt: null }` lança P2025 quando o cliente não existe ou foi excluído
const isNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

export async function getCustomers(searchQuery?: string): Promise<CustomerItem[]> {
  try {
    const authz = await authorize("customers.view");
    if (!authz.ok) return [];

    // Clientes excluídos (exclusão lógica) não aparecem nas listagens
    const whereClause: Prisma.CustomerWhereInput = { deletedAt: null };

    if (searchQuery && searchQuery.trim() !== "") {
      const q = searchQuery.trim();
      // Documento e telefone ficam sem pontuação: busca pelo texto digitado e pela versão sem máscara
      const terms = maskedSearchTerms(q);
      whereClause.OR = [
        { name: { contains: q, mode: "insensitive" } },
        ...terms.map((term) => ({ document: { contains: term, mode: "insensitive" as const } })),
        ...terms.map((term) => ({ phone: { contains: term, mode: "insensitive" as const } })),
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    const customers = await prisma.customer.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { sales: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      document: c.document,
      phone: c.phone,
      email: c.email,
      address: c.address,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      _count: c._count,
    }));
  } catch (error) {
    console.error("Erro ao buscar clientes:", error);
    return [];
  }
}

export async function createCustomer(data: CustomerInput) {
  try {
    const authz = await authorize("customers.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const name = data.name?.trim();
    if (!name) {
      return { success: false, error: "O nome do cliente é obrigatório." };
    }

    // CPF/CNPJ e telefone são gravados sem pontuação
    const normalizedDocument = normalizeDocument(data.document);
    if (!normalizedDocument.ok) return { success: false, error: normalizedDocument.error };
    const normalizedPhone = normalizePhone(data.phone);
    if (!normalizedPhone.ok) return { success: false, error: normalizedPhone.error };
    const document = normalizedDocument.value;
    const phone = normalizedPhone.value;
    const email = data.email?.trim() || null;
    const address = data.address?.trim() || null;

    if (document) {
      const existingDocument = await prisma.customer.findFirst({
        where: { document: { in: documentLookupValues(document) }, deletedAt: null },
      });
      if (existingDocument) {
        return {
          success: false,
          error: "Já existe um cliente cadastrado com este documento (CPF/CNPJ).",
        };
      }
    }

    const newCustomer = await prisma.customer.create({
      data: {
        name,
        document,
        phone,
        email,
        address,
      },
      select: CUSTOMER_SELECT,
    });

    revalidatePath("/admin/clientes");
    return { success: true, data: newCustomer };
  } catch (error) {
    console.error("Erro ao criar cliente:", error);
    return { success: false, error: "Falha ao criar o cliente." };
  }
}

export async function updateCustomer(id: string, data: CustomerInput) {
  try {
    const authz = await authorize("customers.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const name = data.name?.trim();
    if (!name) {
      return { success: false, error: "O nome do cliente é obrigatório." };
    }

    // CPF/CNPJ e telefone são gravados sem pontuação
    const normalizedDocument = normalizeDocument(data.document);
    if (!normalizedDocument.ok) return { success: false, error: normalizedDocument.error };
    const normalizedPhone = normalizePhone(data.phone);
    if (!normalizedPhone.ok) return { success: false, error: normalizedPhone.error };
    const document = normalizedDocument.value;
    const phone = normalizedPhone.value;
    const email = data.email?.trim() || null;
    const address = data.address?.trim() || null;

    if (document) {
      const existingDocument = await prisma.customer.findFirst({
        where: {
          document: { in: documentLookupValues(document) },
          deletedAt: null,
          NOT: { id },
        },
      });
      if (existingDocument) {
        return { success: false, error: "Outro cliente já possui este documento (CPF/CNPJ)." };
      }
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id, deletedAt: null },
      data: {
        name,
        document,
        phone,
        email,
        address,
      },
      select: CUSTOMER_SELECT,
    });

    revalidatePath("/admin/clientes");
    return { success: true, data: updatedCustomer };
  } catch (error) {
    if (isNotFound(error)) return { success: false, error: CUSTOMER_NOT_FOUND };
    console.error("Erro ao atualizar cliente:", error);
    return { success: false, error: "Falha ao atualizar o cliente." };
  }
}

export async function deleteCustomer(id: string) {
  try {
    const authz = await authorize("customers.delete");
    if (!authz.ok) return { success: false, error: authz.error };

    // Vendas antigas não impedem mais a exclusão (o histórico é mantido); Fiado em aberto, sim
    const openReceivables = await prisma.receivable.count({
      where: {
        customerId: id,
        status: { in: [ReceivableStatus.OPEN, ReceivableStatus.PARTIAL] },
      },
    });

    if (openReceivables > 0) {
      return {
        success: false,
        error: `Não é possível excluir este cliente pois existem ${openReceivables} título(s) de Fiado em aberto.`,
      };
    }

    // Exclusão lógica: o PDV offline recebe a exclusão na próxima sincronização
    await prisma.customer.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    revalidatePath("/admin/clientes");
    return { success: true };
  } catch (error) {
    if (isNotFound(error)) return { success: false, error: CUSTOMER_NOT_FOUND };
    console.error("Erro ao excluir cliente:", error);
    return { success: false, error: "Falha ao excluir o cliente." };
  }
}
