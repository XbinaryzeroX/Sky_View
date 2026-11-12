import { parser as saxParser } from 'sax';

export const MAX_RSS = 1024 * 1024;
const fields = new Set(['title', 'link', 'guid', 'description', 'pubDate', 'category', 'author']);
export type RssItem = Record<string, string[]>;

export function readItems(xml: string, channel: RegExp): RssItem[] {
  if (Buffer.byteLength(xml) > MAX_RSS) throw new Error('The publisher feed exceeds its size limit.');
  const parser = saxParser(true, { xmlns: false, strictEntities: true, position: false });
  const path: string[] = [];
  const items: RssItem[] = [];
  let nodes = 0, channels = 0, channelTitle = '';
  let item: RssItem | null = null;
  let field: string | null = null;
  let value = '';
  parser.ondoctype = () => { throw new Error('Unexpected document type in publisher RSS.'); };
  parser.onerror = error => { throw error; };
  parser.onopentag = tag => {
    path.push(tag.name);
    if (++nodes > 4000 || path.length > 16) throw new Error('The publisher feed exceeds its XML limits.');
    if (path.length === 1 && tag.name !== 'rss') throw new Error('The publisher did not return RSS.');
    if (path.length === 2 && tag.name === 'channel') channels++;
    if (path[1] !== 'channel') return;
    if (path.length === 3 && tag.name === 'item') {
      if (items.length >= 100) throw new Error('Unexpected number of RSS items.');
      item = {};
    } else if ((path.length === 3 && tag.name === 'title') || (path.length === 4 && item && fields.has(tag.name))) {
      field = tag.name;
      value = '';
    }
  };
  const append = (text: string) => { if (field) value += text; };
  parser.ontext = append;
  parser.oncdata = append;
  parser.onclosetag = name => {
    if (name === field && path.length === (item ? 4 : 3)) {
      if (item) (item[field] ??= []).push(value.trim());
      else channelTitle = value.trim();
      field = null;
    }
    if (item && name === 'item' && path.length === 3) { items.push(item); item = null; }
    path.pop();
  };
  for (let offset = 0; offset < xml.length; offset += 8192) parser.write(xml.slice(offset, offset + 8192));
  parser.close();
  if (channels !== 1 || !channel.test(channelTitle)) throw new Error('The publisher did not return the expected RSS channel.');
  return items;
}
