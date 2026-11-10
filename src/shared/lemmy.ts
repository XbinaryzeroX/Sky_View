// Lemmy feed records remain untrusted plain data throughout the app.
import { object, finite } from './markets';

export function validateInstance(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || /:\d+(?:\/|$)/.test(raw)
    || url.pathname !== '/' || url.search || url.hash || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || !url.hostname.includes('.') || raw.replace(/\/$/, '') !== url.origin) {
    throw new Error('Use an HTTPS hostname only, without path, port, query or user information (not localhost).');
  }
  return url.origin;
}

export interface LemmyCommunity {
  id: number;
  name: string;
  title: string;
  actorId: string;
  nsfw: boolean;
}

export interface LemmyPost {
  id: number;
  title: string;
  body: string;
  url: string | null;
  published: string;
  author: string;
  personId: number;
  community: LemmyCommunity;
  score: number;
  comments: number;
  myVote: number;
  nsfw: boolean;
  locked: boolean;
  thumbnail: string | null;
}

export interface LemmyComment {
  id: number;
  content: string;
  path: string;
  published: string;
  author: string;
  personId: number;
  score: number;
  myVote: number;
  children: LemmyComment[];
}

const str = (value: unknown) => typeof value === 'string' ? value : '';

export function normalizeCommunity(raw: unknown): LemmyCommunity {
  const community = object(raw);
  const actor = new URL(str(community.actor_id));
  if (actor.protocol !== 'https:' || actor.username || actor.password) throw new Error('Invalid community actor URL');
  return {
    id: finite(community.id), name: str(community.name), title: str(community.title), actorId: str(community.actor_id), nsfw: community.nsfw === true,
  };
}

export function normalizePost(raw: unknown): LemmyPost | null {
  const view = object(raw);
  const post = object(view.post);
  const author = object(view.creator);
  const counts = object(view.counts);
  if (post.removed || post.deleted) return null;
  return {
    id: finite(post.id), title: str(post.name), body: str(post.body), url: typeof post.url === 'string' ? post.url : null,
    published: str(post.published), author: str(author.display_name) || str(author.name), personId: finite(author.id),
    community: normalizeCommunity(view.community), score: finite(counts.score), comments: finite(counts.comments),
    myVote: Number(view.my_vote) || 0, nsfw: post.nsfw === true, locked: post.locked === true,
    thumbnail: typeof post.thumbnail_url === 'string' ? post.thumbnail_url : null,
  };
}

export function normalizeComment(raw: unknown): LemmyComment | null {
  const view = object(raw);
  const comment = object(view.comment);
  const author = object(view.creator);
  const counts = object(view.counts);
  if (comment.removed || comment.deleted) return null;
  return {
    id: finite(comment.id), content: str(comment.content), path: str(comment.path), published: str(comment.published),
    author: str(author.display_name) || str(author.name), personId: finite(author.id), score: finite(counts.score),
    myVote: Number(view.my_vote) || 0, children: [],
  };
}

export function commentTree(rows: LemmyComment[]): LemmyComment[] {
  const nodes = new Map(rows.map(comment => [comment.id, { ...comment, children: [] as LemmyComment[] }]));
  const roots: LemmyComment[] = [];
  for (const node of nodes.values()) {
    const path = node.path.split('.').map(Number);
    const parent = nodes.get(path.at(-2) ?? 0);
    if (parent && parent !== node && parent.path.split('.').length < path.length) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
