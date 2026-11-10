// Anonymous Lemmy reading and explicit account actions; feed content stays plain text.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, MessageSquare, ExternalLink as LinkIcon } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { validateInstance, type LemmyPost, type LemmyComment, type LemmyCommunity } from '../../shared/lemmy';
import type { PageCtx } from './Pages';
import { ExternalLink, Modal } from './common';
import { relativeTime } from '../lib/format';

type Write = Parameters<typeof api.lemmyWrite>[0];
type Target = 'post' | 'comment';
interface AccountAction {
  kind: 'reply' | 'report';
  postId?: number;
  parentId?: number;
  target: Target;
  id: number;
}

function TextBody({ text }: { text: string }) {
  return <div className="pre community-text">{text}</div>;
}

function TextLinks({ text }: { text: string }) {
  const links = [...new Set(text.match(/https?:\/\/[^\s<>]+/g) ?? [])].slice(0, 20);
  return <>{links.map(url => <div key={url}><ExternalLink url={url}>Open {url.slice(0, 100)}</ExternalLink></div>)}</>;
}

function Thumbnail({ post, instance }: { post: LemmyPost; instance: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    setSrc('');
    try {
      if (post.thumbnail && new URL(post.thumbnail).origin === instance) {
        void api.lemmyImage(post.thumbnail).then(src => { if (alive) setSrc(src); }).catch(() => {});
      }
    } catch {
      // Untrusted malformed URL: no image.
    }
    return () => { alive = false; };
  }, [post.thumbnail, instance]);
  return src ? <img className="community-thumb" src={src} alt="" /> : null;
}

