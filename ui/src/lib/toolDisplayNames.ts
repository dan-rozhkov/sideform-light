import { t, type MessageKey } from "@/i18n";

/** Message keys, not text: the name is translated when shown, so it follows a language switch. */
export const toolDisplayNames: Record<string, MessageKey> = {
  analyze_image: "tools.name.analyze_image",
  trace_list: "tools.name.trace_list",
  trace_read: "tools.name.trace_read",
  trace_frame: "tools.name.trace_frame",
  browse_open: "tools.name.browse_open",
  browse_act: "tools.name.browse_act",
  browse_find_images: "tools.name.browse_find_images",
  browse_read: "tools.name.browse_read",
  browse_snapshot: "tools.name.browse_snapshot",
  browse_screenshot: "tools.name.browse_screenshot",
  browse_tabs: "tools.name.browse_tabs",
  browse_fill_login: "tools.name.browse_fill_login",
  browse_task: "tools.name.browse_task",
  browse_agent: "tools.name.browse_agent",
  qa_verdict: "tools.name.qa_verdict",
  qa_assert: "tools.name.qa_assert",
  ask_user: "tools.name.ask_user",
};

export function getToolDisplayName(toolName: string): string {
  const key = toolDisplayNames[toolName];
  return key ? t(key) : toolName;
}
