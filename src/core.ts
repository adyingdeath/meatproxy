import clipboard from "clipboardy";
import { Console } from "./console.js";
import { Tools } from "./tools.js";
import chalk from "chalk";

export const HEAD_MARKER = "<<<<<<< MEATPROXY";
export const TAIL_MARKER = ">>>>>>> MEATPROXY";

const INVALID_MARKER_MESSAGE = `Error: Invalid format.
Expected format:
${HEAD_MARKER}
...code...
${TAIL_MARKER}`

/**
 * Extract the code between the MEATPROXY markers.
 *
 * Exactly one head marker and one tail marker are expected, with the tail after
 * the head.
 */
export function extractCodeBlock(text: string): string {
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
        console.log(INVALID_MARKER_MESSAGE);
        return "";
    }

    if (heads.length > 1 || tails.length > 1) {
        console.log("Error: Found more than one pair of MEATPROXY markers.");
        return "";
    }

    const head = heads[0];
    const tail = tails[0];

    if (head === undefined) {
        console.log(INVALID_MARKER_MESSAGE);
        return "";
    }

    if (tail === undefined) {
        console.log(INVALID_MARKER_MESSAGE);
        return "";
    }

    if (tail < head) {
        console.log(INVALID_MARKER_MESSAGE);
        return "";
    }

    const code = lines
        .slice(head + 1, tail)
        .join("\n")
        .trim();

    if (code.length === 0) {
        console.log("No code. Nothing happens.");
        return "";
    }

    return code;
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

    const code = extractCodeBlock(text);
    if (code.length === 0) {
        return;
    }

    const vmConsole = new Console();

    try {
        const func = new AsyncFunction("tools", "console", code);
        await func(new Tools(), vmConsole);
    } catch (error) {
        vmConsole.log(error);
    }

    if (vmConsole.lines.length === 0) {
        console.log("No output to copy.");
        return;
    }

    try {
        await clipboard.write(vmConsole.lines.join("\n"));
    } catch (error) {
        console.log(chalk.red("could not write to the clipboard"));
        return;
    }

    console.log("Output copied to the clipboard. Paste it back to the agent.");
}
