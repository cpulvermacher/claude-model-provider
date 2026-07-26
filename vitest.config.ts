import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
    },
    resolve: {
        alias: {
            vscode: fileURLToPath(
                new URL('./src/test/vscodeMock.ts', import.meta.url)
            ),
        },
    },
});
