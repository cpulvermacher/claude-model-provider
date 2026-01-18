import * as vscode from 'vscode';

export async function getApiKey(context: vscode.ExtensionContext) {
    return await context.secrets.get('claude.apiKey');
}

export async function promptAndStoreApiKey(context: vscode.ExtensionContext) {
    const apiKey = await vscode.window.showInputBox({
        prompt: 'Claude Model Provider: Enter your Anthropic API key',
        placeHolder: 'sk-xxxxxx',
        ignoreFocusOut: true,
    });

    if (!apiKey) {
        throw new Error('API key is required');
    }

    await context.secrets.store('claude.apiKey', apiKey);
    return apiKey;
}

export async function resetApiKey(context: vscode.ExtensionContext) {
    await context.secrets.delete('claude.apiKey');

    try {
        await promptAndStoreApiKey(context);
    } catch {
        vscode.window.showWarningMessage('API Key reset cancelled.');
        return;
    }
}
