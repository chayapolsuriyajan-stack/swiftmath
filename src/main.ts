import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { boot, profile } from './state';
import { flushQueue } from './store/scores';
import { nav } from './ui';
import { homeScreen } from './screens/home';
import { levelsScreen } from './screens/levels';
import { playScreen } from './screens/play';
import { calibrateScreen } from './screens/calibrate';
import { boardScreen } from './screens/leaderboard';
import { profilesScreen } from './screens/profiles';
import { settingsScreen } from './screens/settings';

export type Screen = (root: HTMLElement, args: string[]) => void | (() => void);

const routes: Record<string, Screen> = {
  '': homeScreen,
  cat: levelsScreen,
  play: playScreen,
  calibrate: calibrateScreen,
  board: boardScreen,
  profiles: profilesScreen,
  settings: settingsScreen,
};

const app = document.getElementById('app')!;
let cleanup: void | (() => void);

function route() {
  const [name = '', ...args] = location.hash.replace(/^#\/?/, '').split('/');
  if (!profile() && name !== 'profiles') return nav('#/profiles');
  cleanup?.();
  const screen = routes[name] ?? homeScreen;
  const root = document.createElement('section');
  root.className = `screen screen-${name || 'home'}`;
  app.replaceChildren(root);
  cleanup = screen(root, args.map(decodeURIComponent));
  window.scrollTo(0, 0);
}

boot().then(() => {
  window.addEventListener('hashchange', route);
  window.addEventListener('online', flushQueue);
  route();
  flushQueue();
});

registerSW({ immediate: true });
