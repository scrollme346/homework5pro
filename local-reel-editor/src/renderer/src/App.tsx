import { useEffect } from 'react';
import { useStore } from './state/store';
import { useJobProgressListener } from './state/useJobs';
import { ErrorDialog } from './components/ui';
import { Home } from './screens/Home';
import { Setup } from './screens/Setup';
import { Generating } from './screens/Generating';
import { Editor } from './screens/Editor';

export function App() {
  const screen = useStore((s) => s.screen);
  useJobProgressListener();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {screen === 'home' && <Home />}
      {screen === 'setup' && <Setup />}
      {screen === 'generating' && <Generating />}
      {screen === 'editor' && <Editor />}
      <ErrorDialog />
    </>
  );
}
