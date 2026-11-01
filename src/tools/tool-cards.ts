import chalk from "chalk";
import terminalSize from "terminal-size";
import { groupDiffHunks, toPairs, type DiffLine, type DiffPair, type DiffRow } from "./card-diff.js";
import { type LinePart, type Style } from "./card-types.js";

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

function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    if (maxLen <= 0) return "";
    if (maxLen <= 3) return ".".repeat(maxLen);
    return text.slice(0, maxLen - 3) + "...";
}

const PAD = "  ";
const FALLBACK_WIDTH = 80;
const SPLIT_MIN_WIDTH = 80;
const INNER_WIDTH = width() - PAD.length * 2;

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
    replaceAll: boolean;
    ok: boolean;
    /**
     * Line-level diff of the whole file. Present on success; the card renders
     * nothing but the header and status when absent.
     */
    diff?: DiffLine[] | undefined;
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

    /** Keep maxLines of text, every lines truncated by maxLen */
    private static blockLines(text: string, maxLines: number, maxLen: number): string[] {
        const parts = text.split("\n");
        const shown = parts.slice(0, maxLines);
        return shown.map((raw) => {
            return truncate(raw.replace(/\r$/, ""), Math.max(0, maxLen));
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
        ToolCards.line([{
            text: "edit ",
            style: S.header,
        }, {
            text: opts.filePath,
            style: S.headerContent,
        }], S.header);

        if (opts.ok && opts.diff && opts.diff.length > 0) {
            const MAX_HUNKS = 3;
            const MAX_ROWS = 10;
            const hunks = groupDiffHunks(opts.diff);
            const moreHunks = hunks.length - MAX_HUNKS;
            const shownHunks = moreHunks > 0 ? hunks.slice(0, MAX_HUNKS) : hunks;

            const renderSingle = (rows: DiffRow[]): void => {
                const capped = ToolCards.capRows(rows, MAX_ROWS);
                // Calculate the most characters line numbers can occupy.
                let gutter = 1;
                for (const row of capped) {
                    if (row.kind === "gap") continue;
                    gutter = Math.max(
                        gutter,
                        String(row.oldLine ?? row.newLine ?? 0).length
                    );
                }
                const textMax = Math.max(4, INNER_WIDTH - 2 - gutter - 1);
                for (const row of capped) {
                    if (row.kind === "gap") {
                        ToolCards.line([{ text: row.text, style: S.body }], S.body);
                        continue;
                    }
                    const [sign, ln, style] = (
                        row.kind === "add" ? ["+", row.newLine, S.add] :
                        row.kind === "del" ? ["-", row.oldLine, S.del] :
                        [" ", "", S.body]
                    );
                    const text = truncate(row.text.replace(/\r$/, ""), textMax);
                    ToolCards.line([{ text: sign + String(ln ?? "").padStart(gutter) + " " + text, style }], S.body);
                }
            };

            const renderSplit = (rows: DiffRow[]): void => {
                const capped = ToolCards.capPairs(toPairs(rows), MAX_ROWS);
                const SEP = " \u2502 ";
                const cellTotal = INNER_WIDTH - SEP.length;
                const leftW = Math.floor(cellTotal / 2);
                const rightW = cellTotal - leftW;

                let leftGutter = 1;
                let rightGutter = 1;
                for (const pair of capped) {
                    if (pair.kind === "gap") continue;
                    leftGutter = Math.max(leftGutter, String(pair.left?.oldLine ?? 0).length);
                    rightGutter = Math.max(rightGutter, String(pair.right?.newLine ?? 0).length);
                }

                const leftMax = Math.max(4, leftW - 2 - leftGutter);
                const rightMax = Math.max(4, rightW - 2 - rightGutter);

                const cell = (
                    line: DiffLine | undefined, side: "old" | "new",
                    cellW: number, gutterW: number, maxLen: number
                ): LinePart => {
                    if (!line) return { text: "\u2591".repeat(cellW), style: S.body };
                    const ln = side === "old" ? line.oldLine : line.newLine;
                    const [sign, style] = (
                        line.kind === "add" ? ["+", S.add] :
                        line.kind === "del" ? ["-", S.del] :
                        [" ", S.body]
                    );
                    const text = truncate(line.text.replace(/\r$/, ""), maxLen);
                    return { text: (sign + String(ln ?? "").padStart(gutterW) + " " + text).padEnd(cellW), style };
                };

                for (const pair of capped) {
                    if (pair.kind === "gap") {
                        ToolCards.line([{ text: pair.text, style: S.body }], S.body);
                        continue;
                    }
                    ToolCards.line([
                        cell(pair.left, "old", leftW, leftGutter, leftMax),
                        { text: SEP, style: S.body },
                        cell(pair.right, "new", rightW, rightGutter, rightMax),
                    ], S.body);
                }
            };

            shownHunks.forEach((hunk, index) => {
                if (index > 0) {
                    const gapText = hunk.gap?.text ?? "...";
                    ToolCards.line([{ text: gapText, style: S.body }], S.body);
                }
                if (INNER_WIDTH < SPLIT_MIN_WIDTH) {
                    renderSingle(hunk.rows);
                } else {
                    renderSplit(hunk.rows);
                }
            });

            if (moreHunks > 0) {
                ToolCards.line([{ text: "... " + moreHunks + " more hunk" + (moreHunks === 1 ? "" : "s"), style: S.body }], S.body);
            }
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

    private static capRows(rows: DiffRow[], maxRows: number): DiffRow[] {
        if (rows.length <= maxRows) return rows;
        const shown = rows.slice(0, maxRows - 1);
        const hidden = rows.length - shown.length;
        return [...shown, { kind: "gap", text: "... " + hidden + " more line" + (hidden === 1 ? "" : "s") }];
    }

    private static capPairs(pairs: DiffPair[], maxRows: number): DiffPair[] {
        if (pairs.length <= maxRows) return pairs;
        const shown = pairs.slice(0, maxRows - 1);
        const hidden = pairs.length - shown.length;
        return [...shown, { kind: "gap", text: "... " + hidden + " more line" + (hidden === 1 ? "" : "s") }];
    }
}
