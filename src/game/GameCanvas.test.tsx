import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameCanvas } from './GameCanvas';
import { MAX_RESOLUTION, rendererResolution } from './pixiStage';

const pixi = vi.hoisted(() => {
  class FakeContainer {
    readonly children: unknown[] = [];
    readonly label: string | undefined;
    readonly destroy = vi.fn();

    constructor(options?: { label?: string }) {
      this.label = options?.label;
    }

    addChild(child: unknown) {
      this.children.push(child);
    }
  }

  class FakeApplication {
    readonly canvas = document.createElement('canvas');
    readonly stage = new FakeContainer();
    renderer: { resize: ReturnType<typeof vi.fn> } | undefined;
    resolveInit!: () => void;
    rejectInit!: (error: Error) => void;

    readonly init = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          this.resolveInit = () => {
            this.renderer = { resize: vi.fn() };
            resolve();
          };
          this.rejectInit = reject;
        }),
    );

    readonly destroy = vi.fn((rendererOptions?: { removeView?: boolean }) => {
      if (rendererOptions?.removeView) this.canvas.remove();
    });

    constructor() {
      apps.push(this);
    }
  }

  const apps: FakeApplication[] = [];
  return { apps, FakeApplication, FakeContainer };
});

vi.mock('pixi.js', () => ({
  Application: pixi.FakeApplication,
  Container: pixi.FakeContainer,
}));

