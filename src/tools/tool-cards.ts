import chalk from "chalk";
import terminalSize from "terminal-size";

function width(): number {
    let cols = FALLBACK_WIDTH;
    try {
        const size = terminalSize();
        if (Number.isFinite(size.columns) && size.columns > 0) cols = size.columns;
    } catch {
        // ignore
    }
    if (cols <= 64) return cols;
    if (cols <= 74) return 64;
    return cols - 10;
}

const PAD = "  ";
const FALLBACK_WIDTH = 80;
const SPLIT_MIN_WIDTH = 80;
const INNER_WIDTH = width() - PAD.length * 2;

type Style = (text: string) => string;

// #fcebdf oklch(0.95 0.025 56)
// #783f09 oklch(0.43 0.1 56)
// #34251a oklch(0.28 0.03 56)
// #f5f1ef oklch(0.96 0.005 56)
// #005E19 oklch(0.42 0.13 146)
// #94020d oklch(0.42 0.17 27)
// #595101 oklch(0.43 0.09 103)
const S = {
    header: (t: string) => chalk.bgHex("#fcebdf").hex("#783f09")(t),
    headerContent: (t: string) => chalk.bgHex("#fcebdf").hex("#34251a")(t),
    body: (t: string) => chalk.bgHex("#f5f1ef").hex("#34251a")(t),
    ok: (t: string) => chalk.bgHex("#f5f1ef").hex("#005E19")(t),
    fail: (t: string) => chalk.bgHex("#f5f1ef").hex("#94020d")(t),
    warn: (t: string) => chalk.bgHex("#f5f1ef").hex("#595101")(t),
    del: (t: string) => chalk.bgHex("#f5f1ef").hex("#94020d")(t),
    add: (t: string) => chalk.bgHex("#f5f1ef").hex("#005E19")(t),
} as const;

interface LinePart {
    text: string;
    style: Style;
}

export interface ReadCardOptions {
    filePath: string;
    ok: boolean;
}

export interface WriteCardOptions {
    filePath: string;
    content: string;
    ok: boolean;
}

export interface EditCardOptions {
    filePath: string;
    oldText: string;
    newText: string;
    replaceAll: boolean;
    ok: boolean;
}

export interface PwshCardOptions {
    command: string;
    exitCode: number | null;
    ok: boolean;
}

export class ToolCards {
    private constructor() { }

    /** Total width of tools cards. */
    private static width(): number {
        let cols = FALLBACK_WIDTH;
        try {
            const size = terminalSize();
            if (Number.isFinite(size.columns) && size.columns > 0) cols = size.columns;
        } catch {
            // ignore
        }
        if (cols <= 64) return cols;
        if (cols <= 74) return 64;
        return cols - 10;
    }

    private static truncate(text: string, maxLen: number): string {
        if (text.length <= maxLen) return text;
        if (maxLen <= 0) return "";
        if (maxLen <= 3) return ".".repeat(maxLen);
        return text.slice(0, maxLen - 3) + "...";
    }

    /** Keep maxLines of text, every lines truncated by maxLen */
    private static blockLines(text: string, maxLines: number, maxLen: number): string[] {
        const parts = text.split("\n");
        const shown = parts.slice(0, maxLines);
        return shown.map((raw) => {
            return ToolCards.truncate(raw.replace(/\r$/, ""), Math.max(0, maxLen));
        });
    }

    private static line(parts: LinePart[], padStyle: Style = S.body): void {
        let used = 0;
        let lastStyle = padStyle;
        const chunks: string[] = [];

        for (const part of parts) {
            if (used >= INNER_WIDTH) break;

            const room = INNER_WIDTH - used;
            const text = part.text.length > room
                ? part.text.slice(0, room - 3) + "..."
                : part.text;

            if (text.length === 0) continue;

            chunks.push(part.style(text));
            used += text.length;
            lastStyle = part.style;
        }

        let padding = "";
        if (used < INNER_WIDTH) {
            padding = lastStyle(" ".repeat(INNER_WIDTH - used));
        }

        console.log(padStyle(PAD) + chunks.join("") + padding + padStyle(PAD));
    }

