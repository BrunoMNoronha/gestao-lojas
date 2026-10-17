import { MessageCircle } from "lucide-react";

// Contato comercial pela landing (src/app/page.tsx): abre a conversa no WhatsApp com a
// mensagem já escrita. Número no formato internacional, só dígitos, como o wa.me pede.
const WHATSAPP_NUMBER = "556191211423";
const WHATSAPP_MESSAGE = "Olá! Vi a página do Gestão de Lojas e quero saber mais.";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

export function WhatsAppButton() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Fale conosco pelo WhatsApp (abre em nova aba)"
      className="focus-visible:ring-ring fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 inline-flex size-14 items-center justify-center gap-2 rounded-full bg-[#25D366] font-medium text-white shadow-lg transition-[transform,background-color] outline-none hover:scale-105 hover:bg-[#1EBE5A] focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:scale-100 sm:right-6 sm:bottom-6 sm:h-14 sm:w-auto sm:px-5"
    >
      <MessageCircle aria-hidden="true" className="size-7 sm:size-6" />
      <span className="hidden sm:inline">Fale conosco</span>
    </a>
  );
}
