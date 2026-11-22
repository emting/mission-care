import { defineConfig } from 'vitest/config';
export default defineConfig({ oxc: { jsx: { runtime: 'automatic' } }, test: { fileParallelism: false, testTimeout: 30000 } });
