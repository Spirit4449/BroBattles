import { getNavigation, getPageScope } from "../../lib/globals.cjs";
import { setBattleLoading } from "./battleLoading.js";

const bootScript = document.currentScript;
const scope = getPageScope();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.body.append(script);
  });
}

async function loadBattle() {
  let progress = 0;
  setBattleLoading(progress, "Initializing world...");
  const creepTimer = setInterval(() => {
    if (progress >= 48) return;
    progress = Math.min(48, progress + 0.6);
    setBattleLoading(progress);
  }, 100);

  try {
    if (!window.Phaser) await loadScript(bootScript.dataset.engineSrc);
    if (scope && !scope.active) return;
    progress = Math.max(progress, 22);
    setBattleLoading(progress, "Gathering the squad...");
    await loadScript(bootScript.dataset.gameSrc);
  } catch (error) {
    if (!scope || scope.active) {
      console.error(error);
      getNavigation()?.fail(error);
      setBattleLoading(50, "Couldn't start game");
    }
  } finally {
    clearInterval(creepTimer);
  }
}

void loadBattle();
