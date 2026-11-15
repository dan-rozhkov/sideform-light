import { common } from "./common";
import { settings } from "./settings";
import { trace } from "./trace";
import { chat } from "./chat";
import { tools } from "./tools";
import { schedules } from "./schedules";

export const de = { ...common, ...settings, ...trace, ...chat, ...tools, ...schedules };
