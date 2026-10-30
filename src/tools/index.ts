import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { isEditParams, isPwshParams, isReadParams, isWriteParams, type PwshResult, type ReadResult } from "./types.js";
import { ToolCards } from "./tool-cards.js";

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
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
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

/**
 * Editing tools handed to the clipboard code, so agent can use this object to
 * do edit.
 */
export class Tools {
    private readonly root: string;

    constructor(root: string = process.cwd()) {
        this.root = path.resolve(root);
    }

    /** Read a UTF-8 text file and return line-numbered content. */
    read(params: unknown): ReadResult {
        if (!isReadParams(params)) {
            ToolCards.read({ filePath: "", ok: false });
            throw new Error("Read failed: invalid parameters.");
        }
        const filePath = params.file_path;
        const target = this.resolve(filePath);
        let content: string;
        try {
            content = readFileSync(target, "utf8");
        } catch (error) {
            ToolCards.read({ filePath, ok: false });
            throw new Error(`Read failed for ${filePath}: ${describeError(error)}`);
        }
        const allLines = content.split("\n");
        const offset = params.offset ? params.offset - 1 : 0;
        const limit = params.limit ?? DEFAULT_READ_LIMIT;
        ToolCards.read({ filePath, ok: true });
        return {
            path: filePath,
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
            ToolCards.write({ filePath: "", content: "", ok: false });
            throw new Error("Write failed: invalid parameters.");
        }
        const filePath = params.file_path;
        const target = this.resolve(filePath);

        try {
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, params.content, "utf8");
        } catch (error) {
            ToolCards.write({ filePath, content: params.content, ok: false });
            throw new Error(`Write failed for ${filePath}: ${describeError(error)}`);
        }
        ToolCards.write({ filePath, content: params.content, ok: true });
    }

    /**
     * Replace literal text in a file.
     *
     * `old_string` has to be unique unless `replace_all` is true, and an empty
     * `old_string` is rejected because it would match everywhere.
     */
    edit(params: unknown): void {
        if (!isEditParams(params)) {
            ToolCards.edit({ filePath: "", oldText: "", newText: "", replaceAll: false, ok: false });
            throw new Error("Edit failed: invalid parameters.");
        }

        const filePath = params.file_path;
        const oldText = params.old_string;
        const newText = params.new_string;
        const replaceAll = params.replace_all === true;

        if (oldText.length === 0) {
            ToolCards.edit({ filePath, oldText, newText, replaceAll, ok: false });
            throw new Error("Edit failed: old_string must not be empty.");
        }

        const target = this.resolve(filePath);
        let original: string;
        try {
            original = readFileSync(target, "utf8");
        } catch (error) {
            ToolCards.edit({ filePath, oldText, newText, replaceAll, ok: false });
            throw new Error(`Edit failed for ${filePath}: ${describeError(error)}`);
        }

        const firstIndex = original.indexOf(oldText);
        if (firstIndex === -1) {
            // Old text not found
            ToolCards.edit({ filePath, oldText, newText, replaceAll, ok: false });
            throw new Error(`Edit failed for ${filePath}: old_string was not found.`);
        }

        const secondIndex = original.indexOf(oldText, firstIndex + oldText.length);
        if (secondIndex !== -1 && !replaceAll) {
            // No replaceAll but find more than one occurrances.
            ToolCards.edit({ filePath, oldText, newText, replaceAll, ok: false });
            throw new Error(
                `Edit failed for ${filePath}: old_string appears multiple times. `
                + "Make it unique or pass replace_all = true."
            );
        }

        // Use function as the second parameter, or parameter like "$$" will be
        // interpreted to have special meaning:
        // "123".replaceAll("2","$$") will be "1$3"
        const updated = original.replaceAll(oldText, () => newText);

        try {
            writeFileSync(target, updated, "utf8");
        } catch (error) {
            ToolCards.edit({ filePath, oldText, newText, replaceAll, ok: false });
            throw new Error(`Edit failed for ${filePath}: ${describeError(error)}`);
        }
        ToolCards.edit({ filePath, oldText, newText, replaceAll, ok: true });
    }

    /**
     * Run a PowerShell command synchronously and return its output.
     */
    pwsh(params: unknown): PwshResult {
        if (!isPwshParams(params)) {
            ToolCards.pwsh({ command: "", exitCode: null, ok: false });
            throw new Error("Pwsh failed: invalid parameters.");
        }

        const command = params.command;
        const timeout = params.timeoutMs ?? DEFAULT_PWSH_TIMEOUT;
        const cwd = params.cwd ? this.resolve(params.cwd) : this.root;
        const encoded = Buffer.from(PWSH_PRELUDE + "\n" + command, "utf16le").toString("base64");

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

                if (code === "ENOENT") continue;
                ToolCards.pwsh({ command, exitCode: null, ok: false });
                if (code === "ETIMEDOUT") {
                    throw new Error("Pwsh timed out after " + timeout + " ms.");
                }

                throw new Error("Pwsh failed: " + result.error.message);
            }

            ToolCards.pwsh({ command, exitCode: result.status, ok: true });
            return {
                stdout: result.stdout,
                stderr: decodePowerShellStderr(result.stderr),
                exitCode: result.status,
            };
        }

        ToolCards.pwsh({ command, exitCode: null, ok: false });
        throw new Error("Pwsh failed: PowerShell is not available on this machine.");
    }

    private resolve(filePath: string): string {
        return path.resolve(this.root, filePath);
    }
}
