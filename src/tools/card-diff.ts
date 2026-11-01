import { diffLines } from "diff";

export type DiffLineKind = "add" | "del" | "ctx";

/** One line of a line-level diff, numbered against the old / new file. */
export interface DiffLine {
    kind: DiffLineKind;
    /** 1-based line number in the old file; undefined for added lines. */
    oldLine?: number | undefined;
    /** 1-based line number in the new file; undefined for removed lines. */
    newLine?: number | undefined;
    text: string;
}

/** A diff row, or a placeholder for a run of lines that was collapsed away. */
export type DiffRow = DiffLine | { kind: "gap"; text: string };

/** A split-view row: either a collapsed gap or a left/right pair. */
export type DiffPair =
    | { kind: "gap"; text: string }
    | { kind: "pair"; left?: DiffLine | undefined; right?: DiffLine | undefined };

/** A contiguous block of changed lines, optionally preceded by a collapsed gap. */
export interface DiffHunk {
    gap: { kind: "gap"; text: string } | undefined;
    // Here we use DiffRow instead of DiffLine, because render layer might
    // insert row like { kind: "gap"; text: "... N more lines" } for changes
    // block that spread too many lines, or similar other situations.
    rows: DiffRow[];
}

/**
 * Split one jsdiff change value into its individual lines, dropping the
 * trailing empty string produced by a final newline.
 */
function splitChangeValue(value: string): string[] {
    const parts = value.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts;
}

/**
 * Calculate one numbered row per line diff so the tool card can render a real
 * line-by-line diff.
 */
export function toDiffLines(original: string, updated: string): DiffLine[] {
    const changes = diffLines(original, updated, { stripTrailingCr: true });
    const rows: DiffLine[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (const change of changes) {
        for (const text of splitChangeValue(change.value)) {
            if (change.added) {
                rows.push({ kind: "add", newLine: newLine++, text });
            } else if (change.removed) {
                rows.push({ kind: "del", oldLine: oldLine++, text });
            } else {
                rows.push({ kind: "ctx", oldLine: oldLine++, newLine: newLine++, text });
            }
        }
    }

    return rows;
}

/**
 * Keep only lines within [-context, +context] range of a change line; collapse
 * the rest into gaps.
 * 
 * After that, we will get something like:
 * ```
 * [
 *   { kind: 'gap', text: '... 2 unchanged lines' },
 *   { kind: 'ctx', oldLine: 3, newLine: 3, text: 'row 3' },
 *   { kind: 'ctx', oldLine: 4, newLine: 4, text: 'row 4' },
 *   { kind: 'del', oldLine: 5            , text: 'row 5' },
 *   { kind: 'ctx', oldLine: 6, newLine: 5, text: 'row 6' },
 *   { kind: 'ctx', oldLine: 7, newLine: 6, text: 'row 7' },
 *   { kind: 'gap', text: '... 3 unchanged lines' }
 * ]
 * ```
 */
function hunkRows(lines: DiffLine[], context: number): DiffRow[] {
    const keep = new Array<boolean>(lines.length).fill(false);
    for (let i = 0; i < lines.length; i++) {
        const current = lines[i];
        if (!current || current.kind === "ctx") continue;
        const from = Math.max(0, i - context);
        const to = Math.min(lines.length - 1, i + context);
        for (let j = from; j <= to; j++) keep[j] = true;
    }

    const rows: DiffRow[] = [];
    for (let i = 0; i < lines.length;) {
        if (keep[i]) {
            const kept = lines[i];
            if (kept) rows.push(kept);
            i++;
            continue;
        }
        // Encounter a don't keep line.
        let j = i;
        while (j < lines.length && !keep[j]) j++;
        const skipped = j - i;
        rows.push({
            kind: "gap",
            text: "... " + skipped + " unchanged line" + (skipped === 1 ? "" : "s"),
        });
        i = j;
    }
    return rows;
}

/**
 * Filter a line diff into hunks, dropping leading/trailing unchanged context.
 * Each hunk carries the gap that separated it from the previous one.
 */
export function groupDiffHunks(lines: DiffLine[], context = 2): DiffHunk[] {
    const all = hunkRows(lines, context);
    let start = 0;
    let end = all.length;
    // Throw away all gaps at the very beginning and at the very end.
    while (start < end && all[start]?.kind === "gap") start++;
    while (end > start && all[end - 1]?.kind === "gap") end--;
    const trimmed = all.slice(start, end);
    if (trimmed.length === 0) return [];

    const hunks: DiffHunk[] = [];
    let pendingGap: { kind: "gap"; text: string } | undefined;
    let cur: DiffRow[] = [];
    for (const row of trimmed) {
        if (row.kind === "gap") {
            if (cur.length > 0) {
                hunks.push({ gap: pendingGap, rows: cur });
                cur = [];
            }
            pendingGap = row;
        } else {
            cur.push(row);
        }
    }
    if (cur.length > 0) hunks.push({ gap: pendingGap, rows: cur });
    return hunks;
}

/** Group rows into left/right pairs; unchanged lines pair with themselves. */
export function toPairs(rows: DiffRow[]): DiffPair[] {
    const pairs: DiffPair[] = [];
    for (let i = 0; i < rows.length;) {
        const row = rows[i];
        if (!row) { i++; continue; }
        if (row.kind === "gap") { pairs.push({ kind: "gap", text: row.text }); i++; continue; }
        if (row.kind === "ctx") { pairs.push({ kind: "pair", left: row, right: row }); i++; continue; }

        const lefts: DiffLine[] = [];
        const rights: DiffLine[] = [];
        while (i < rows.length) {
            const next = rows[i];
            if (!next || next.kind === "ctx" || next.kind === "gap") break;
            if (next.kind === "del") lefts.push(next);
            else rights.push(next);
            i++;
        }
        const count = Math.max(lefts.length, rights.length);
        for (let k = 0; k < count; k++) {
            // One side will be filled undefined if out of index, and those
            // undefined rows will be rendered as shadows later.
            pairs.push({ kind: "pair", left: lefts[k], right: rights[k] });
        }
    }
    return pairs;
}