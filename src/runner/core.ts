import clipboard from "clipboardy";
import { Console } from "./console.js";
import { Tools } from "../tools/index.js";
import chalk from "chalk";

export const HEAD_MARKER = "<<<<<<< MEATPROXY";
export const TAIL_MARKER = ">>>>>>> MEATPROXY";

export const OUTPUT_HEAD_MARKER = "<<<<<<< MEATPROXY OUTPUT";
export const OUTPUT_TAIL_MARKER = ">>>>>>> MEATPROXY OUTPUT";

const INVALID_MARKER_MESSAGE = `Error: Invalid format.
Expected format:
${HEAD_MARKER}
...code...
${TAIL_MARKER}`

export type ExtractResult =
    | { status: "ok"; code: string }
    | { status: "empty" }
    | { status: "error"; message: string };

/**
 * Extract the code between the MEATPROXY markers.
 *
 * Exactly one head marker and one tail marker are expected, with the tail after
 * the head.
 */
export function extractCodeBlock(text: string): ExtractResult {
    const lines = text.split(/\r?\n/);
    const heads: number[] = [];
    const tails: number[] = [];

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === HEAD_MARKER) {
            heads.push(index);
        } else if (trimmed === TAIL_MARKER) {
            tails.push(index);
        }
    });

    if (heads.length === 0 && tails.length === 0) {
        return { status: "error", message: INVALID_MARKER_MESSAGE };
    }

    if (heads.length > 1 || tails.length > 1) {
        return { status: "error", message: "Error: Found more than one pair of MEATPROXY markers." };
    }

    const head = heads[0];
    const tail = tails[0];

    if (head === undefined || tail === undefined || tail < head) {
        return { status: "error", message: INVALID_MARKER_MESSAGE };
    }

    const code = lines
        .slice(head + 1, tail)
        .join("\n")
        .trim();

    if (code.length === 0) {
        return { status: "empty" };
    }

    return { status: "ok", code };
}


// Function bodies are normally sync; an async body lets the clipboard code use
// top-level await (for example `await tools.pwsh(...)`).
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
) => (...params: unknown[]) => Promise<unknown>;

/**
 * Read the clipboard, pull the MEATPROXY code block out of it, run that code and
 * copy whatever it printed back to the clipboard for the next round.
 */
export async function run(): Promise<void> {
    let text: string;

    try {
        text = await clipboard.read();
    } catch (error) {
        console.log(chalk.red("could not read the clipboard"));
        return;
    }

    const vmConsole = new Console();

    const result = extractCodeBlock(text);
    if (result.status === "empty") {
        console.log("Nothing happens.");
        return;
    }

    if (result.status === "error") {
        vmConsole.log(result.message);
    } else {
        try {
            const func = new AsyncFunction("tools", "console", result.code);
            await func(new Tools(), vmConsole);
        } catch (error) {
            vmConsole.log(error);
        }
    }

    if (vmConsole.lines.length === 0) {
        console.log("No output to copy.");
        return;
    }

    try {
        await clipboard.write(
            OUTPUT_HEAD_MARKER +
            vmConsole.lines.join("\n") +
            OUTPUT_TAIL_MARKER
        );
    } catch (error) {
        console.log(chalk.red("could not write to the clipboard"));
        return;
    }

    console.log("Output copied to the clipboard. Paste it back to the agent.");
}
