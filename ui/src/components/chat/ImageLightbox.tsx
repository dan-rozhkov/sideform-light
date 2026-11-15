import { useEffect } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@/components/icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";
import { useT } from "@/i18n";

interface ImageLightboxProps {
  urls: string[];
  /** Opt-in: shows a like button for the current image if it has an entry. */
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ImageLightbox({
  urls,
  index,
  onClose,
  onNavigate,
}: ImageLightboxProps) {
  const t = useT();
  const hasMultiple = urls.length > 1;

  const goTo = (next: number) => {
    if (urls.length === 0) return;
    const wrapped = ((next % urls.length) + urls.length) % urls.length;
    onNavigate(wrapped);
  };

  const prev = () => goTo(index - 1);
  const next = () => goTo(index + 1);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && hasMultiple) {
        e.preventDefault();
        e.stopPropagation();
        prev();
      } else if (e.key === "ArrowRight" && hasMultiple) {
        e.preventDefault();
        e.stopPropagation();
        next();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, urls.length, hasMultiple]);

  const url = urls[index];
  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <img
        src={url}
        alt={t("chat.attachedImage")}
        onError={onClose}
        className="max-w-[90vw] max-h-[90vh] rounded-lg img-outline"
      />


      {hasMultiple && (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    prev();
                  }}
                  aria-label={t("chat.previousImage")}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <CaretLeftIcon size={24} weight={CHEVRON_WEIGHT} />
                </button>
              }
            />
            <TooltipContent>{t("chat.previousImage")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    next();
                  }}
                  aria-label={t("chat.nextImage")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <CaretRightIcon size={24} weight={CHEVRON_WEIGHT} />
                </button>
              }
            />
            <TooltipContent>{t("chat.nextImage")}</TooltipContent>
          </Tooltip>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs">
            {index + 1} / {urls.length}
          </div>
        </>
      )}
    </div>
  );
}
