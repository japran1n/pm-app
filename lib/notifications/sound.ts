"use client";

// Faza D (docs/chat-slack-parity-plan.md, D5): the notification bell's
// in-app sound. Deliberately synthesized via the Web Audio API rather than
// a static .mp3/.wav asset -- no file to source, license, host, or keep in
// sync with a "sound pack" choice; a two-tone chime is ~15 lines of
// oscillator/gain code and ships as part of this module instead of a
// public/ asset this repo would otherwise need to add and maintain.
//
// Autoplay: browsers start every AudioContext "suspended" until a user
// gesture happens somewhere on the page. By the time an in-app
// notification can even fire, the signed-in user has certainly clicked
// something (there is no notification before there is a session), so
// `resume()` below reliably succeeds -- but it's still wrapped so a
// browser that disagrees just silently skips the sound instead of
// throwing into the caller (NotificationBell's realtime handler must
// never break because audio couldn't play).

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) {
    sharedContext = new Ctor();
  }
  return sharedContext;
}

/**
 * Plays a short, two-tone chime. `volume` is 0-100 (notification_preferences.
 * sound_volume) -- clamped and mapped to a gain envelope so 0 is silent and
 * 100 is a comfortable, non-startling notification level (never full-scale
 * gain). Never throws: any failure (no AudioContext, resume() rejected,
 * autoplay blocked) is swallowed so a sound failure can never surface as an
 * app error.
 */
export function playNotificationSound(volume: number): void {
  try {
    const ctx = getContext();
    if (!ctx) return;

    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
    if (normalizedVolume <= 0) return;

    const start = () => {
      const now = ctx.currentTime;
      // Two short tones (a rising "ping-pong"), each with its own quick
      // attack/decay envelope so neither clicks at the start/end.
      const tones: { freq: number; offset: number }[] = [
        { freq: 740, offset: 0 },
        { freq: 988, offset: 0.09 },
      ];

      for (const tone of tones) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = tone.freq;

        const toneStart = now + tone.offset;
        const peakGain = normalizedVolume * 0.22;
        gain.gain.setValueAtTime(0, toneStart);
        gain.gain.linearRampToValueAtTime(peakGain, toneStart + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.22);

        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + 0.24);
      }
    };

    if (ctx.state === "suspended") {
      void ctx.resume().then(start).catch(() => {});
    } else {
      start();
    }
  } catch {
    // Never let a sound failure surface as an app error.
  }
}
