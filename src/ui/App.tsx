import { useCallback } from 'react';
import { GameCanvas } from '@/game/GameCanvas';
import { mountGameScene } from '@/game/mountGameScene';
import type { PixiStage } from '@/game/pixiStage';
import { gameStore, soundSettings, type GameStore, type SoundSettingsStore } from '@/store';
import { GameControls } from './components/GameControls';
import { GameHeader } from './components/GameHeader';
import { GameNotice } from './components/GameNotice';
import { GameResult } from './components/GameResult';
import { useKeyboardControls } from './useKeyboardControls';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

export interface AppProps {
  store?: GameStore;
  sound?: SoundSettingsStore;
}

export function App({ store = gameStore, sound = soundSettings }: AppProps) {
  useKeyboardControls(store);
  const mountScene = useCallback(
    (stage: PixiStage) => mountGameScene(stage, store, sound),
    [store, sound],
  );

  return (
    <div className="shell">
      <GameHeader store={store} sound={sound} />
      <main className="stage" aria-label="Game">
        <GameCanvas onReady={mountScene} />
        <div className="stage__overlay">
          <GameResult store={store} />
          <GameNotice store={store} />
        </div>
      </main>
      <GameControls store={store} />
    </div>
  );
}
