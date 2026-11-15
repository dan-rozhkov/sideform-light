import type { UIMessage } from "ai";
import { isToolUIPart, getToolName } from "ai";
import { t } from "@/i18n";
import { getToolDisplayName } from "@/lib/toolDisplayNames";
import { redactBrowseSetupInput } from "@/lib/tools/browser/redactBrowseSetupInput";

const MAX_BLOCK_CHARS = 4000;
const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

function roleLabel(role: string): string {
  if (role === "user") return t("chat.export.user");
  if (role === "assistant") return t("chat.export.assistant");
  if (role === "system") return t("chat.export.system");
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Strip base64 image payloads so we never dump huge data URLs into markdown. */
function stripDataImages(value: string): string {
  return value.replace(DATA_IMAGE_RE, `[${t("chat.export.dataUrlOmitted")}]`);
}

/** Pretty-print a value as JSON; if it is already a JSON string, parse then re-stringify. */
function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Build a ```json fenced block, sanitizing data URLs and truncating if oversized. */
function jsonBlock(label: string, value: unknown): string {
  let body = stripDataImages(prettyJson(value));
  if (body.length > MAX_BLOCK_CHARS) {
    body = `${body.slice(0, MAX_BLOCK_CHARS)}\n… [${t("chat.export.truncated")}]`;
  }
  return `${label}\n\`\`\`json\n${body}\n\`\`\``;
}

type AnyToolPart = {
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function toolPartToMarkdown(part: unknown): string {
  const name = getToolName(part as never);
  const tp = part as AnyToolPart;
  const lines: string[] = [`**${t("chat.export.tool")}:** ${getToolDisplayName(name)}`];

  if (tp.input !== undefined) {
    lines.push(jsonBlock(t("chat.export.input"), name === "browse_agent" ? redactBrowseSetupInput(tp.input) : tp.input));
  }
  if (tp.output !== undefined) {
    lines.push(jsonBlock(t("chat.export.output"), tp.output));
  }
  if (tp.errorText) {
    lines.push(`**${t("chat.export.error")}:** ${tp.errorText}`);
  }
  return lines.join("\n\n");
}

/** Serialize a single chat message to Markdown. */
export function messageToMarkdown(msg: UIMessage): string {
  const sections: string[] = [`## ${roleLabel(msg.role)}`];

  for (const part of msg.parts) {
    if (part.type === "text" && part.text) {
      sections.push(part.text);
      continue;
    }
    if (part.type === "reasoning" && part.text) {
      const quoted = part.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      sections.push(`> **${t("chat.export.thinking")}:**\n${quoted}`);
      continue;
    }
    if (part.type === "file") {
      const fp = part as { mediaType?: string; url?: string };
      if (typeof fp.mediaType === "string" && fp.mediaType.startsWith("image/")) {
        const url = fp.url ?? "";
        if (url.startsWith("data:")) {
          sections.push(`*[${t("chat.attachedImage")}]*`);
        } else {
          sections.push(`![${t("chat.export.image")}](${url})`);
        }
      }
      continue;
    }
    if (isToolUIPart(part)) {
      sections.push(toolPartToMarkdown(part));
      continue;
    }
  }

  return sections.join("\n\n");
}

/**
 * Plain text for the per-message "Copy" button: only the text parts. No role
 * heading, reasoning, attachments or tool calls. A user message joins its parts
 * like its bubble does; an assistant message's parts are separate blocks.
 */
export function messageToClipboardText(msg: UIMessage): string {
  return msg.parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join(msg.role === "user" ? "" : "\n\n");
}

/** Serialize an entire chat (list of messages) to a Markdown document. */
export function chatToMarkdown(messages: UIMessage[], title?: string): string {
  const header = `# ${title || t("chat.export.title")}`;
  const body = messages.map(messageToMarkdown).join("\n\n---\n\n");
  return body ? `${header}\n\n${body}` : header;
}

/** Make a string safe for use as a filename. */
export function sanitizeFilename(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** Compact `YYYYMMDD-HHmmss` timestamp for filenames. */
function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function chatFilename(title?: string): string {
  return `chat-${sanitizeFilename(title || "chat")}-${timestamp()}.md`;
}

export function messageFilename(msg: UIMessage): string {
  return `message-${sanitizeFilename(msg.role)}-${timestamp()}.md`;
}

/** Download markdown content as a `.md` file. */
export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
