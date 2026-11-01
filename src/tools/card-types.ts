export type Style = (text: string) => string;

export interface LinePart {
    text: string;
    style: Style;
}