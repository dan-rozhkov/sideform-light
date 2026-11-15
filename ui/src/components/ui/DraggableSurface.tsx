import type { ComponentProps, ReactNode } from "react";
import { DotsSixIcon } from "@/components/icons";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** Shared chrome for floating editor surfaces such as draggable popovers and
 * plugin panels. Keeping it here prevents those two surfaces from drifting
 * apart visually. */
export const DRAGGABLE_SURFACE_CLASS =
  "menu-surface outline-none";

interface DraggableSurfaceHandleProps extends Omit<ComponentProps<"div">, "children"> {
  children?: ReactNode;
}

export function DraggableSurfaceHandle({
  children,
  className,
  title,
  ...props
}: DraggableSurfaceHandleProps) {
  const t = useT();
  return (
    <div
      data-slot="popover-drag-handle"
      role="presentation"
      title={title ?? t("settings.ui.dragToMove")}
      className={cn(
        "flex h-4 shrink-0 cursor-grab touch-none select-none items-center rounded-md text-text-muted transition-colors hover:text-text-primary active:cursor-grabbing",
        children ? "gap-1.5" : "justify-center",
        className,
      )}
      {...props}
    >
      <DotsSixIcon size={14} weight="bold" className="rotate-90" />
      {children}
    </div>
  );
}
