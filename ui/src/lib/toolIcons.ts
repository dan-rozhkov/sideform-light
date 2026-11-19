import {
  ArticleIcon,
  BrainIcon,
  FilmStripIcon,
  ListMagnifyingGlassIcon,
  FlagCheckeredIcon,
  BrowserIcon,
  CameraIcon,
  CompassIcon,
  CursorClickIcon,
  EyeIcon,
  ImageIcon,
  ImagesSquareIcon,
  KeyIcon,
  ClockIcon,
  ListChecksIcon,
  QuestionIcon,
  StackIcon,
  WrenchIcon,
  type Icon,
} from "@/components/icons";

// Icon per tool, shown before the label in ToolCallIndicator. Keys mirror
// `toolDisplayNames` — `toolIcons.test.ts` fails if the two drift, so a new
// tool gets both a name and an icon or neither.
const toolIcons: Record<string, Icon> = {
  analyze_image: EyeIcon,
  trace_list: ListMagnifyingGlassIcon,
  trace_read: FilmStripIcon,
  trace_frame: ImageIcon,
  browse_open: BrowserIcon,
  browse_act: CursorClickIcon,
  browse_find_images: ImagesSquareIcon,
  browse_read: ArticleIcon,
  browse_snapshot: ListChecksIcon,
  browse_screenshot: CameraIcon,
  browse_tabs: StackIcon,
  browse_fill_login: KeyIcon,
  browse_task: CompassIcon,
  browse_agent: CompassIcon,
  qa_verdict: FlagCheckeredIcon,
  qa_assert: FlagCheckeredIcon,
  ask_user: QuestionIcon,
  schedule_list: ClockIcon,
  schedule_create: ClockIcon,
  schedule_set_enabled: ClockIcon,
  schedule_delete: ClockIcon,
  memory: BrainIcon,
};

/** Falls back to a generic tool icon for anything unmapped. */
export function getToolIcon(toolName: string): Icon {
  return toolIcons[toolName] ?? WrenchIcon;
}
