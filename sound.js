(() => {
  "use strict";

  class SoundManager {
    constructor() {
      this.enabled = true;
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
      try {
        globalThis.MeowdokuAndroid?.playSoundEffect(name);
      } catch { }
    }
  }

  globalThis.SoundManager = SoundManager;
})();
