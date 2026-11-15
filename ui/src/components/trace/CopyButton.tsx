import { CheckIcon, CopyIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/IconButton";
import { useT } from "@/i18n";
import { useCopy } from "./useCopy";

/** Copies `text`; the icon turns into a check for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [copied, copy] = useCopy();
  return (
    <IconButton tooltip={copied ? t("common.copied") : label} aria-label={label} variant="ghost" size="icon-xs" onClick={() => copy(text)}>
      {copied ? <CheckIcon weight="light" /> : <CopyIcon weight="light" />}
    </IconButton>
  );
}
