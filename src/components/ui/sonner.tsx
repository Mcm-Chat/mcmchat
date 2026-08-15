import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ containerAriaLabel = "Notifikasi", ...props }: ToasterProps) => {
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
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
