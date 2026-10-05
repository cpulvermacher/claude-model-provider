import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { ChatModelProvider } from './provider';

const model: vscode.LanguageModelChatInformation = {
    id: 'claude-test-1-0',
    name: 'Claude Test',
    family: 'claude',
    version: '1.0',
    maxInputTokens: 1000,
    maxOutputTokens: 64000,
    capabilities: { toolCalling: true, imageInput: true },
};

const token: vscode.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
};

const messages = [
    {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart('hello')],
        name: undefined,
    },
] as unknown as vscode.LanguageModelChatRequestMessage[];

/** a provider whose stream emits `texts` and then settles on `message` */
function createProvider(message: Partial<Anthropic.Message>, texts: string[]) {
    const stream = {
        on: (event: string, listener: (text: string) => void) => {
            if (event === 'text') {
                for (const text of texts) {
                    listener(text);
                }
            }
            return stream;
        },
        finalMessage: async () => message,
        abort: () => {},
    };
    const anthropic = {
        messages: { stream: () => stream },
    } as unknown as Anthropic;
    return new ChatModelProvider(anthropic, [model]);
}

function respond(provider: ChatModelProvider) {
    const progress = { report: vi.fn() };
    const response = provider.provideLanguageModelChatResponse(
        model,
        messages,
        {} as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token
    );
    return { response, progress };
}

describe('provideLanguageModelChatResponse', () => {
    it('reports streamed text for a normal response', async () => {
        const provider = createProvider(
            { stop_reason: 'end_turn', stop_details: null, content: [] },
            ['Hi']
        );
        const { response, progress } = respond(provider);

        await expect(response).resolves.toBeUndefined();
        expect(progress.report).toHaveBeenCalledWith(
            new vscode.LanguageModelTextPart('Hi')
        );
    });

    it('appends a marker when the output limit is hit', async () => {
        const provider = createProvider(
            { stop_reason: 'max_tokens', stop_details: null, content: [] },
            ['truncated']
        );
        const { response, progress } = respond(provider);

        await expect(response).resolves.toBeUndefined();
        expect(progress.report.mock.calls).toEqual([
            [new vscode.LanguageModelTextPart('truncated')],
            [
                new vscode.LanguageModelTextPart(
                    '\n\n[Response truncated: reached the ' +
                        '64000-token output limit.]'
                ),
            ],
        ]);
    });

    it('throws with the category and explanation on a refusal', async () => {
        const provider = createProvider(
            {
                stop_reason: 'refusal',
                stop_details: {
                    type: 'refusal',
                    category: 'reasoning_extraction',
                    explanation: 'Blocked.',
                },
                content: [],
            },
            []
        );
        const { response } = respond(provider);

        await expect(response).rejects.toThrow(
            'Claude Test declined the request ' +
                '(category: reasoning_extraction). Blocked.'
        );
    });

    it('keeps partial text and still throws on a mid-stream refusal', async () => {
        const provider = createProvider(
            {
                stop_reason: 'refusal',
                stop_details: null,
                content: [],
            },
            ['partial']
        );
        const { response, progress } = respond(provider);

        await expect(response).rejects.toThrow('(category: unknown)');
        expect(progress.report).toHaveBeenCalledWith(
            new vscode.LanguageModelTextPart('partial')
        );
    });
});
