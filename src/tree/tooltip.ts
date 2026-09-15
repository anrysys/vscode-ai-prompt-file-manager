import { formatBytes } from '../fs/paths';

/** A prompt can be thousands of lines; a hover card cannot. */
export const TOOLTIP_MAX_CHARS = 800;
export const TOOLTIP_MAX_LINES = 15;
export const TRUNCATION_NOTICE = '... (truncated)';

export interface TooltipPreview {
    readonly text: string;
    readonly truncated: boolean;
}

export interface TooltipParts {
    readonly fsPath: string;
    readonly size: number;
    /** Omitted when the body could not be read; `note` then explains why. */
    readonly preview?: TooltipPreview;
    readonly note?: string;
}

/** Clips a snippet body to something a hover card can hold, by lines first then characters. */
export function truncateForTooltip(
    content: string,
    maxChars: number = TOOLTIP_MAX_CHARS,
    maxLines: number = TOOLTIP_MAX_LINES,
): TooltipPreview {
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    let text = normalized;
    let truncated = false;

    if (lines.length > maxLines) {
        text = lines.slice(0, maxLines).join('\n');
        truncated = true;
    }
    if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        truncated = true;
    }

    return { text: text.replace(/\s+$/, ''), truncated };
}

/**
 * A fence long enough to survive the content.
 * A prompt about Markdown will itself contain ``` runs, which would otherwise close the
 * block early and let the rest of the body render as live Markdown.
 */
export function fenceFor(content: string): string {
    let longest = 0;
    for (const match of content.matchAll(/`+/g)) {
        longest = Math.max(longest, match[0].length);
    }
    return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The hover card: the snippet body first, then the metadata it used to show on its own.
 * The body is fenced so a prompt full of headings and lists renders as the text it is
 * rather than as formatting.
 */
export function renderTooltipMarkdown(parts: TooltipParts): string {
    const sections: string[] = [];

    if (parts.preview) {
        if (parts.preview.text.length === 0) {
            sections.push('_(empty file)_');
        } else {
            const fence = fenceFor(parts.preview.text);
            const body = parts.preview.truncated
                ? `${parts.preview.text}\n\n${TRUNCATION_NOTICE}`
                : parts.preview.text;
            sections.push(`${fence}md\n${body}\n${fence}`);
        }
    }

    if (parts.note) {
        sections.push(`_${parts.note}_`);
    }

    sections.push(`\`${parts.fsPath}\``);
    sections.push(`${formatBytes(parts.size)} · Click to open, insert icon to paste`);

    return sections.join('\n\n');
}
