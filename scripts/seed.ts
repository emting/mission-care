import { seedLocal } from "../src/server/db/seed";
seedLocal().catch(() => {
  console.error("本機種子建立失敗；請檢查資料目錄是否正被另一個程序使用。");
  process.exitCode = 1;
});
