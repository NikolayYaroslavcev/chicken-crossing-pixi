import { useEffect, useRef, useState } from 'react';
import { createPixiStage, destroyPixiStage, resizePixiStage, type PixiStage } from './pixiStage';

/** Called once the stage is running; the returned function runs before the stage is destroyed. */
export type StageReadyHandler = (stage: PixiStage) => (() => void) | void;

export interface GameCanvasProps {
  onReady?: StageReadyHandler;
}

/** `loading` until the renderer, the atlas and the scene are up; `failed` if any of them is not. */
export type CanvasStatus = 'loading' | 'ready' | 'failed';

export function GameCanvas({ onReady }: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  const [status, setStatus] = useState<CanvasStatus>('loading');
  // Each retry is a new attempt: the effect tears the last one down and starts from scratch.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let stage: PixiStage | null = null;
    let observer: ResizeObserver | null = null;
    let stopWatchingDensity: (() => void) | null = null;
    let detach: (() => void) | void = undefined;

    const release = () => {
      observer?.disconnect();
      observer = null;
      stopWatchingDensity?.();
      stopWatchingDensity = null;
      detach?.();
      detach = undefined;
      if (stage) destroyPixiStage(stage);
      stage = null;
    };

    createPixiStage(measure(host))
      .then((created) => {
        // StrictMode or a fast unmount may have run cleanup while init was pending.
        if (disposed) {
          destroyPixiStage(created);
          return;
        }
        stage = created;
        host.appendChild(created.app.canvas);
        const resize = () => resizePixiStage(created, measure(host));
        observer = new ResizeObserver(resize);
        observer.observe(host);
        // Moving to a screen with another pixel density keeps the CSS size, so no resize fires.
        stopWatchingDensity = watchPixelDensity(resize);
        detach = onReadyRef.current?.(created);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        // A stage that failed after cleanup already ran has nothing left to show or report.
        if (disposed) return;
        // A scene that could not mount leaves a stage behind; it goes before the error shows.
        release();
        console.error('Failed to start the game', error);
        setStatus('failed');
      });

    return () => {
      disposed = true;
      release();
    };
  }, [attempt]);

  const retry = () => {
    setStatus('loading');
    setAttempt((previous) => previous + 1);
  };

  return (
    <div
      ref={hostRef}
      className="game-canvas"
      data-testid="game-canvas"
      data-status={status}
      aria-busy={status === 'loading'}
    >
      {status === 'loading' && (
        <div className="stage-status" role="status">
          <span className="stage-status__spinner" aria-hidden="true" />
          <p className="stage-status__title">Loading the crossing…</p>
        </div>
      )}
      {status === 'failed' && (
        <div className="stage-status stage-status--failed">
          <div role="alert">
            <p className="stage-status__title">The game could not start</p>
            <p className="stage-status__text">
              Something went wrong while loading. Check your connection and try again.
            </p>
          </div>
          <button type="button" className="button button--retry" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function measure(host: HTMLElement) {
  return { width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) };
}

function watchPixelDensity(onChange: () => void): () => void {
  if (typeof globalThis.matchMedia !== 'function') return () => {};
  let query: MediaQueryList | null = null;
  const listen = () => {
    query = globalThis.matchMedia(`(resolution: ${globalThis.devicePixelRatio}dppx)`);
    query.addEventListener('change', changed, { once: true });
  };
  const changed = () => {
    onChange();
    listen();
  };
  listen();
  return () => query?.removeEventListener('change', changed);
}
