import * as vscode from 'vscode';

import { ChatModelProvider, initAnthropicClient } from './provider';

export async function activate(context: vscode.ExtensionContext) {
    await initAnthropicClient(context);

    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(
            'cpulvermacher',
            new ChatModelProvider()
        )
    );
}

export function deactivate() {}
