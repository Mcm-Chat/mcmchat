import { useEffect } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ containerAriaLabel = "Notifikasi", ...props }: ToasterProps) => {
  // Localisasi label tombol tutup bawaan sonner + petunjuk pintasan Escape.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const label = () => {
      document.querySelectorAll("[data-close-button]").forEach((el) => {
        el.setAttribute("aria-label", "Tutup notifikasi");
        el.setAttribute("title", "Tutup notifikasi (Esc)");
      });
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      className="toaster group"
      containerAriaLabel={containerAriaLabel}
      toastOptions={{
        // Sonner merender wrapper aria-live="polite"; error/warning dinaikkan
        // menjadi assertive lewat `important` di call site bila perlu.
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:border-border group-[.toast]:bg-background group-[.toast]:text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
