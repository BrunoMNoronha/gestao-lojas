import Link from "next/link";
import { Store } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Página não encontrada",
};

export default function NotFound() {
  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card max-w-md rounded-lg border p-6 text-center">
        <div className="bg-primary text-primary-foreground mx-auto mb-3 w-fit rounded-xl p-3">
          <Store className="h-8 w-8" />
        </div>
        <h1 className="text-lg font-semibold">Página não encontrada</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          O endereço acessado não existe ou foi movido.
        </p>
        <Link href="/">
          <Button className="mt-4">Ir para a página inicial</Button>
        </Link>
      </div>
    </div>
  );
}
