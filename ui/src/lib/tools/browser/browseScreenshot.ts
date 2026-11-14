import type { ToolHandler } from "../../toolRegistry";
import { executeBrowseTool } from "@sideform/browser-agent/agent/execute";
import { getBrowserBridge } from "./bridge";
import { peBase } from "./shared";

/**
 * browse_screenshot: a viewport capture of the built-in browser tab. Returns `{ imageData: "data:image/jpeg;base64,...",
 * width, height, url, title, snapshotId?, elements? }`; the backend's `toModelOutput` turns `imageData` into an image
 * part, so this handler must not touch or re-encode it. `annotate: true` numbers every snapshot element on the image
 * (set-of-marks). The capture is the package's (`executeBrowseTool`).
 */
export const browseScreenshot: ToolHandler = (args, context) =>
  executeBrowseTool(getBrowserBridge(context?.sessionId, context?.browserSession), "browse_screenshot", args, peBase);
