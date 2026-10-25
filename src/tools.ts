import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "path";

export interface ReadRequest {
    /** Path of the file to read, resolved against the tool root. */
    file_path: string;
}

export interface WriteRequest {
    /** Path of the file to write, resolved against the tool root. */
    file_path: string;
    /** Full UTF-8 contents of the file. */
    content: string;
}

export interface EditRequest {
    /** Path of the file to edit, resolved against the tool root. */
    file_path: string;
    /** Literal text to look for. It has to be unique unless `replace_all` is set. */
    old_string: string;
    /** Replacement text. An empty string deletes the match. */
    new_string: string;
    /** Replace every occurrence instead of requiring a unique match. */
    replace_all?: boolean;
}

export interface PwshRequest {
    /** PowerShell command or script to run. */
    command: string;
    /** Working directory, resolved against the tool root. Defaults to the tool root. */
    cwd?: string;
    /** Timeout in milliseconds. Defaults to 120000. */
    timeoutMs?: number;
}

export interface PwshResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

const DEFAULT_PWSH_TIMEOUT = 120_000;
const MAX_PWSH_OUTPUT_BYTES = 16 * 1024 * 1024;

// PowerShell encodes redirected output with the console code page by default, which
// mangles non-ASCII text, and it reports progress records on stderr. Switch the
// output to UTF-8 without a BOM and silence progress before running anything.
const PWSH_PRELUDE = [
    "$ProgressPreference = 'SilentlyContinue'",
    "try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}",
].join("\n");

// Windows PowerShell serializes error records as CLIXML when stderr is redirected.
const CLIXML_ERROR_PATTERN = /<S S="Error">([\s\S]*?)<\/S>/g;

function unescapeClixml(text: string): string {
    return text
        .replace(/_x([0-9a-f]{4})_/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function decodePowerShellStderr(stderr: string): string {
    if (!stderr.startsWith("#< CLIXML")) {
        return stderr;
    }

    const messages = Array.from(stderr.matchAll(CLIXML_ERROR_PATTERN), (match) =>
        unescapeClixml(match[1] ?? ""),
    );

    return messages.length > 0 ? messages.join("") : stderr;
}

function shellCandidates(): string[] {
    // PowerShell 7 first (it supports && and friends), Windows PowerShell as fallback.
    return process.platform === "win32" ? ["pwsh", "powershell.exe"] : ["pwsh"];
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function requirePath(value: unknown, method: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${method} failed: file_path must be a non-empty string.`);
    }

    return value;
}

function requireText(value: unknown, method: string, field: string): string {
    if (typeof value !== "string") {
        throw new TypeError(`${method} failed: ${field} must be a string.`);
    }

    return value;
}

function countOccurrences(text: string, search: string): number {
    let count = 0;
    let index = text.indexOf(search);

    while (index !== -1) {
        count += 1;
        index = text.indexOf(search, index + search.length);
    }

    return count;
}

function replaceFirst(text: string, search: string, replacement: string): string {
    const index = text.indexOf(search);
    if (index === -1) {
        return text;
    }

    return text.slice(0, index) + replacement + text.slice(index + search.length);
}

/**
 * Editing tools handed to the clipboard code, so agent can use this object to
 * do edit.
 *
 * The code is compiled with a single parameter named `tools`, so it can call
 * `tools.read({ file_path })`, `tools.write({ file_path, content })`,
 * `tools.edit({ file_path, old_string, new_string })` and `tools.pwsh({ command })`.
 * All paths are resolved against `root` (the current working directory by default).
 */
export class Tools {
    private readonly root: string;

    constructor(root: string = process.cwd()) {
        this.root = path.resolve(root);
    }

    /** Read a UTF-8 text file and return its full contents. */
    read(request: ReadRequest): string {
        const filePath = requirePath(request?.file_path, "read");
        const target = this.resolve(filePath);

        try {
            return readFileSync(target, "utf8");
        } catch (error) {
            throw new Error(`Read failed for ${filePath}: ${describeError(error)}`);
        }
    }

    /** Create or fully overwrite a UTF-8 text file, creating parent directories. */
    write(request: WriteRequest): void {
        const filePath = requirePath(request?.file_path, "write");
        const content = requireText(request?.content, "write", "content");
        const target = this.resolve(filePath);

        try {
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, content, "utf8");
        } catch (error) {
            throw new Error(`Write failed for ${filePath}: ${describeError(error)}`);
        }
    }

    /**
     * Replace literal text in a file.
     *
     * `old_string` has to be unique unless `replace_all` is true, and an empty
     * `old_string` is rejected because it would match everywhere.
     */
    edit(request: EditRequest): void {
        const filePath = requirePath(request?.file_path, "edit");
        const oldText = requireText(request?.old_string, "edit", "old_string");
        const newText = requireText(request?.new_string, "edit", "new_string");

        if (oldText.length === 0) {
            throw new Error("Edit failed: old_string must not be empty.");
        }

        const original = this.read({ file_path: filePath });
        const occurrences = countOccurrences(original, oldText);

        if (occurrences === 0) {
            throw new Error(`Edit failed for ${filePath}: old_string was not found.`);
        }

        if (occurrences > 1 && !request.replace_all) {
            throw new Error(
                `Edit failed for ${filePath}: old_string appears ${occurrences} times. ` +
                    "Make it unique or pass replace_all = true.",
            );
        }

        const updated = request.replace_all
            ? original.split(oldText).join(newText)
            : replaceFirst(original, oldText, newText);

        this.write({ file_path: filePath, content: updated });
    }

    /**
     * Run a PowerShell command synchronously and return its output.
     *
     * A non-zero `exitCode` is returned instead of thrown, so the code can inspect
     * `stdout` and `stderr` itself. The command runs with `pwsh` when it is
     * available and falls back to `powershell.exe` on Windows.
     */
    pwsh(request: PwshRequest): PwshResult {
        const command = requireText(request?.command, "pwsh", "command");
        const timeout = request.timeoutMs ?? DEFAULT_PWSH_TIMEOUT;
        const cwd = request.cwd ? this.resolve(request.cwd) : this.root;
        const encoded = Buffer.from(`${PWSH_PRELUDE}\n${command}`, "utf16le").toString("base64");

        for (const shell of shellCandidates()) {
            const result = spawnSync(
                shell,
                ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                {
                    cwd,
                    encoding: "utf8",
                    maxBuffer: MAX_PWSH_OUTPUT_BYTES,
                    timeout,
                    windowsHide: true,
                },
            );

            if (result.error) {
                const code = (result.error as NodeJS.ErrnoException).code;

                if (code === "ENOENT") {
                    continue;
                }

                if (code === "ETIMEDOUT") {
                    throw new Error(`Pwsh timed out after ${timeout} ms.`);
                }

                throw new Error(`Pwsh failed: ${result.error.message}`);
            }

            return {
                stdout: result.stdout,
                stderr: decodePowerShellStderr(result.stderr),
                exitCode: result.status,
            };
        }

        throw new Error("Pwsh failed: PowerShell is not available on this machine.");
    }

    private resolve(filePath: string): string {
        return path.resolve(this.root, filePath);
    }
}
