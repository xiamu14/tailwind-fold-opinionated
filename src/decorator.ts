import { DecorationOptions, MarkdownString, Range, TextEditor, workspace } from "vscode"
import { FoldedDecorationType, UnfoldedDecorationType, FadedDecorationType } from "./decorations"

import * as Config from "./configuration"
import { Settings } from "./configuration"

export class Decorator {
    activeEditor: TextEditor

    autoFold: boolean = false
    unfoldIfLineSelected: boolean = false
    supportedLanguages: string[] = []

    regEx = /(class|className)(?:=|:|:\s)((({\s*?.*?\()([\s\S]*?)(\)\s*?}))|(({?\s*?(['"`]))([\s\S]*?)(\8|\9\s*?})))/g
    regExGroupsAll = [0]
    regExGroupsQuotes = [5, 10]
    regExGroups = this.regExGroupsAll

    unfoldedDecorationType = UnfoldedDecorationType()
    foldedDecorationType = FoldedDecorationType()
    fadedDecorationType = FadedDecorationType()

    foldedRanges: DecorationOptions[] = []
    unfoldedRanges: Range[] = []
    fadedRanges: DecorationOptions[] = []
    foldedTexts: Map<string, string> = new Map() // key: line-start-end, value: full text

    setActiveEditor(textEditor: TextEditor | undefined) {
        if (!textEditor) {
            return
        }
        this.activeEditor = textEditor
        this.updateDecorations()
    }

    toggleAutoFold(): boolean {
        this.autoFold = !this.autoFold
        this.updateDecorations()

        Config.set(Settings.AutoFold, this.autoFold)
        return this.autoFold
    }

    loadConfig() {
        this.autoFold = Config.get<boolean>(Settings.AutoFold) ?? false
        this.unfoldIfLineSelected = Config.get<boolean>(Settings.UnfoldIfLineSelected) ?? false
        this.supportedLanguages = Config.get<string[]>(Settings.SupportedLanguages) ?? []
        this.regExGroups =
            Config.get<string>(Settings.FoldStyle) === "ALL" ? this.regExGroupsAll : this.regExGroupsQuotes

        this.unfoldedDecorationType.dispose()
        this.foldedDecorationType.dispose()
        this.fadedDecorationType.dispose()
        this.unfoldedDecorationType = UnfoldedDecorationType()
        this.foldedDecorationType = FoldedDecorationType()
        this.fadedDecorationType = FadedDecorationType()
        this.updateDecorations()
    }

    updateDecorations() {
        if (!this.activeEditor) {
            return
        }
        if (!this.supportedLanguages.includes(this.activeEditor.document.languageId)) {
            return
        }

        const documentText = this.activeEditor.document.getText()
        this.foldedRanges = []
        this.unfoldedRanges = []
        this.fadedRanges = []
        this.foldedTexts.clear()

        let match
        while ((match = this.regEx.exec(documentText))) {
            let matchedGroup

            for (const group of this.regExGroups) {
                if (match[group]) {
                    matchedGroup = group
                    break
                }
            }

            if (matchedGroup === undefined) {
                continue
            }

            const text = match[0]
            const textToFold = match[matchedGroup]
            const foldStartIndex = text.indexOf(textToFold)

            const foldStartPosition = this.activeEditor.document.positionAt(match.index + foldStartIndex)
            const foldEndPosition = this.activeEditor.document.positionAt(
                match.index + foldStartIndex + textToFold.length
            )

            const range = new Range(foldStartPosition, foldEndPosition)

            const foldLengthThreshold = Config.get<number>(Settings.FoldLengthThreshold) ?? 0
            let foldMaxLength = Config.get<number>(Settings.FoldMaxLength) ?? 0

            // If foldMaxLength is 0, calculate from editor word wrap column
            if (foldMaxLength === 0) {
                const editorConfig = workspace.getConfiguration("editor")
                const wordWrapColumn = editorConfig.get<number>("wordWrapColumn")
                if (wordWrapColumn && wordWrapColumn > 10) {
                    foldMaxLength = wordWrapColumn - 10
                }
            }

            if (
                !this.autoFold ||
                this.isRangeSelected(range) ||
                (this.unfoldIfLineSelected && this.isLineOfRangeSelected(range))
            ) {
                this.unfoldedRanges.push(range)
                continue
            }
            if (textToFold.length < foldLengthThreshold) {
                // If the length of the text to fold is less than the threshold, skip folding
                this.unfoldedRanges.push(range)
                continue
            }
            if (foldMaxLength > 0 && textToFold.length > foldMaxLength) {
                // If the length is too long, use faded style instead of folding to avoid blank lines
                const rangeKey = `${foldStartPosition.line}-${foldStartPosition.character}-${foldEndPosition.line}-${foldEndPosition.character}`
                this.foldedTexts.set(rangeKey, textToFold)

                this.fadedRanges.push({
                    range,
                })
                continue
            }

            // Store the full text for hover
            const rangeKey = `${foldStartPosition.line}-${foldStartPosition.character}-${foldEndPosition.line}-${foldEndPosition.character}`
            this.foldedTexts.set(rangeKey, textToFold)

            this.foldedRanges.push({ range })
        }

        this.activeEditor.setDecorations(this.unfoldedDecorationType, this.unfoldedRanges)
        this.activeEditor.setDecorations(this.foldedDecorationType, this.foldedRanges)
        this.activeEditor.setDecorations(this.fadedDecorationType, this.fadedRanges)
    }

    isRangeSelected(range: Range): boolean {
        return !!(
            this.activeEditor.selection.contains(range) || this.activeEditor.selections.find((s) => range.contains(s))
        )
    }

    isLineOfRangeSelected(range: Range): boolean {
        return !!this.activeEditor.selections.find((s) => s.start.line === range.start.line)
    }

    getHoverText(position: any): string | undefined {
        for (const [rangeKey, text] of this.foldedTexts.entries()) {
            const [startLine, startChar, endLine, endChar] = rangeKey.split("-").map(Number)

            // Check if position is within the range
            if (position.line < startLine || position.line > endLine) {
                continue
            }

            if (position.line === startLine && position.character < startChar) {
                continue
            }

            if (position.line === endLine && position.character > endChar) {
                continue
            }

            return text
        }
        return undefined
    }

    formatClassNames(classText: string): string {
        // Remove quotes and extract class names
        let cleaned = classText.trim().replace(/^['"`{}\s]+|['"`{}\s]+$/g, "")

        // Split by whitespace and filter empty strings
        const classes = cleaned.split(/\s+/).filter((c) => c.length > 0)

        // CSS property order groups (common in CSS style guides)
        const orderGroups = {
            positioning: /^(static|relative|absolute|fixed|sticky|top-|right-|bottom-|left-|z-|inset-)/,
            display: /^(block|inline|flex|grid|hidden|table|flow-)/,
            flexGrid: /^(flex-|grid-|justify-|items-|content-|self-|place-|gap-|space-|order-)/,
            boxModel: /^(container|box-|w-|h-|min-|max-|p[xytblr]?-|m[xytblr]?-|overflow-|aspect-)/,
            typography:
                /^(font-|text-|leading-|tracking-|align-|whitespace-|break-|hyphens-|line-clamp|truncate|italic|underline|uppercase|lowercase|capitalize|normal-case|decoration-)/,
            visual: /^(bg-|from-|via-|to-|gradient-|border|rounded|shadow|opacity-|mix-|backdrop-)/,
            transforms: /^(scale-|rotate-|translate-|skew-|transform|origin-)/,
            transitions: /^(transition|duration-|ease-|delay-|animate-)/,
            interactivity: /^(cursor-|select-|resize-|appearance-|pointer-events-|touch-)/,
            others: /.*/,
        }

        // Separate base classes and pseudo/responsive classes
        const baseClasses: { [key: string]: string[] } = {}
        const pseudoClasses: { [key: string]: string[] } = {}

        // Initialize groups
        Object.keys(orderGroups).forEach((group) => {
            baseClasses[group] = []
        })

        classes.forEach((cls) => {
            if (cls.includes(":")) {
                // Extract prefix for grouping (e.g., "hover:", "sm:", "dark:")
                const prefix = cls.split(":")[0] + ":"
                if (!pseudoClasses[prefix]) {
                    pseudoClasses[prefix] = []
                }
                pseudoClasses[prefix].push(cls)
            } else {
                // Find which group this class belongs to
                let matched = false
                for (const [groupName, pattern] of Object.entries(orderGroups)) {
                    if (pattern.test(cls)) {
                        baseClasses[groupName].push(cls)
                        matched = true
                        break
                    }
                }
                if (!matched) {
                    baseClasses["others"].push(cls)
                }
            }
        })

        // Build result with proper ordering
        let result = ""

        // Add base classes in order
        const groupOrder = [
            "positioning",
            "display",
            "flexGrid",
            "boxModel",
            "typography",
            "visual",
            "transforms",
            "transitions",
            "interactivity",
            "others",
        ]

        groupOrder.forEach((groupName) => {
            if (baseClasses[groupName].length > 0) {
                if (result) {
                    result += ""
                }
                result += baseClasses[groupName].join(" ") + "\n"
            }
        })

        // Add pseudo/responsive classes
        Object.keys(pseudoClasses).forEach((prefix) => {
            if (pseudoClasses[prefix].length > 0) {
                if (result) {
                    result += ""
                }
                result += pseudoClasses[prefix].join(" ") + "\n"
            }
        })

        return result || classes.join(" ")
    }
}
