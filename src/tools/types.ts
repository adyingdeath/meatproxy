/** Read a UTF-8 text file and return line-numbered content. */
export interface ReadParams {
    /** Path of the file to read, resolved against current working directory. */
    file_path: string;
    /** 1-based first line to return. Defaults to 1. */
    offset?: number;
    /** Maximum number of lines to return. Defaults to 2000. */
    limit?: number;
}

export interface ReadResult {
    path: string;
    offset: number;
    lines: {
        number: number;
        text: string;
    }[];
    totalLines: number;
}

export interface WriteParams {
    /** Path of the file to write, resolved against the tool root. */
    file_path: string;
    /** Full UTF-8 contents of the file. */
    content: string;
}

export interface EditParams {
    /** Path of the file to edit, resolved against the tool root. */
    file_path: string;
    /** Literal text to look for. It has to be unique unless `replace_all` is set. */
    old_string: string;
    /** Replacement text. An empty string deletes the match. */
    new_string: string;
    /** Replace every occurrence instead of requiring a unique match. */
    replace_all?: boolean;
}

export interface PwshParams {
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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
    return value === undefined || typeof value === "boolean";
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === "string";
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
    return value === undefined
        || (typeof value === "number" && Number.isInteger(value) && value >= 1);
}

export function isReadParams(value: unknown): value is ReadParams {
    return isRecord(value)
        && isNonEmptyString(value.file_path)
        && isOptionalPositiveInteger(value.offset)
        && isOptionalPositiveInteger(value.limit);
}

export function isWriteParams(value: unknown): value is WriteParams {
    return isRecord(value)
        && isNonEmptyString(value.file_path)
        && typeof value.content === "string";
}

export function isEditParams(value: unknown): value is EditParams {
    return isRecord(value)
        && isNonEmptyString(value.file_path)
        && typeof value.old_string === "string"
        && typeof value.new_string === "string"
        && isOptionalBoolean(value.replace_all);
}

export function isPwshParams(value: unknown): value is PwshParams {
    return isRecord(value)
        && typeof value.command === "string"
        && isOptionalString(value.cwd)
        && isOptionalPositiveInteger(value.timeoutMs);
}