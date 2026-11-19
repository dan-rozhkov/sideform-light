import { common } from "./common";
import { settings } from "./settings";
import { trace } from "./trace";
import { chat } from "./chat";
import { tools } from "./tools";
import { schedules } from "./schedules";
import { memory } from "./memory";

export const fr = { ...common, ...settings, ...trace, ...chat, ...tools, ...schedules, ...memory };
