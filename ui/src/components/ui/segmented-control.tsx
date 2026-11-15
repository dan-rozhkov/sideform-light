import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

import { cn } from "@/lib/utils";

/** Grey track that holds the items. */
const SEGMENTED_TRACK_CLASS =
  "inline-flex w-fit items-center gap-0.5 rounded-control-lg bg-secondary p-[3px]";

/** One item, inactive. */
const SEGMENTED_ITEM_CLASS =
  "inline-flex h-6 cursor-default items-center justify-center rounded-control-inset border border-transparent px-2.5 text-xs/relaxed font-medium whitespace-nowrap text-text-muted outline-none transition-[color,background-color,border-color,box-shadow,scale] select-none hover:text-text-primary focus-visible:ring-[2px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Checked state for Base UI radios (variant-prefixed, so it sorts after the border). */
const SEGMENTED_ITEM_CHECKED_CLASS =
  "data-checked:control-raised dark:data-checked:bg-surface-hover data-checked:text-text-primary data-disabled:cursor-not-allowed data-disabled:opacity-50";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Names the group for assistive tech (there is no visible label of its own). */
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/**
 * A row of mutually exclusive options. Radio-group semantics from Base UI:
 * one tab stop, arrow keys move and select, Home/End jump.
 */
function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  disabled,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup
      data-slot="segmented-control"
      aria-label={props["aria-label"]}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      className={cn(SEGMENTED_TRACK_CLASS, className)}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          data-slot="segmented-control-item"
          className={cn(SEGMENTED_ITEM_CLASS, SEGMENTED_ITEM_CHECKED_CLASS)}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export { SegmentedControl };
