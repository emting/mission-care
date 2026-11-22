import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { seedLocal } from "../src/server/db/seed";
async function main() {
  const env = await seedLocal();
  const key = resolve(".local-data/localhost-key.pem"),
    cert = resolve(".local-data/localhost.pem");
  if (!existsSync(key) || !existsSync(cert))
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "365",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
  console.log(
    "本機測試：https://localhost:3000/app ｜ 請僅於本機信任測試憑證。",
  );
  const child = spawn(
    "pnpm",
    [
      "exec",
      "next",
      "dev",
      "--hostname",
      "localhost",
      "--experimental-https",
      "--experimental-https-key",
      key,
      "--experimental-https-cert",
      cert,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, ...env, NODE_ENV: "development" },
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
}
main().catch(() => {
  console.error(
    "本機啟動失敗；請確認 OpenSSL 可用，且沒有其他程序使用本機資料庫。",
  );
  process.exitCode = 1;
});
