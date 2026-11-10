// Instance-bound Lemmy API, encrypted login tokens and a bounded thumbnail proxy.
import type { Settings } from '../shared/types';
import type { z } from 'zod';
import type { lemmyWriteSchema } from '../shared/ipc';
import { validateInstance, normalizePost, normalizeComment, normalizeCommunity, commentTree } from '../shared/lemmy';
import { object } from '../shared/markets';
import { registerFeedLinks } from '../shared/sanitize';
import { fetchJson, setLemmyInstance, assertAllowedUrl } from './feeds/http';
import { redactSecrets, type SecretStore } from './secrets';

/** Owns the one configured instance and its main-process-only bearer token. */
export class LemmyService {
  private instance: string;

  constructor(private secrets: SecretStore, private settings: () => Settings) {
    this.instance = validateInstance(settings().lemmyInstance);
    setLemmyInstance(this.instance);
  }

  changeInstance(next: string) {
    const normalized = validateInstance(next);
    if (normalized === this.instance) return;
    this.secrets.set(this.tokenKey(), null);
    this.secrets.set(`lemmy:${normalized}`, null);
    this.instance = normalized;
    setLemmyInstance(normalized);
  }

  private tokenKey() { return `lemmy:${this.instance}`; }

  private async call(path: string, params: Record<string, unknown> = {}, post = false, auth = true) {
    const instance = this.instance;
    const token = auth ? this.secrets.get(this.tokenKey()) : null;
    const url = new URL(`/api/v3/${path}`, instance);
    if (!post) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== '' && value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    try {
      const response = await fetchJson(url.href, {
        method: post ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: post ? JSON.stringify(params) : undefined,
        maxBytes: 4 * 1024 * 1024,
        sameOrigin: true,
      });
      if (this.instance !== instance) throw new Error('Instance changed; response discarded.');
      const body = object(response.body);
      if (body.error) throw new Error(String(body.error));
      if (!post) this.registerLinks(body);
      return body;
    } catch (error) {
      throw new Error(redactSecrets((error as Error).message, [token, typeof params.password === 'string' ? params.password : null]));
    }
  }

  private registerLinks(body: unknown) {
    const links: string[] = [];
    const collect = (value: unknown, depth = 0): void => {
      if (depth > 20) return;
      if (typeof value === 'string') links.push(...(value.match(/https?:\/\/[^\s<>"\\]+/g) ?? []).slice(0, 100));
      else if (Array.isArray(value)) value.forEach(item => collect(item, depth + 1));
      else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => { if (key !== 'jwt') collect(item, depth + 1); });
      }
    };
    collect(body);
    registerFeedLinks(links);
  }

  async status() {
    const body = await this.call('site');
    const user = body.my_user ? object(body.my_user) : null;
    const local = user?.local_user_view ? object(user.local_user_view) : null;
    const person = local?.person ? object(local.person) : null;
    return { signedIn: !!person, name: person ? String(person.display_name || person.name) : null };
  }

  async login(input: { username_or_email: string; password: string; totp_2fa_token?: string }) {
    const instance = this.instance;
    const body = await this.call('user/login', input, true, false);
    if (typeof body.jwt !== 'string') throw new Error('Instance did not issue a login token.');
    if (instance !== this.instance) throw new Error('Instance changed during login.');
    this.secrets.set(this.tokenKey(), body.jwt);
    return true;
  }

  async logout() {
    const key = this.tokenKey();
    try {
      if (this.secrets.has(key)) await this.call('user/logout', {}, true);
    } finally {
      this.secrets.set(key, null);
    }
    return true;
  }

  async feed(params: Record<string, unknown>) {
    const body = await this.call('post/list', { ...params, limit: 20 });
    if (!Array.isArray(body.posts)) throw new Error('Invalid Lemmy posts response');
    const posts = body.posts.map(normalizePost).filter(post => post && (this.settings().lemmyShowNsfw || (!post.nsfw && !post.community.nsfw)));
    // Pagination is based on the server page, not the number surviving local filters.
    return { posts, hasMore: body.posts.length === 20 };
  }

  async post(id: number) {
    const body = await this.call('post', { id });
    const post = normalizePost(body.post_view);
    if (!post || (!this.settings().lemmyShowNsfw && (post.nsfw || post.community.nsfw))) return { post: null, comments: [] };
    const response = await this.call('comment/list', { post_id: id, sort: 'Hot', max_depth: 6, type_: 'All', limit: 100 });
    if (!Array.isArray(response.comments)) throw new Error('Invalid Lemmy comments response');
    return { post, comments: commentTree(response.comments.map(normalizeComment).filter(comment => comment !== null)) };
  }

  async communities(query: string) {
    const body = await this.call(query ? 'search' : 'community/list', query
      ? { q: query, type_: 'Communities', limit: 20 }
      : { type_: 'All', sort: 'TopMonth', limit: 20 });
    if (!Array.isArray(body.communities)) throw new Error('Invalid Lemmy communities response');
    return body.communities.map(value => normalizeCommunity(object(value).community)).filter(community => this.settings().lemmyShowNsfw || !community.nsfw);
  }

  async write(input: z.infer<typeof lemmyWriteSchema>) {
    if (!this.secrets.has(this.tokenKey())) throw new Error('Sign in to participate.');
    const { action, ...params } = input;
    const data: Record<string, unknown> = { ...params };
    if ('id' in data) {
      data[action.startsWith('post/') ? 'post_id' : 'comment_id'] = data.id;
      delete data.id;
    }
    // Lemmy rejects empty optional fields (an empty url fails URL parsing), so omit them.
    if (action === 'post') {
      if (!data.url) delete data.url;
      if (!data.body) delete data.body;
    }
    await this.call(action, data, true);
    return true;
  }

  async image(raw: string) {
    const instance = this.instance;
    const url = assertAllowedUrl(raw);
    if (url.origin !== instance) throw new Error('Only images hosted by the configured instance are permitted.');
    // No redirects: a thumbnail must not cause a request to a second host.
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!mime || !/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error('Unsupported image type');
    if (Number(response.headers.get('content-length')) > 1048576) throw new Error('Image exceeds 1 MB');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing image');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1048576) throw new Error('Image exceeds 1 MB');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    if (this.instance !== instance) throw new Error('Instance changed');
    return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
  }
}
