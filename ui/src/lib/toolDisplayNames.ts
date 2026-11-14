export const toolDisplayNames: Record<string, string> = {
  analyze_image: "Analyze Image",
  trace_list: "List Trace Tabs",
  trace_read: "Read Trace",
  trace_frame: "View Trace Frame",
  browse_open: "Open Browser",
  browse_act: "Browse",
  browse_find_images: "Find Images in Browser",
  browse_read: "Read Page",
  browse_snapshot: "Snapshot Page",
  browse_screenshot: "Screenshot Browser",
  browse_tabs: "Manage Browser Tabs",
  browse_fill_login: "Fill Saved Login",
  browse_task: "Browse Task",
  browse_agent: "Browse Agent",
  qa_verdict: "QA Verdict",
  qa_assert: "QA Assert",
  ask_user: "Ask a question",
};

export function getToolDisplayName(toolName: string): string {
  return toolDisplayNames[toolName] ?? toolName;
}
