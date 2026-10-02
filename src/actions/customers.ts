"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
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

export async function getCustomers(searchQuery?: string): Promise<CustomerItem[]> {
  try {
    const authz = await authorize("customers.view");
    if (!authz.ok) return [];

    const whereClause: any = {};

    if (searchQuery && searchQuery.trim() !== "") {
      const q = searchQuery.trim();
      // Documento e telefone ficam sem pontuação: busca pelo texto digitado e pela versão sem máscara
      const terms = maskedSearchTerms(q);
      whereClause.OR = [
        { name: { contains: q, mode: "insensitive" } },
        ...terms.map((term) => ({ document: { contains: term, mode: "insensitive" } })),
        ...terms.map((term) => ({ phone: { contains: term, mode: "insensitive" } })),
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
        where: { document: { in: documentLookupValues(document) } },
      });
      if (existingDocument) {
        return { success: false, error: "Já existe um cliente cadastrado com este documento (CPF/CNPJ)." };
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
          NOT: { id },
        },
      });
      if (existingDocument) {
        return { success: false, error: "Outro cliente já possui este documento (CPF/CNPJ)." };
      }
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        name,
        document,
        phone,
        email,
        address,
      },
    });

    revalidatePath("/admin/clientes");
    return { success: true, data: updatedCustomer };
  } catch (error) {
    console.error("Erro ao atualizar cliente:", error);
    return { success: false, error: "Falha ao atualizar o cliente." };
  }
}

export async function deleteCustomer(id: string) {
  try {
    const authz = await authorize("customers.delete");
    if (!authz.ok) return { success: false, error: authz.error };

    const salesCount = await prisma.sale.count({
      where: { customerId: id },
    });

    if (salesCount > 0) {
      return {
        success: false,
        error: `Não é possível excluir este cliente pois existem ${salesCount} venda(s) associadas a ele.`,
      };
    }

    await prisma.customer.delete({
      where: { id },
    });

    revalidatePath("/admin/clientes");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir cliente:", error);
    return { success: false, error: "Falha ao excluir o cliente." };
  }
}
