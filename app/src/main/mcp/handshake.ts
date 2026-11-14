// Connection file `~/.sideform-light/mcp.json` `{ url, token, port }` (dir 0700, file 0600, atomic write), so a
// local MCP client can discover the endpoint. Never `~/.pen-editor/`: Sideform Desktop owns that one.
// The file is removed on stop/quit only while it still holds OUR token (another instance or a newer start of this
// app may have replaced it).

import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../storeUtils";

export interface WarnLogger {
  warn: (msg: string) => void;
  info?: (msg: string) => void;
}

export interface HandshakeFileEntry {
  url: string;
  token: string;
  port: number;
}

/** 32 random bytes as 64 lowercase hex characters. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

const TOKEN_RE = /^[0-9a-f]{64}$/;
export const isValidToken = (v: unknown): v is string => typeof v === "string" && TOKEN_RE.test(v);

/**
 * True for 127.0.0.0/8, ::1 and IPv4-mapped ::ffff:127.x.x.x. Deliberately narrow: this backs a security
 * boundary, so anything not recognisably loopback is treated as remote.
 */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  if (address === "::1") return true;
  const v4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  const parts = v4.split(".");
  if (parts.length !== 4) return false;
  // Every octet must be a plain base-10 integer 0-255 (no signs, spaces or trailing garbage).
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  return Number(parts[0]) === 127;
}

export const HANDSHAKE_DIR_NAME = ".sideform-light";
export const HANDSHAKE_FILE_NAME = "mcp.json";

export interface HandshakeOptions {
  /** The home directory. Default `os.homedir()`, read at each call (tests and e2e point it at a temp dir). */
  homeDir?: () => string;
  log?: WarnLogger;
}

export interface Handshake {
  readonly path: string;
  /** Atomic write. Never throws; returns whether the file landed (a swallowed failure must not show "listening"). */
  write(entry: HandshakeFileEntry): Promise<boolean>;
  /** Removes the file when it still holds `entry.token`. Never throws. */
  remove(entry: HandshakeFileEntry): Promise<void>;
  /** Synchronous twin for `will-quit`, which does not await. */
  removeSync(entry: HandshakeFileEntry): void;
}

export function createHandshake(opts: HandshakeOptions = {}): Handshake {
  const homeDir = opts.homeDir ?? homedir;
  const log: WarnLogger = opts.log ?? { warn: (m) => console.warn(m) };
  const dir = () => join(homeDir(), HANDSHAKE_DIR_NAME);
  const file = () => join(dir(), HANDSHAKE_FILE_NAME);

  const holdsOurToken = (raw: string, entry: HandshakeFileEntry): boolean => {
    try {
      return (JSON.parse(raw) as Partial<HandshakeFileEntry>).token === entry.token;
    } catch {
      return false;
    }
  };
  const failed = (action: string, err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    // The message may carry a path, never the token.
    log.warn(`[mcp] failed to ${action} the connection file: ${err instanceof Error ? err.message : String(err)}`);
  };

  return {
    get path() {
      return file();
    },
    async write(entry) {
      try {
        await writeFileAtomic(file(), JSON.stringify(entry, null, 2) + "\n", { dirMode: 0o700, chmod: true });
        return true;
      } catch (err) {
        failed("write", err);
        return false;
      }
    },
    async remove(entry) {
      try {
        if (!holdsOurToken(await readFile(file(), "utf8"), entry)) return;
        await rm(file(), { force: true });
      } catch (err) {
        failed("remove", err);
      }
    },
    removeSync(entry) {
      try {
        if (!holdsOurToken(readFileSync(file(), "utf8"), entry)) return;
        rmSync(file(), { force: true });
      } catch (err) {
        failed("remove", err);
      }
    },
  };
}
