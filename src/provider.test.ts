import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { ChatModelProvider } from './provider';
import type { ReasoningCapabilities } from './reasoning';

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
    const streamFn = vi.fn(
        (_params: Anthropic.MessageCreateParamsStreaming) => stream
    );
    const anthropic = {
        messages: { stream: streamFn },
    } as unknown as Anthropic;
    const reasoningCapabilities = new Map<string, ReasoningCapabilities>([
        [
            model.id,
            { adaptiveThinking: true, effortLevels: ['low', 'medium', 'high'] },
        ],
    ]);
    const provider = new ChatModelProvider(
        anthropic,
        [model],
        reasoningCapabilities
    );
    return Object.assign(provider, { streamFn });
}

function respond(
    provider: ChatModelProvider,
    options = {} as vscode.ProvideLanguageModelChatResponseOptions,
    requestMessages = messages
) {
    const progress = { report: vi.fn() };
    const response = provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        options,
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

    it('sends no reasoning params with default settings', async () => {
        const provider = createProvider(
            { stop_reason: 'end_turn', stop_details: null, content: [] },
            []
        );
        await respond(provider).response;

        const params = provider.streamFn.mock.calls[0][0];
        expect(params).not.toHaveProperty('thinking');
        expect(params).not.toHaveProperty('output_config');
    });

    it('applies thinking and effort from modelOptions', async () => {
        const provider = createProvider(
            { stop_reason: 'end_turn', stop_details: null, content: [] },
            []
        );
        await respond(provider, {
            modelOptions: { thinking: 'adaptive', effort: 'max' },
        } as unknown as vscode.ProvideLanguageModelChatResponseOptions)
            .response;

        expect(provider.streamFn.mock.calls[0][0]).toMatchObject({
            thinking: { type: 'adaptive' },
            output_config: { effort: 'high' },
        });
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

describe('thinking blocks', () => {
    const thinking: Anthropic.ThinkingBlock = {
        type: 'thinking',
        thinking: 'Need to read the file.',
        signature: 'sig',
    };
    const toolUse: Anthropic.ToolUseBlock = {
        type: 'tool_use',
        id: 'call-1',
        name: 'read_file',
        input: { path: 'a.ts' },
        caller: { type: 'direct' },
    };

    /** a follow-up request answering `toolUse`, with `history` as the assistant turn */
    function followUp(history: unknown[]) {
        return [
            ...messages,
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                content: history,
                name: undefined,
            },
            {
                role: vscode.LanguageModelChatMessageRole.User,
                content: [
                    new vscode.LanguageModelToolResultPart('call-1', [
                        new vscode.LanguageModelTextPart('contents'),
                    ]),
                ],
                name: undefined,
            },
        ] as unknown as vscode.LanguageModelChatRequestMessage[];
    }

    function sentAssistantContent(provider: ReturnType<typeof createProvider>) {
        return provider.streamFn.mock.calls[0][0].messages[1].content;
    }

    it('round-trips thinking in front of the assistant turn', async () => {
        const first = createProvider(
            {
                stop_reason: 'tool_use',
                stop_details: null,
                content: [
                    thinking,
                    { type: 'text', text: 'Reading.', citations: null },
                    toolUse,
                ],
            },
            ['Reading.']
        );
        const { response, progress } = respond(first);
        await response;
        // what a caller stores as the assistant turn, in reported order
        const history = progress.report.mock.calls.map(([part]) => part);
        expect(history.map((part) => part.constructor)).toEqual([
            vscode.LanguageModelTextPart,
            vscode.LanguageModelDataPart,
            vscode.LanguageModelToolCallPart,
        ]);

        const second = createProvider(
            { stop_reason: 'end_turn', stop_details: null, content: [] },
            []
        );
        await respond(second, undefined, followUp(history)).response;

        expect(sentAssistantContent(second)).toEqual([
            {
                type: 'thinking',
                thinking: 'Need to read the file.',
                signature: 'sig',
            },
            { type: 'text', text: 'Reading.' },
            {
                type: 'tool_use',
                id: 'call-1',
                name: 'read_file',
                input: { path: 'a.ts' },
            },
        ]);
    });

    it('drops thinking produced by a different model', async () => {
        const part = vscode.LanguageModelDataPart.json(
            { model: 'claude-other-1-0', block: thinking },
            'application/vnd.claude-model-provider.thinking+json'
        );
        const provider = createProvider(
            { stop_reason: 'end_turn', stop_details: null, content: [] },
            []
        );
        await respond(
            provider,
            undefined,
            followUp([
                part,
                new vscode.LanguageModelToolCallPart('call-1', 'read_file', {}),
            ])
        ).response;

        expect(sentAssistantContent(provider)).toEqual([
            { type: 'tool_use', id: 'call-1', name: 'read_file', input: {} },
        ]);
    });
});
