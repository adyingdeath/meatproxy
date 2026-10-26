import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { isEditParams, isPwshParams, isReadParams, isWriteParams, type PwshResult, type ReadResult } from "./types.js";

const DEFAULT_PWSH_TIMEOUT = 120_000;
const DEFAULT_READ_LIMIT = 2000;
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
 * `tools.read({ file_path, offset, limit })`, `tools.write({ file_path, content })`,
 * `tools.edit({ file_path, old_string, new_string })` and `tools.pwsh({ command })`.
 * All paths are resolved against `root` (the current working directory by default).
 */
export class Tools {
    private readonly root: string;

    constructor(root: string = process.cwd()) {
        this.root = path.resolve(root);
    }

    /** Read a UTF-8 text file and return line-numbered content. */
    read(params: unknown): ReadResult {
        if (!isReadParams(params)) {
            throw new Error("Read failed: invalid parameters.");
        }

        const target = this.resolve(params.file_path);
        let content: string;

        try {
            content = readFileSync(target, "utf8");
        } catch (error) {
            throw new Error(`Read failed for ${params.file_path}: ${describeError(error)}`);
        }

        const allLines = content.split("\n");
        const offset = params.offset ? params.offset - 1 : 0;
        const limit = params.limit ?? DEFAULT_READ_LIMIT;

        return {
            path: params.file_path,
            offset,
            lines: allLines.slice(offset, offset + limit).map((text, index) => ({
                number: offset + index + 1,
                text,
            })),
            totalLines: allLines.length,
        };
    }

    /** Create or fully overwrite a UTF-8 text file, creating parent directories. */
    write(params: unknown): void {
        if (!isWriteParams(params)) {
            throw new Error("Write failed: invalid parameters.");
        }

        const target = this.resolve(params.file_path);

        try {
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, params.content, "utf8");
        } catch (error) {
            throw new Error(`Write failed for ${params.file_path}: ${describeError(error)}`);
        }
    }

    /**
     * Replace literal text in a file.
     *
     * `old_string` has to be unique unless `replace_all` is true, and an empty
     * `old_string` is rejected because it would match everywhere.
     */
    edit(params: unknown): void {
        if (!isEditParams(params)) {
            throw new Error("Edit failed: invalid parameters.");
        }

        const filePath = params.file_path;
        const oldText = params.old_string;
        const newText = params.new_string;
        const replaceAll = params.replace_all === true;

        if (oldText.length === 0) {
            throw new Error("Edit failed: old_string must not be empty.");
        }

        let original: string;
        try {
            original = readFileSync(this.resolve(filePath), "utf8");
        } catch (error) {
            throw new Error(`Edit failed for ${filePath}: ${describeError(error)}`);
        }

        const occurrences = countOccurrences(original, oldText);

        if (occurrences === 0) {
            throw new Error(`Edit failed for ${filePath}: old_string was not found.`);
        }

        if (occurrences > 1 && !replaceAll) {
            throw new Error(
                `Edit failed for ${filePath}: old_string appears ${occurrences} times. ` +
                "Make it unique or pass replace_all = true.",
            );
        }

        const updated = replaceAll
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
    pwsh(params: unknown): PwshResult {
        if (!isPwshParams(params)) {
            throw new Error("Pwsh failed: invalid parameters.");
        }

        const command = params.command;
        const timeout = params.timeoutMs ?? DEFAULT_PWSH_TIMEOUT;
        const cwd = params.cwd ? this.resolve(params.cwd) : this.root;
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
