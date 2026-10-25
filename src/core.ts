import clipboard from 'clipboardy';

export const HEAD_MARKER = '<<<<<<< MEATPROXY';
export const TAIL_MARKER = '>>>>>>> MEATPROXY';

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
        .join('\n')
        .trim();

    if (code.length === 0) {
        console.log("No code. Nothing happens.");
        return "";
    }

    return code;
}


/**
 * read the clipboard, pull the MEATPROXY code block out of it and run that code.
 */
export async function run(): Promise<void> {
    let text: string;

    try {
        text = await clipboard.read();
    } catch (error) {
        console.log("could not read the clipboard");
        return;
    }

    try {
        const code = extractCodeBlock(text);
        // TODO: a Tool class containing necessary tools for agent to do edit.
        const func = new Function("", code);
        func();
    } catch (error) {
        console.log(error);
    }
}
