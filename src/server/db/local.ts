import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { authenticator } from "otplib";
import { permissions } from "../policy";
export async function localEnvironment() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Local development only");
  const dir = resolve(".local-data");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = resolve(dir, "config.json");
  let config: {
    authKey: string;
    subjectKey: string;
    password: string;
    totp: Record<string, string>;
  };
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const roles = [...Object.keys(permissions), "reviewer2", "finance2"];
    config = {
      authKey: randomBytes(32).toString("hex"),
      subjectKey: randomBytes(32).toString("hex"),
      password: randomBytes(18).toString("base64url"),
      totp: Object.fromEntries(
        roles.map((role) => [role, authenticator.generateSecret()]),
      ),
    };
    await writeFile(path, JSON.stringify(config), { mode: 0o600, flag: "wx" });
  }
  const env = {
    MC_LOCAL_DB: "1",
    MC_DEV_LOGIN: "1",
    APP_ORIGIN: "https://localhost:3000",
    AUTH_ENCRYPTION_KEY: config.authKey,
    LINE_SUBJECT_ENC_KEY: config.subjectKey,
    LINE_LOGIN_CHANNEL_ID: "fictional-local-channel",
    PRIVATE_MEDIA_DIR: resolve(".local-data/media"),
  };
  return { config, env, dir };
}