    // Cards for different tools.

    static read(opts: ReadCardOptions): void {
        this.line([{
            text: "read ",
            style: S.header,
        }, {
            text: opts.filePath,
            style: S.headerContent,
        }], S.header);
        if (opts.ok) {
            this.line([{ text: "success", style: S.ok }], S.body);
        } else {
            this.line([{ text: "failed", style: S.fail }], S.body);
        }
        console.log();
    }

    static write(opts: WriteCardOptions): void {
        const BLOCK_MAX_LINES = 2;
        this.line([{
            text: "write ",
            style: S.header,
        }, {
            text: opts.filePath,
            style: S.headerContent,
        }], S.header);
        if (opts.content) {
            for (const text of ToolCards.blockLines(opts.content, BLOCK_MAX_LINES, INNER_WIDTH)) {
                this.line([{ text, style: S.body }], S.body);
            }
        }
        if (opts.ok) {
            this.line([{ text: "success", style: S.ok }], S.body);
        } else {
            this.line([{ text: "failed", style: S.fail }], S.body);
        }
        console.log();
    }

    static edit(opts: EditCardOptions): void {
        const BLOCK_MAX_LINES = 8
        const SEP = " \u2502 ";

        const drawDiff = (from: string, to: string): void => {
            const cellTotal = INNER_WIDTH - 4 - SEP.length;

            if (INNER_WIDTH < SPLIT_MIN_WIDTH || cellTotal < 10) {
                const bodyMax = INNER_WIDTH - 2;
                for (const text of ToolCards.blockLines(from, BLOCK_MAX_LINES, bodyMax)) {
                    ToolCards.line([{ text: "- " + text, style: S.del }], S.body);
                }
                for (const text of ToolCards.blockLines(to, BLOCK_MAX_LINES, bodyMax)) {
                    ToolCards.line([{ text: "+ " + text, style: S.add }], S.body);
                }
                return;
            }

            const leftW = Math.floor(cellTotal / 2);
            const rightW = cellTotal - leftW;
            const left = ToolCards.blockLines(from, BLOCK_MAX_LINES, leftW);
            const right = ToolCards.blockLines(to, BLOCK_MAX_LINES, rightW);

            for (let i = 0; i < Math.max(left.length, right.length); i++) {
                const a = left[i];
                const b = right[i];
                const leftText = a === undefined ? "░".repeat(leftW + 2) : "- " + a.padEnd(leftW);
                const rightText = b === undefined ? "░".repeat(rightW + 2) : "+ " + b.padEnd(rightW);
                ToolCards.line([
                    { text: leftText, style: a === undefined ? S.body : S.del },
                    { text: SEP, style: S.body },
                    { text: rightText, style: b === undefined ? S.body : S.add },
                ], S.body);
            }
        };

        ToolCards.line([{
            text: "edit ",
            style: S.header,
        }, {
            text: opts.filePath,
            style: S.headerContent,
        }], S.header);

        if (opts.ok && (opts.oldText.length > 0 || opts.newText.length > 0)) {
            drawDiff(opts.oldText, opts.newText);
        }

        if (opts.ok) {
            ToolCards.line([{ text: "success", style: S.ok }], S.body);
        } else {
            ToolCards.line([{ text: "failed", style: S.fail }], S.body);
        }
        console.log();
    }

    static pwsh(opts: PwshCardOptions): void {
        ToolCards.line([{
            text: "pwsh ",
            style: S.header,
        }, {
            text: opts.command.replace(/\r?\n/g, " "),
            style: S.headerContent,
        }], S.header);

        if (!opts.ok) {
            ToolCards.line([{ text: "failed", style: S.fail }], S.body);
        } else {
            if (opts.exitCode === 0) {
                ToolCards.line([{ text: "success", style: S.ok }], S.body);
            } else {
                ToolCards.line([{ text: "exit " + opts.exitCode, style: S.warn }], S.body);
            }
        }
        console.log();
    }
}
