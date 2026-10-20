"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReloadButton() {
  return (
    <Button variant="outline" className="gap-2" onClick={() => window.location.reload()}>
      <RotateCw className="h-4 w-4" />
      Tentar novamente
    </Button>
  );
}
