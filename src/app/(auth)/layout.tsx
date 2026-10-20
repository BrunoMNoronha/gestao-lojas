import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Entrar",
  robots: NO_INDEX,
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
