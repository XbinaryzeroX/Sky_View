import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GeoRecord } from '../../shared/layers';
import { CAMERA_BOARD_LIMITS, cameraBoardPage } from '../../shared/cameraBoards';
import { CameraPlayer, cameraMedia } from './CameraPlayer';
import { Modal } from './common';
import './cameraBoard.css';
import { useBoardCameraFocus, useCameraPageVisible } from '../lib/cameraFocus';

function CameraBoardCard({ camera, active, video, onVideo, onMap }: { camera: GeoRecord; active: boolean; video: boolean; onVideo(): void; onMap(): void }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const media = cameraMedia(camera);
  const playing = active && inView && !paused;
  const capped = !!media.streamUrl && !video;
  // The existing player has the same network boundary/retry behavior here as in the directory.
  const selectedMedia = capped ? { ...media, streamUrl: null } : media;
  return (
    <article className="camera-board-card" ref={ref} data-camera-id={camera.id} data-video-allocated={video}>
      <h3>{camera.label}</h3>
      <div className="small muted">{[camera.props.locality, camera.props.country].filter(Boolean).join(' · ')}</div>
      {playing ? (
        capped && !media.stillUrl && !media.viewerName ? <div className="cam-empty">Video paused by the board's two-stream limit.</div> :
          <CameraPlayer key={`${camera.id}:${video}`} media={selectedMedia} title={camera.label} boardContext />
      ) : <div className="cam-empty">{!active ? 'Board paused; media connections are closed.' : paused ? 'Camera paused; media connection is closed.' : 'Camera outside the visible board; media connection is closed.'}</div>}
      <div className="btn-row">
        <button className="btn small-btn" onClick={() => setPaused((p) => !p)}>{paused ? 'Resume camera' : 'Pause camera'}</button>
        {capped && <button className="btn small-btn" onClick={onVideo}>Use video here</button>}
        <button className="btn small-btn" onClick={onMap}>Show on map</button>
      </div>
      {playing && capped && media.stillUrl && <p className="small muted">Showing the publisher's still image to keep at most two video streams active.</p>}
    </article>
  );
}

export function CameraBoard({ title, ids, labels = {}, records, onClose, onMap }: { title: string; ids: string[]; labels?: Record<string, string>; records: GeoRecord[]; onClose(): void; onMap(camera: GeoRecord): void }) {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [preferredVideo, setPreferredVideo] = useState<string[]>([]);
  const visible = useCameraPageVisible();
  const ownsFocus = useBoardCameraFocus();
  const plan = cameraBoardPage(ids, records, page, preferredVideo);
  const byId = new Map(records.map((r) => [r.id, r]));
  return createPortal(
    <Modal title={`Camera board: ${title}`} wide onClose={onClose}>
      <div className="camera-board" data-camera-board="true">
        <p className="small muted">Up to {CAMERA_BOARD_LIMITS.visible} cameras and {CAMERA_BOARD_LIMITS.video} video streams at once. Offscreen, hidden and paused cameras disconnect. Cameras may be delayed or offline.</p>
        <div className="btn-row">
          <button className="btn" onClick={() => setPaused((p) => !p)}>{paused ? 'Resume board' : 'Pause board'}</button>
          <button className="btn" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous cameras</button>
          <span className="small" aria-live="polite">Page {Math.min(page + 1, plan.pages)} of {plan.pages}</span>
          <button className="btn" disabled={page + 1 >= plan.pages} onClick={() => setPage((p) => p + 1)}>Next cameras</button>
        </div>
        {!visible && <p role="status">Window hidden: all camera media disconnected.</p>}
        {ids.length > CAMERA_BOARD_LIMITS.cameras && <p className="small muted">The first {CAMERA_BOARD_LIMITS.cameras} cameras are available in this board.</p>}
        <div className="camera-board-grid">
          {plan.ids.map((id) => {
            const camera = byId.get(id);
            return camera ? <CameraBoardCard key={id} camera={camera} active={!paused && visible && ownsFocus} video={plan.videoIds.includes(id)} onVideo={() => setPreferredVideo((p) => [id, ...p.filter((v) => v !== id)].slice(0, CAMERA_BOARD_LIMITS.video))} onMap={() => { onClose(); onMap(camera); }} /> :
              <article className="camera-board-card" key={id}><h3>{labels[id] ?? id}</h3><div className="cam-empty">Not in the loaded camera catalogs. Enable Cameras and check its source status; no substitute feed is shown.</div></article>;
          })}
        </div>
        {plan.ids.length === 0 && <p>No cameras in this board. Pin cameras or favorites from the Cameras page.</p>}
      </div>
    </Modal>, document.body,
  );
}
