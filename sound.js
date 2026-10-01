(() => {
  "use strict";

  class SoundManager {
    constructor() {
      this.enabled = true;
      this.sounds = typeof Audio === "function" ? {
        button: new Audio("raw/button.wav"),
        meow: new Audio("raw/meow.wav"),
      } : {};
    }

    configure({ enabled = true } = {}) {
      this.enabled = enabled !== false;
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
    }

    playButton() {
      this.play("button");
    }

    playMeow() {
      this.play("meow");
    }

    play(name) {
      if (!this.enabled) return;
      const sound = this.sounds[name];
      if (!sound) return;
      try { sound.currentTime = 0; } catch { }
      try { sound.play()?.catch(() => { }); } catch { }
    }
  }

  globalThis.SoundManager = SoundManager;
})();
