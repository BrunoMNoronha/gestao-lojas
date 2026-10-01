"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface SupplierItem {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  id?: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export async function getSuppliers(searchQuery?: string): Promise<SupplierItem[]> {
  try {
    const whereClause: any = {};

    if (searchQuery && searchQuery.trim() !== "") {
      const q = searchQuery.trim();
      whereClause.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { document: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where: whereClause,
      orderBy: { name: "asc" },
    });

    return suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      document: s.document,
      phone: s.phone,
      email: s.email,
      address: s.address,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error("Erro ao buscar fornecedores:", error);
    return [];
  }
}

export async function createSupplier(data: SupplierInput) {
  try {
    const name = data.name?.trim();
    if (!name) {
      return { success: false, error: "O nome/razão social do fornecedor é obrigatório." };
    }

    const document = data.document?.trim() || null;
    const phone = data.phone?.trim() || null;
    const email = data.email?.trim() || null;
    const address = data.address?.trim() || null;

    if (document) {
      const existingDocument = await prisma.supplier.findUnique({
        where: { document },
      });
      if (existingDocument) {
        return { success: false, error: "Já existe um fornecedor cadastrado com este documento (CNPJ/CPF)." };
      }
    }

    const newSupplier = await prisma.supplier.create({
      data: {
        name,
        document,
        phone,
        email,
        address,
      },
    });

    revalidatePath("/admin/fornecedores");
    return { success: true, data: newSupplier };
  } catch (error) {
    console.error("Erro ao criar fornecedor:", error);
    return { success: false, error: "Falha ao criar o fornecedor." };
  }
}

export async function updateSupplier(id: string, data: SupplierInput) {
  try {
    const name = data.name?.trim();
    if (!name) {
      return { success: false, error: "O nome/razão social do fornecedor é obrigatório." };
    }

    const document = data.document?.trim() || null;
    const phone = data.phone?.trim() || null;
    const email = data.email?.trim() || null;
    const address = data.address?.trim() || null;

    if (document) {
      const existingDocument = await prisma.supplier.findFirst({
        where: {
          document,
          NOT: { id },
        },
      });
      if (existingDocument) {
        return { success: false, error: "Outro fornecedor já possui este documento (CNPJ/CPF)." };
      }
    }

    const updatedSupplier = await prisma.supplier.update({
      where: { id },
      data: {
        name,
        document,
        phone,
        email,
        address,
      },
    });

    revalidatePath("/admin/fornecedores");
    return { success: true, data: updatedSupplier };
  } catch (error) {
    console.error("Erro ao atualizar fornecedor:", error);
    return { success: false, error: "Falha ao atualizar o fornecedor." };
  }
}

export async function deleteSupplier(id: string) {
  try {
    await prisma.supplier.delete({
      where: { id },
    });

    revalidatePath("/admin/fornecedores");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir fornecedor:", error);
    return { success: false, error: "Falha ao excluir o fornecedor." };
  }
}