const assets = vi.hoisted(() => ({
  loaded: { chicken: {}, cars: [] },
  load: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('./assets', () => ({ loadGameAssets: assets.load }));

const audio = vi.hoisted(() => ({
  loaded: { cues: new Set(['step']), play: () => {}, stopAll: () => {}, unlock: () => {} },
  load: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('./audio', () => ({ loadGameAudio: audio.load }));

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function setHostSize(host: HTMLElement, width: number, height: number) {
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: height });
}

async function resolveAllInits() {
  await act(async () => {
    for (const app of pixi.apps) app.resolveInit();
  });
}

beforeEach(() => {
  pixi.apps.length = 0;
  assets.load.mockReset().mockResolvedValue(assets.loaded);
  audio.load.mockReset().mockResolvedValue(audio.loaded);
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GameCanvas', () => {
  it('attaches the canvas and a game root once init resolves', async () => {
    const onReady = vi.fn();
    render(<GameCanvas onReady={onReady} />);
    const host = screen.getByTestId('game-canvas');

    expect(pixi.apps).toHaveLength(1);
    expect(host.querySelector('canvas')).toBeNull();

    await resolveAllInits();
    const [app] = pixi.apps;

    expect(host.querySelector('canvas')).toBe(app?.canvas);
    expect(app?.init).toHaveBeenCalledWith(
      expect.objectContaining({ autoDensity: true, resolution: rendererResolution() }),
    );
    expect(app?.stage.children).toHaveLength(1);
    expect(onReady).toHaveBeenCalledWith({
      app,
      root: app?.stage.children[0],
      assets: assets.loaded,
      audio: audio.loaded,
    });
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]?.targets.has(host)).toBe(true);
  });

  it('starts without sound when no audio could be loaded', async () => {
    audio.load.mockResolvedValue(null);
    const onReady = vi.fn();
    render(<GameCanvas onReady={onReady} />);

    await resolveAllInits();

    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ audio: null }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('re-renders at the new pixel density when the canvas moves to another screen', async () => {
    const queries: (EventTarget & { media: string })[] = [];
    vi.stubGlobal('matchMedia', (media: string) => {
      const query = Object.assign(new EventTarget(), { media, matches: true });
      queries.push(query);
      return query;
    });
    vi.stubGlobal('devicePixelRatio', 1);
    const { unmount } = render(<GameCanvas />);
    const host = screen.getByTestId('game-canvas');
    setHostSize(host, 640, 360);
    await resolveAllInits();
    const resize = pixi.apps[0]?.renderer?.resize;

    vi.stubGlobal('devicePixelRatio', 2);
    queries.at(-1)?.dispatchEvent(new Event('change'));

    expect(resize).toHaveBeenLastCalledWith(640, 360, 2);
    expect(queries.at(-1)?.media).toBe('(resolution: 2dppx)');

    unmount();
    queries.at(-1)?.dispatchEvent(new Event('change'));
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it('cleans up everything exactly once on unmount', async () => {
    const detach = vi.fn();
    const { unmount } = render(<GameCanvas onReady={() => detach} />);
    await resolveAllInits();
    const [app] = pixi.apps;

    unmount();

    expect(detach).toHaveBeenCalledTimes(1);
    expect(app?.destroy).toHaveBeenCalledTimes(1);
    expect(app?.destroy).toHaveBeenCalledWith({ removeView: true }, { children: true });
    expect(app?.canvas.isConnected).toBe(false);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
  });

  it('destroys an application whose init finishes after unmount', async () => {
    const onReady = vi.fn();
    const { unmount } = render(<GameCanvas onReady={onReady} />);
    const host = screen.getByTestId('game-canvas');

    unmount();
    expect(pixi.apps[0]?.destroy).not.toHaveBeenCalled();

    await resolveAllInits();

    expect(pixi.apps[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('does not leak applications under StrictMode', async () => {
    const { unmount } = render(
      <StrictMode>
        <GameCanvas />
      </StrictMode>,
    );
    await resolveAllInits();

    const live = pixi.apps.filter((app) => app.destroy.mock.calls.length === 0);
    expect(live).toHaveLength(1);
    expect(document.querySelectorAll('canvas')).toHaveLength(1);

    unmount();

    for (const app of pixi.apps) expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
  });

  it('leaves nothing behind after ten mount and unmount cycles', async () => {
    for (let i = 0; i < 10; i++) {
      const { unmount } = render(
        <StrictMode>
          <GameCanvas />
        </StrictMode>,
      );
      if (i % 2 === 0) await resolveAllInits();
      unmount();
    }
    await resolveAllInits();

    expect(pixi.apps.length).toBeGreaterThanOrEqual(10);
    for (const app of pixi.apps) expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
  });

  it('resizes the renderer to the container in logical pixels', async () => {
    render(<GameCanvas />);
    const host = screen.getByTestId('game-canvas');
    await resolveAllInits();
    const renderer = pixi.apps[0]?.renderer;

    setHostSize(host, 390, 844);
    FakeResizeObserver.instances[0]?.trigger();

    expect(renderer?.resize).toHaveBeenLastCalledWith(390, 844, rendererResolution());
  });

  it('reports an init failure without leaving a canvas behind', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GameCanvas />);
    const host = screen.getByTestId('game-canvas');
    const [app] = pixi.apps;

    await act(async () => app?.rejectInit(new Error('WebGL unavailable')));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Failed to start the game', expect.any(Error));
    expect(host.querySelector('canvas')).toBeNull();
    expect(app?.stage.destroy).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('reports an asset failure and releases the renderer it already started', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('atlas missing');
    assets.load.mockRejectedValue(failure);
    const onReady = vi.fn();
    render(<GameCanvas onReady={onReady} />);
    const host = screen.getByTestId('game-canvas');

    await resolveAllInits();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Failed to start the game', failure);
    expect(onReady).not.toHaveBeenCalled();
    expect(host.querySelector('canvas')).toBeNull();
    expect(pixi.apps[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });
});

describe('GameCanvas loading and recovery', () => {
  const retryButton = () => screen.getByRole('button', { name: 'Try again' });

  it('shows a loading state until the stage and scene are ready', async () => {
    render(<GameCanvas onReady={() => {}} />);
    const host = screen.getByTestId('game-canvas');

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(host).toHaveAttribute('aria-busy', 'true');
    expect(host).toHaveAttribute('data-status', 'loading');

    await resolveAllInits();

    expect(screen.queryByRole('status')).toBeNull();
    expect(host).toHaveAttribute('aria-busy', 'false');
    expect(host).toHaveAttribute('data-status', 'ready');
  });

  it('keeps loading while only the renderer is up and the atlas is still on its way', async () => {
    let resolveAssets!: (value: unknown) => void;
    assets.load.mockReturnValue(new Promise((resolve) => (resolveAssets = resolve)));
    const onReady = vi.fn();
    render(<GameCanvas onReady={onReady} />);

    await resolveAllInits();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => resolveAssets(assets.loaded));
    expect(screen.queryByRole('status')).toBeNull();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way when audio could not load at all', async () => {
    audio.load.mockResolvedValue(null);
    render(<GameCanvas onReady={() => {}} />);

    await resolveAllInits();

    expect(screen.getByTestId('game-canvas')).toHaveAttribute('data-status', 'ready');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts over cleanly when retried after a failed start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    assets.load.mockRejectedValueOnce(new Error('atlas missing'));
    const onReady = vi.fn(() => detach);
    const detach = vi.fn();
    render(<GameCanvas onReady={onReady} />);
    await resolveAllInits();
    const [failed] = pixi.apps;

    expect(screen.getByRole('alert')).toHaveTextContent(/could not start/);
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(retryButton());

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(pixi.apps).toHaveLength(2);

    await resolveAllInits();
    const retried = pixi.apps[1];

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ app: retried }));
    expect(failed?.destroy).toHaveBeenCalledTimes(1);
    expect(retried?.destroy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(assets.load).toHaveBeenCalledTimes(2);
  });

  it('can fail again on retry and recover on the next one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GameCanvas onReady={() => {}} />);
    await act(async () => pixi.apps[0]?.rejectInit(new Error('WebGL unavailable')));

    fireEvent.click(retryButton());
    await act(async () => pixi.apps[1]?.rejectInit(new Error('WebGL unavailable')));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(retryButton());
    await act(async () => pixi.apps[2]?.resolveInit());

    expect(screen.getByTestId('game-canvas')).toHaveAttribute('data-status', 'ready');
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(pixi.apps.slice(0, 2).every((app) => app.stage.destroy.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it('recovers under StrictMode with a single live stage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    assets.load.mockRejectedValue(new Error('atlas missing'));
    const onReady = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <GameCanvas onReady={onReady} />
      </StrictMode>,
    );
    await resolveAllInits();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    assets.load.mockResolvedValue(assets.loaded);
    fireEvent.click(retryButton());
    await resolveAllInits();

    const live = pixi.apps.filter((app) => app.destroy.mock.calls.length === 0);
    expect(live).toHaveLength(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(FakeResizeObserver.instances.filter((observer) => !observer.disconnected)).toHaveLength(
      1,
    );

    unmount();
    for (const app of pixi.apps) expect(app.destroy).toHaveBeenCalledTimes(1);
  });

  it('fails visibly and releases the stage when the scene cannot mount', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('scene broke');
    render(
      <GameCanvas
        onReady={() => {
          throw failure;
        }}
      />,
    );
    const host = screen.getByTestId('game-canvas');

    await resolveAllInits();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Failed to start the game', failure);
    expect(pixi.apps[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
  });

  it('stays silent when a start fails after unmount', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<GameCanvas />);

    unmount();
    await act(async () => pixi.apps[0]?.rejectInit(new Error('WebGL unavailable')));

    expect(consoleError).not.toHaveBeenCalled();
    expect(pixi.apps[0]?.stage.destroy).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('starts a fresh stage when mounted again after a successful start', async () => {
    const detach = vi.fn();
    const first = render(<GameCanvas onReady={() => detach} />);
    await resolveAllInits();
    first.unmount();

    render(<GameCanvas onReady={() => detach} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await resolveAllInits();

    expect(detach).toHaveBeenCalledTimes(1);
    expect(pixi.apps[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(pixi.apps[1]?.destroy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
  });
});

describe('rendererResolution', () => {
  it('follows the device pixel ratio up to the cap', () => {
    expect(rendererResolution(1)).toBe(1);
    expect(rendererResolution(1.5)).toBe(1.5);
    expect(rendererResolution(2)).toBe(2);
    expect(rendererResolution(3)).toBe(MAX_RESOLUTION);
  });

  it('falls back to 1 for missing or invalid ratios', () => {
    expect(rendererResolution(0)).toBe(1);
    expect(rendererResolution(Number.NaN)).toBe(1);
  });
});
