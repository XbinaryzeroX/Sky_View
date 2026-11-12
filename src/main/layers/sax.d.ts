// Narrow declarations for the sax-js API used by the bounded, non-resolving CAP reader.
declare module 'sax' {
  interface Tag { local: string; uri: string; name: string }
  interface Parser {
    onopentag?: (tag: Tag) => void;
    onclosetag?: (name: string) => void;
    ontext?: (text: string) => void;
    oncdata?: (text: string) => void;
    ondoctype?: (text: string) => void;
    onerror?: (error: Error) => void;
    write(text: string): Parser;
    close(): Parser;
  }
  export function parser(strict: boolean, options: { xmlns: boolean; strictEntities: boolean; position: boolean }): Parser;
}
