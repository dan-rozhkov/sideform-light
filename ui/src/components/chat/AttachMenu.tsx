import { ImageIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/IconButton";

interface AttachMenuProps {
  /** Why images cannot be attached right now; null when they can. */
  imageDisabledReason: string | null;
  /** Muted note when attaching works but only as a text description. */
  imageHint?: string;
  onPickImage: () => void;
}

/** The composer's "Attach image" button. */
export function AttachMenu({ imageDisabledReason, imageHint, onPickImage }: AttachMenuProps) {
  const note = imageDisabledReason ?? imageHint;
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon"
      tooltip={note ? `Attach image (${note})` : "Attach image"}
      disabled={imageDisabledReason !== null}
      onClick={onPickImage}
      className="size-[30px] hover:bg-secondary"
    >
      <ImageIcon size={16} weight="light" />
    </IconButton>
  );
}