export function CommunityPage({ ctx }: { ctx: PageCtx }) {
  const settings = ctx.snap.settings;
  const [instance, setInstance] = useState(settings.lemmyInstance);
  const [defaultCommunity, setDefaultCommunity] = useState(settings.lemmyDefaultCommunity);
  const [status, setStatus] = useState<{ signedIn: boolean; name: string | null }>({ signedIn: false, name: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [posts, setPosts] = useState<LemmyPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [type, setType] = useState<'All' | 'Local' | 'Subscribed'>('All');
  const [sort, setSort] = useState<'Active' | 'Hot' | 'New' | 'TopDay' | 'TopWeek'>('Active');
  const [filter, setFilter] = useState(settings.lemmyDefaultCommunity);
  const [search, setSearch] = useState('');
  const [communities, setCommunities] = useState<LemmyCommunity[]>([]);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [detail, setDetail] = useState<{ post: LemmyPost | null; comments: LemmyComment[] } | null>(null);
  const [login, setLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [compose, setCompose] = useState(false);
  const [communityId, setCommunityId] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [nsfw, setNsfw] = useState(false);
  const [action, setAction] = useState<AccountAction | null>(null);
  const [actionText, setActionText] = useState('');
  const epoch = useRef(0);
  // Bumped on every detail navigation (open a post, back to feed, feed reset); late detail responses for an older one are dropped.
  const detailGeneration = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
    };
  }, []);

  /** Snapshot of the current feed generation; content updates from an older generation are discarded. */
  const isCurrent = () => {
    const at = epoch.current;
    return () => live.current && at === epoch.current;
  };

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    const at = epoch.current;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (error) {
      if (live.current && at === epoch.current) setError(errorText(error));
    } finally {
      if (live.current && at === epoch.current) setBusy(false);
    }
  };

  /**
   * Reloads page 1 of the feed. `current` must be captured before any earlier await, so an obsolete
   * closure (old sort/filter) can never adopt a newer generation and overwrite the visible feed.
   */
  const refresh = async (current: () => boolean) => {
    if (!current()) return;
    const list = await api.lemmyFeed({ type_: type, sort, page: 1, community_name: filter });
    if (current()) {
      setReloadFailed(false);
      setPosts(list.posts);
      setPage(1);
      setHasMore(list.hasMore);
    }
  };

  const write = async (data: Write) => {
    // Capture both generations and the open post before awaiting: navigation while the write is pending
    // (Back to feed, another post, new filter) must win over the reload that follows it.
    const current = isCurrent();
    const open = detail?.post ?? null;
    const generation = detailGeneration.current;
    await api.lemmyWrite(data);
    // The write has succeeded. Reload separately: a failed reload must not look like a failed write,
    // or the caller would keep the draft open and a second click would publish a duplicate.
    void reloadAfterWrite(current, open, generation);
  };

  const reloadAfterWrite = async (current: () => boolean, open: LemmyPost | null, generation: number) => {
    const sameDetail = () => current() && generation === detailGeneration.current;
    try {
      await refresh(current);
      if (open && sameDetail()) {
        const result = await api.lemmyPost(open.id);
        if (sameDetail()) setDetail(result);
      }
    } catch (error) {
      if (current()) {
        setError('Saved. Reloading the feed failed: ' + errorText(error));
        setReloadFailed(true);
      }
    }
  };

  const openPost = async (id: number) => {
    const current = isCurrent();
    const generation = ++detailGeneration.current;
    const result = await api.lemmyPost(id);
    if (current() && generation === detailGeneration.current) setDetail(result);
  };

  const closePost = () => {
    detailGeneration.current++;
    setDetail(null);
  };

  useEffect(() => {
    epoch.current++;
    const at = epoch.current;
    setPosts([]);
    detailGeneration.current++;
    setDetail(null);
    setStatus({ signedIn: false, name: null });
    setBusy(true);
    setError('');
    void Promise.all([
      api.lemmyFeed({ type_: type, sort, page: 1, community_name: filter }), api.lemmyStatus(),
    ]).then(([list, user]) => {
      if (live.current && at === epoch.current) {
        setPosts(list.posts);
        setPage(1);
        setHasMore(list.hasMore);
        setStatus(user);
      }
    }).catch(error => {
      if (live.current && at === epoch.current) setError(errorText(error));
    }).finally(() => { if (live.current && at === epoch.current) setBusy(false); });
    return () => { epoch.current++; };
  }, [settings.lemmyInstance, settings.lemmyShowNsfw, type, sort, filter]);

  useEffect(() => {
    setInstance(settings.lemmyInstance);
    setDefaultCommunity(settings.lemmyDefaultCommunity);
    setFilter(settings.lemmyDefaultCommunity);
    setCommunities([]);
    // Community ids are instance-local: never carry a selection or draft across instances.
    setCommunityId(0);
    setTitle('');
    setBody('');
    setUrl('');
    setNsfw(false);
    setLogin(false);
    setPassword('');
    setCompose(false);
    setAction(null);
  }, [settings.lemmyInstance, settings.lemmyDefaultCommunity]);

  const beginAction = (value: AccountAction) => {
    setActionText('');
    setAction(value);
  };

  const vote = (target: Target, id: number, myVote: number) => (
    <span className="vote-controls">
      <button className="icon-btn" aria-label={'Upvote ' + target} aria-pressed={myVote === 1} disabled={!status.signedIn || busy}
        onClick={() => void run(() => write({ action: target + '/like', id, score: myVote === 1 ? 0 : 1 }))}>
        <ArrowUp size={16} aria-hidden="true" />
      </button>
      <button className="icon-btn" aria-label={'Downvote ' + target} aria-pressed={myVote === -1} disabled={!status.signedIn || busy}
        onClick={() => void run(() => write({ action: target + '/like', id, score: myVote === -1 ? 0 : -1 }))}>
        <ArrowDown size={16} aria-hidden="true" />
      </button>
    </span>
  );

  const actions = (target: Target, id: number, personId: number) => status.signedIn && (
    <>
      <button className="btn small-btn" disabled={busy} onClick={() => beginAction({ kind: 'report', target, id })}>Report</button>
      <button className="btn small-btn" disabled={busy}
        onClick={() => void run(() => write({ action: 'user/block', person_id: personId, block: true }))}>Block author</button>
    </>
  );

  const comments = (rows: LemmyComment[]): React.ReactNode => rows.map(comment => (
    <article className="community-comment" key={comment.id}>
      <div className="muted small">{comment.author} · {relativeTime(comment.published)}</div>
      <TextBody text={comment.content} />
      <TextLinks text={comment.content} />
      <div className="field-row">
        {vote('comment', comment.id, comment.myVote)}<span>{comment.score}</span>
        <button className="btn small-btn" disabled={!status.signedIn || busy || detail?.post?.locked} onClick={() => beginAction({
          kind: 'reply', target: 'comment', id: comment.id, parentId: comment.id, postId: detail?.post?.id,
        })}>Reply</button>
        {actions('comment', comment.id, comment.personId)}
      </div>
      {comments(comment.children)}
    </article>
  ));

  const loadCommunities = async (query: string) => {
    const current = isCurrent();
    const rows = await api.lemmyCommunities(query);
    if (current()) setCommunities(rows);
  };
  const findCommunities = () => run(() => loadCommunities(search));
  const loadMore = () => run(async () => {
    const current = isCurrent();
    const rows = await api.lemmyFeed({ type_: type, sort, page: page + 1, community_name: filter });
    if (!current()) return;
    setPosts(old => [...new Map([...old, ...rows.posts].map(post => [post.id, post])).values()]);
    setPage(page + 1);
    setHasMore(rows.hasMore);
  });
  const closeLogin = () => {
    setPassword('');
    setTotp('');
    setLogin(false);
  };
  const signIn = () => {
    const input = { username_or_email: username, password, ...(totp ? { totp_2fa_token: totp } : {}) };
    setPassword('');
    void run(async () => {
      const current = isCurrent();
      await api.lemmyLogin(input);
      setLogin(false);
      setStatus(await api.lemmyStatus());
      await refresh(current);
    });
  };
  const insertPosition = () => {
    const position = ctx.viewCenter();
    if (position) setBody(body => (body + '\nLocation: ' + position.lat.toFixed(5) + ', ' + position.lon.toFixed(5)).slice(0, 10000));
    else setError('Map position is unavailable.');
  };
  const post = detail?.post;

  return (
    <>
      <div className="page-head">
        <h2>Community</h2>
        <span>{status.signedIn ? `Signed in as ${status.name}` : 'Read without an account'}</span>
        {status.signedIn ? (
          <button className="btn" disabled={busy} onClick={() => void run(async () => {
            const current = isCurrent();
            await api.lemmyLogout();
            setStatus({ signedIn: false, name: null });
            await refresh(current);
          })}>Sign out</button>
        ) : <button className="btn" onClick={() => setLogin(true)}>Sign in</button>}
      </div>
      <details>
        <summary>Instance and content settings</summary>
        <form onSubmit={event => {
          event.preventDefault();
          try {
            validateInstance(instance);
            ctx.patch({ lemmyInstance: instance, lemmyDefaultCommunity: defaultCommunity });
          } catch (error) {
            setError(errorText(error));
          }
        }}>
          <label className="field">HTTPS instance
            <input value={instance} onChange={event => setInstance(event.target.value)} maxLength={253} />
          </label>
          <label className="field">Default community
            <input value={defaultCommunity} maxLength={150} onChange={event => setDefaultCommunity(event.target.value)} />
          </label>
          <button className="btn">Save instance settings (signs out if changed)</button>
        </form>
        <label><input type="checkbox" checked={settings.lemmyShowNsfw}
          onChange={event => ctx.patch({ lemmyShowNsfw: event.target.checked })} /> Show NSFW posts</label>
      </details>
      <div className="field-row community-filters">
        <select aria-label="Listing" value={type} onChange={event => setType(event.target.value as typeof type)}>
          {['All', 'Local', 'Subscribed'].map(item => <option key={item}>{item}</option>)}
        </select>
        <select aria-label="Sort posts" value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
          {['Active', 'Hot', 'New', 'TopDay', 'TopWeek'].map(item => <option key={item}>{item}</option>)}
        </select>
        <select aria-label="Community filter" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">All communities</option>
          {settings.lemmyDefaultCommunity && <option value={settings.lemmyDefaultCommunity}>{settings.lemmyDefaultCommunity}</option>}
          {communities.map(community => (
            <option key={community.id} value={community.name + '@' + new URL(community.actorId).hostname}>{community.title}</option>
          ))}
        </select>
        <button className="btn" disabled={!status.signedIn} onClick={() => {
          setCompose(true);
          void run(() => loadCommunities(''));
        }}>New post</button>
        {!status.signedIn && <small>Sign in to post, reply or vote.</small>}
      </div>
      <form className="field-row" onSubmit={event => { event.preventDefault(); void findCommunities(); }}>
        <input aria-label="Search communities" placeholder="Search communities" value={search} maxLength={150}
          onChange={event => setSearch(event.target.value)} />
        <button className="btn" disabled={busy}>Find communities</button>
      </form>
      {communities.length > 0 && (
        <div className="community-results">
          {communities.map(community => (
            <button className="btn" key={community.id} onClick={() => {
              setFilter(community.name + '@' + new URL(community.actorId).hostname);
              setCommunityId(community.id);
            }}>{community.title}</button>
          ))}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {reloadFailed && (
        <button className="btn" disabled={busy} onClick={() => void run(() => refresh(isCurrent()))}>Reload feed</button>
      )}
      {busy && <p role="status">Loading…</p>}
      {!busy && !posts.length && !error && <p className="muted">No visible posts returned by this instance.</p>}
      {detail ? (
        <section>
          <button className="btn" onClick={closePost}>Back to feed</button>
          {post ? (
            <>
              <h3>{post.title}</h3>
              <p className="muted">{post.community.title} · {post.author} · {relativeTime(post.published)}</p>
              <TextBody text={post.body} />
              <TextLinks text={post.body} />
              {post.url && <ExternalLink url={post.url}>Open post link</ExternalLink>}
              <div className="field-row">
                {vote('post', post.id, post.myVote)}{post.score}
                <button className="btn" disabled={!status.signedIn || busy || post.locked}
                  onClick={() => beginAction({ kind: 'reply', target: 'post', id: post.id, postId: post.id })}>Comment</button>
                {actions('post', post.id, post.personId)}
                {status.signedIn && (
                  <>
                    <button className="btn" onClick={() => void run(() => write({
                      action: 'community/block', community_id: post.community.id, block: true,
                    }))}>Block community</button>
                    <button className="btn" onClick={() => void run(() => write({
                      action: 'community/follow', community_id: post.community.id, follow: true,
                    }))}>Follow community</button>
                    <button className="btn" onClick={() => void run(() => write({
                      action: 'community/follow', community_id: post.community.id, follow: false,
                    }))}>Unfollow</button>
                  </>
                )}
              </div>
              <h3>Comments</h3>
              {comments(detail.comments)}
              {!detail.comments.length && <p>No visible comments.</p>}
            </>
          ) : <p>This post is unavailable or hidden.</p>}
        </section>
      ) : (
        <>
          <div className="community-posts">
            {posts.map(post => (
              <article className="community-card" key={post.id}>
                <Thumbnail post={post} instance={settings.lemmyInstance} />
                <div className="field-row">
                  {vote('post', post.id, post.myVote)}<b>{post.score}</b>
                  <button className="link-btn post-title" onClick={() => void run(() => openPost(post.id))}>
                    {post.title}
                  </button>
                </div>
                <div className="muted small">{post.community.title} · {post.author} · {relativeTime(post.published)}</div>
                <button className="btn small-btn" onClick={() => void run(() => openPost(post.id))}>
                  <MessageSquare size={16} aria-hidden="true" />{post.comments} comments
                </button>
                {post.url && <ExternalLink url={post.url}><LinkIcon size={16} aria-hidden="true" /> Open link</ExternalLink>}
              </article>
            ))}
          </div>
          {hasMore && <button className="btn" disabled={busy} onClick={() => void loadMore()}>Load more</button>}
        </>
      )}
      <p className="muted small">
        Community powered by Lemmy · {settings.lemmyInstance} · content belongs to its authors; moderation by the instance.
      </p>
      {login && (
        <Modal title="Sign in to Lemmy" onClose={closeLogin}>
          <section className="community-dialog">
            <h3>Sign in to {settings.lemmyInstance}</h3>
            <form onSubmit={event => { event.preventDefault(); signIn(); }}>
              <label className="field">Username or email
                <input autoFocus autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} />
              </label>
              <label className="field">Password
                <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
              </label>
              <label className="field">2FA code (optional)
                <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={totp} onChange={event => setTotp(event.target.value)} />
              </label>
              <button className="btn" disabled={busy}>Sign in</button>
              <button type="button" className="btn" onClick={closeLogin}>Cancel</button>
            </form>
            <p className="muted small">Your password is sent once to this instance and is never stored.</p>
            {error && <p role="alert">{error}</p>}
          </section>
        </Modal>
      )}
      {compose && (
        <Modal title="Create post" onClose={() => setCompose(false)}>
          <section className="community-dialog">
            <form className="field-row" onSubmit={event => { event.preventDefault(); void findCommunities(); }}>
              <input aria-label="Find a community for this post" placeholder="Search communities" maxLength={150} value={search}
                onChange={event => setSearch(event.target.value)} />
              <button className="btn" disabled={busy}>Search</button>
            </form>
            <form onSubmit={event => {
              event.preventDefault();
              void run(async () => {
                if (!communities.some(community => community.id === communityId)) throw new Error('Choose a community from this instance.');
                await write({ action: 'post', community_id: communityId, name: title, body, url, nsfw });
                setCompose(false);
                setTitle('');
                setBody('');
                setUrl('');
              });
            }}>
              <label className="field">Community
                <select required value={communityId} onChange={event => setCommunityId(Number(event.target.value))}>
                  <option value={0}>Choose a community (search above)</option>
                  {communities.map(community => <option key={community.id} value={community.id}>{community.title}</option>)}
                </select>
              </label>
              <label className="field">Title<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
              <label className="field">Body<textarea maxLength={10000} value={body} onChange={event => setBody(event.target.value)} /></label>
              <label className="field">URL (optional)<input type="url" value={url} maxLength={2048} onChange={event => setUrl(event.target.value)} /></label>
              <label><input type="checkbox" checked={nsfw} onChange={event => setNsfw(event.target.checked)} />NSFW</label>
              <button type="button" className="btn" onClick={insertPosition}>Insert current map position</button>
              <div className="field-row">
                <button className="btn" disabled={busy || !communities.some(community => community.id === communityId) || !status.signedIn}>Publish post</button>
                <button type="button" className="btn" onClick={() => setCompose(false)}>Cancel</button>
              </div>
            </form>
            {error && <p role="alert">{error}</p>}
          </section>
        </Modal>
      )}
      {action && (
        <Modal title={action.kind === 'reply' ? 'Reply' : 'Report'} onClose={() => setAction(null)}>
          <section className="community-dialog">
            <h3>{action.kind === 'reply' ? 'Reply' : 'Report reason'}</h3>
            <form onSubmit={event => {
              event.preventDefault();
              void run(async () => {
                await write(action.kind === 'reply' ? {
                  action: 'comment', post_id: action.postId!, ...(action.parentId ? { parent_id: action.parentId } : {}), content: actionText,
                } : { action: action.target + '/report', id: action.id, reason: actionText });
                setAction(null);
              });
            }}>
              <textarea autoFocus aria-label={action.kind === 'reply' ? 'Reply text' : 'Report reason'} required
                maxLength={action.kind === 'reply' ? 10000 : 1000} value={actionText} onChange={event => setActionText(event.target.value)} />
              <div className="field-row">
                <button className="btn" disabled={busy || !status.signedIn}>Send {action.kind}</button>
                <button type="button" className="btn" onClick={() => setAction(null)}>Cancel</button>
              </div>
            </form>
            {error && <p role="alert">{error}</p>}
          </section>
        </Modal>
      )}
    </>
  );
}
