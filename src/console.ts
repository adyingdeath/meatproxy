import { format } from "node:util";

/**
 * Console handed to the clipboard code as the `console` parameter.
 *
 * Every call is forwarded to the real console and also recorded as formatted
 * text, so the output can be copied to the clipboard afterwards. Methods are
 * bound, which keeps `const { log }console` working.
 */
export class OutputConsole {
    /** Everything written so far, one entry per console call. */
    readonly lines: string[] = [];

    log(...args: unknown[]): void {
        console.log(...args);
        this.lines.push(format(...args));
    };

    info(...args: unknown[]): void {
        console.info(...args);
        this.lines.push(format(...args));
    };

    warn(...args: unknown[]): void {
        console.warn(...args);
        this.lines.push(format(...args));
    };

    error(...args: unknown[]): void {
        console.error(...args);
        this.lines.push(format(...args));
    };

    debug(...args: unknown[]): void {
        console.debug(...args);
        this.lines.push(format(...args));
    };
}
