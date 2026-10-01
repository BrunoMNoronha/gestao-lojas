"use server";

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function ensureDefaultUser() {
  try {
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await prisma.user.create({
        data: {
          name: "Administrador",
          email: "admin@gestaolojas.com",
          password: hashedPassword,
          role: "ADMIN",
        },
      });
      console.log("Usuário padrão criado com sucesso: admin@gestaolojas.com / admin123");
    }
  } catch (error) {
    console.error("Erro ao verificar/criar usuário padrão:", error);
  }
}
