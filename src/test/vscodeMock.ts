// The real `vscode` module only exists inside the extension host, so tests
// resolve it to this stub (see the alias in vitest.config.ts). Only the parts
// used by the code under test are implemented; `instanceof` checks work
// because the code under test resolves `vscode` to this same module.

export class LanguageModelTextPart {
    constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
    constructor(
        public callId: string,
        public name: string,
        public input: object
    ) {}
}

export class LanguageModelToolResultPart {
    constructor(
        public callId: string,
        public content: unknown[]
    ) {}
}

export class LanguageModelDataPart {
    constructor(
        public data: Uint8Array,
        public mimeType: string
    ) {}

    static image(data: Uint8Array, mime: string) {
        return new LanguageModelDataPart(data, mime);
    }

    static text(value: string, mime = 'text/plain') {
        return new LanguageModelDataPart(new TextEncoder().encode(value), mime);
    }
}

export enum LanguageModelChatMessageRole {
    User = 1,
    Assistant = 2,
}
