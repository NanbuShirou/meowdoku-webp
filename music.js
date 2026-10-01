(() => {
  "use strict";

  const FADE_IN_MS = 800;
  const FADE_OUT_MS = 800;

  function clampVolume(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  class MusicManager {
    constructor() {
      this.enabled = true;
      this.volume = 50;
      this.track = null;
      this.trackChangePending = false;
      this.tracks = [];
      this.loopAll = false;
      this.mode = "none";
      this.currentTrack = null;
      this.previewTrack = null;
      this.previewStateListener = null;
      this.resumeGameAfterPreview = false;
      this.resumePreviewAfterVisibility = false;
      this.resumeAfterVisibility = false;
      this.fadeGain = 1;
      this.fadeFrame = 0;
      this.transitionToken = 0;

      this.audio = new Audio();
      this.audio.preload = "auto";
      this.audio.addEventListener("ended", () => this._handleEnded());
      this.previewAudio = new Audio();
      this.previewAudio.preload = "auto";
      this.previewAudio.addEventListener("ended", () => this._stopPreview(true));
    }

    configure({ enabled = true, volume = 50, loopAll = false } = {}) {
      this.enabled = enabled !== false;
      this.volume = clampVolume(volume);
      this.loopAll = !!loopAll;
      this._applyVolume();
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;

      if (!this.enabled) {
        this._stopPreview(false);
        this.resumeAfterVisibility = false;
        this._fadeOutAndPause();
        return;
      }

      this.retryPlayback();
    }

    setVolume(volume) {
      this.volume = clampVolume(volume);
      this._applyVolume();
    }

    setPlaylist(tracks) {
      this.tracks = Array.isArray(tracks) ? tracks.filter((track) => typeof track === "string" && track) : [];
    }

    setLoopAll(loopAll) {
      const changed = this.loopAll !== !!loopAll;
      this.loopAll = !!loopAll;
      if (changed && !this.previewTrack && this.mode === "game" && this.track && this.currentTrack !== this.track) {
        this._transitionToTrack(this.track, !this.loopAll);
        return;
      }
      this.audio.loop = !this.loopAll;
    }

    setTrack(track, deferPlayback = false) {
      const nextTrack = typeof track === "string" && track ? track : null;
      if (nextTrack !== this.track) this.trackChangePending = true;
      this.track = nextTrack;
      if (!deferPlayback && !this.previewTrack && this.mode === "game" && this.trackChangePending) {
        if (this.track) this._transitionToTrack(this.track, !this.loopAll);
        else this.stop();
      }
    }

    playGame() {
      if (!this.track) return;
      this._stopPreview(false);
      if (this.trackChangePending) {
        this.mode = "game";
        this._transitionToTrack(this.track, !this.loopAll);
        return;
      }
      const currentIsValid = this.loopAll
        ? this.tracks.includes(this.currentTrack)
        : this.currentTrack === this.track;
      if (this.mode === "game" && currentIsValid) {
        if (this.audio.paused) this.retryPlayback();
        return;
      }

      this.mode = "game";
      this._transitionToTrack(this.track, !this.loopAll);
    }

    setPreviewStateListener(listener) {
      this.previewStateListener = typeof listener === "function" ? listener : null;
    }

    togglePreview(track) {
      if (this.previewTrack === track) {
        this._stopPreview(true);
        return true;
      }
      if (!this.enabled || typeof track !== "string" || !track) return false;

      if (!this.previewTrack) {
        this.resumeGameAfterPreview = this.mode === "game" && !!this.currentTrack && !this.audio.paused;
        this.transitionToken += 1;
        this._cancelFade();
        this.audio.pause();
      } else {
        this.previewAudio.pause();
        try { this.previewAudio.currentTime = 0; } catch { }
      }

      this._setPreviewTrack(track);
      this.previewAudio.loop = false;
      this.previewAudio.src = track;
      this.previewAudio.volume = this.volume / 100;
      try { this.previewAudio.currentTime = 0; } catch { }
      this.previewAudio.load();
      if (!document.hidden) {
        this._tryPlay(this.previewAudio).then((started) => {
          if (!started && this.previewTrack === track) this._stopPreview(true);
        });
      }
      return true;
    }

    retryPlayback() {
      if (!this.enabled || this.previewTrack || !this.currentTrack || document.hidden) return;
      if (!this.audio.paused) return;

      this.transitionToken += 1;
      const token = this.transitionToken;
      this._cancelFade();
      this.fadeGain = 0;
      this._applyVolume();
      this._tryPlay().then((started) => {
        if (!started || token !== this.transitionToken) return;
        this._fadeTo(1, FADE_IN_MS, token);
      });
    }

    handleVisibilityChange(hidden) {
      if (hidden) {
        if (this.previewTrack) {
          this.resumePreviewAfterVisibility = this.enabled && !this.previewAudio.paused;
          this.previewAudio.pause();
          return;
        }
        this.resumeAfterVisibility = this.enabled && !this.audio.paused;
        this.transitionToken += 1;
        this._cancelFade();
        this.audio.pause();
        this.fadeGain = 0;
        this._applyVolume();
        return;
      }

      if (this.previewTrack && this.resumePreviewAfterVisibility) {
        this.resumePreviewAfterVisibility = false;
        this._tryPlay(this.previewAudio);
      } else if (this.resumeAfterVisibility) {
        this.resumeAfterVisibility = false;
        this.retryPlayback();
      }
    }

    stop() {
      this._stopPreview(false);
      this.transitionToken += 1;
      this._cancelFade();
      this.audio.pause();
      try { this.audio.currentTime = 0; } catch { }
      this.mode = "none";
      this.currentTrack = null;
      this.resumeAfterVisibility = false;
      this.fadeGain = 1;
      this._applyVolume();
    }

    async stopWithFade() {
      this._stopPreview(false);
      if (this.mode === "none" && !this.currentTrack) return;

      const token = ++this.transitionToken;
      this._cancelFade();
      this.mode = "none";
      this.resumeAfterVisibility = false;

      if (this.currentTrack && !this.audio.paused) {
        const completed = await this._fadeTo(0, FADE_OUT_MS, token);
        if (!completed || token !== this.transitionToken) return;
      }

      this.audio.pause();
      if (token !== this.transitionToken) return;
      try { this.audio.currentTime = 0; } catch { }
      this.currentTrack = null;
      this.fadeGain = 1;
      this._applyVolume();
    }

    async _transitionToTrack(track, loop) {
      const token = ++this.transitionToken;
      this._cancelFade();

      if (this.currentTrack && !this.audio.paused) {
        const completed = await this._fadeTo(0, FADE_OUT_MS, token);
        if (!completed || token !== this.transitionToken) return;
      }

      this.audio.pause();
      if (token !== this.transitionToken) return;

      this.currentTrack = track;
      if (track === this.track) this.trackChangePending = false;
      this.audio.loop = loop;
      this.audio.src = track;
      this.fadeGain = 0;
      this._applyVolume();
      try { this.audio.currentTime = 0; } catch { }
      this.audio.load();

      if (!this.enabled || document.hidden) return;

      const started = await this._tryPlay();
      if (!started || token !== this.transitionToken) return;
      await this._fadeTo(1, FADE_IN_MS, token);
    }

    async _fadeOutAndPause() {
      const token = ++this.transitionToken;
      this._cancelFade();

      if (!this.currentTrack || this.audio.paused) {
        this.audio.pause();
        this.fadeGain = 0;
        this._applyVolume();
        return;
      }

      const completed = await this._fadeTo(0, FADE_OUT_MS, token);
      if (!completed || token !== this.transitionToken) return;
      this.audio.pause();
    }

    _tryPlay(audio = this.audio) {
      try {
        const result = audio.play();
        if (result && typeof result.then === "function") {
          return result.then(() => true).catch(() => false);
        }
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    }

    _applyVolume() {
      const baseVolume = this.volume / 100;
      this.audio.volume = Math.max(0, Math.min(1, baseVolume * this.fadeGain));
      this.previewAudio.volume = baseVolume;
    }

    _cancelFade() {
      if (this.fadeFrame) {
        cancelAnimationFrame(this.fadeFrame);
        this.fadeFrame = 0;
      }
    }

    _setPreviewTrack(track) {
      if (this.previewTrack === track) return;
      this.previewTrack = track;
      this.previewStateListener?.(track);
    }

    _stopPreview(resumeGame) {
      if (!this.previewTrack) return;
      this.previewAudio.pause();
      try { this.previewAudio.currentTime = 0; } catch { }
      this.resumePreviewAfterVisibility = false;
      this._setPreviewTrack(null);

      const shouldResume = resumeGame && this.resumeGameAfterPreview;
      this.resumeGameAfterPreview = false;
      if (!shouldResume || !this.enabled || this.mode !== "game" || !this.track) return;

      this.audio.loop = !this.loopAll;
      this.retryPlayback();
    }

    _fadeTo(targetGain, durationMs, token) {
      this._cancelFade();

      const startGain = this.fadeGain;
      const target = Math.max(0, Math.min(1, targetGain));
      const duration = Math.max(0, Number(durationMs) || 0);

      if (duration === 0 || Math.abs(startGain - target) < 0.001) {
        this.fadeGain = target;
        this._applyVolume();
        return Promise.resolve(token === this.transitionToken);
      }

      return new Promise((resolve) => {
        const startTime = performance.now();

        const step = (now) => {
          if (token !== this.transitionToken) {
            this.fadeFrame = 0;
            resolve(false);
            return;
          }

          const progress = Math.min(1, (now - startTime) / duration);
          const eased = progress * progress * (3 - 2 * progress);
          this.fadeGain = startGain + (target - startGain) * eased;
          this._applyVolume();

          if (progress >= 1) {
            this.fadeGain = target;
            this._applyVolume();
            this.fadeFrame = 0;
            resolve(true);
            return;
          }

          this.fadeFrame = requestAnimationFrame(step);
        };

        this.fadeFrame = requestAnimationFrame(step);
      });
    }

    _handleEnded() {
      if (this.mode !== "game" || !this.loopAll || this.tracks.length === 0) return;
      const index = this.tracks.indexOf(this.currentTrack);
      this._transitionToTrack(this.tracks[(index + 1) % this.tracks.length], false);
    }

  }

  globalThis.MusicManager = MusicManager;
})();
