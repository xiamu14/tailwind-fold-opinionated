import * as vscode from "vscode"
import { Command } from "./commands"
import { Decorator } from "./decorator"
import { Settings } from "./configuration"
import * as Config from "./configuration"

export function activate({ subscriptions }: vscode.ExtensionContext) {
    const decorator = new Decorator()
    decorator.loadConfig()
    decorator.setActiveEditor(vscode.window.activeTextEditor)

    //
    // Register event handlers
    //
    const changeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(() => {
        decorator.setActiveEditor(vscode.window.activeTextEditor)
    })

    const changeTextEditorSelection = vscode.window.onDidChangeTextEditorSelection(() => {
        decorator.updateDecorations()
    })

    const changeConfiguration = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(Settings.Identifier)) {
            decorator.loadConfig()
        }
    })

    //
    // Register commands
    //
    const toggleCommand = vscode.commands.registerCommand(Command.ToggleFold, () => {
        decorator.toggleAutoFold()
    })

    //
    // Register hover provider
    //
    const supportedLanguages = Config.get<string[]>(Settings.SupportedLanguages) ?? []
    const hoverProvider = vscode.languages.registerHoverProvider(supportedLanguages, {
        provideHover(document, position) {
            const hoverText = decorator.getHoverText(position)
            if (hoverText) {
                const formattedText = decorator.formatClassNames(hoverText)
                const markdown = new vscode.MarkdownString()
                markdown.appendCodeblock(formattedText, 'css')
                markdown.isTrusted = true
                return new vscode.Hover(markdown)
            }
            return undefined
        },
    })

    subscriptions.push(changeActiveTextEditor)
    subscriptions.push(changeTextEditorSelection)
    subscriptions.push(changeConfiguration)
    subscriptions.push(toggleCommand)
    subscriptions.push(hoverProvider)
}

export function deactivate({ subscriptions }: vscode.ExtensionContext) {
    subscriptions.forEach((subscription) => subscription.dispose())
}
