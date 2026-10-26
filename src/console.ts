import { format } from "util";

/** Console handed to the clipboard code as the `console` parameter. */
export class Console {
    /** Everything written so far, one entry per console call. */
    readonly lines: string[] = [];

    log(...args: unknown[]): void {
        this.lines.push(format(...args));
    };
}
