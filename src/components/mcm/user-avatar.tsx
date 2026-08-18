import { useEffect, useState } from "react";
import { MCMAvatar } from "@/components/mcm/primitives";
import { onAvatarChanged, resolveAvatarUrl } from "@/lib/api/avatar";
import { cn } from "@/lib/utils";

/**
 * Avatar pengguna dengan resolver terpusat + cache-buster `avatar_version`.
 * Jika signed URL gagal/expired, otomatis jatuh ke inisial berwarna.
 */
export function UserAvatar({
  userId,
  path,
  version = 0,
  name,
  color,
  size = "md",
  online,
  className,
}: {
  userId: string;
  path: string | null | undefined;
  version?: number | undefined;
  name: string;
  color: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | undefined;
  online?: boolean | undefined;
  className?: string | undefined;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => onAvatarChanged((id) => id === userId && setNonce((n) => n + 1)), [userId]);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!path) {
      setUrl(null);
      return;
    }
    void resolveAvatarUrl(userId, path, version).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [userId, path, version, nonce]);

  const initials = name.trim().slice(0, 2).toUpperCase() || "MC";
  return (
    <div className={cn("relative shrink-0", className)}>
      <MCMAvatar initials={initials} color={color} size={size} online={online} />
      {url && !failed && (
        <img
          src={url}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      )}
    </div>
  );
}
