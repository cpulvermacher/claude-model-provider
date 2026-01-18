import * as vscode from 'vscode';

export async function getApiKey(context: vscode.ExtensionContext) {
    return await context.secrets.get('claude.apiKey');
}

export async function promptAndStoreApiKey(context: vscode.ExtensionContext) {
    const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your Anthropic API Key',
        ignoreFocusOut: true,
    });

    if (!apiKey) {
        throw new Error('API Key is required');
    }

    await context.secrets.store('claude.apiKey', apiKey);
    return apiKey;
}
