import { useEffect } from 'react';
import { canCashOut, canGo, canPlay, type GameStore } from '@/store';

/** Typing, choosing an option or pressing a focused control keeps its own keyboard meaning. */
function handlesKeysItself(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
  const control = target.closest('button, a[href]');
  return control !== null && !(control as HTMLButtonElement).disabled;
}

/**
 * Space starts a round or takes the next step; Enter cashes out, or starts a round between
 * rounds. Whatever the store would ignore right now is ignored here too.
 */
export function useKeyboardControls(store: GameStore): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (handlesKeysItself(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;

      const state = store.getState();
      if (canPlay(state)) void state.play();
      else if (event.key === ' ' && canGo(state)) void state.go();
      else if (event.key === 'Enter' && canCashOut(state)) void state.cashOut();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);
}
