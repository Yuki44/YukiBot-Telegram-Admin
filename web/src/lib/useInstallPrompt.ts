import { useEffect, useState } from "react";

/**
 * The dashboard is a "lightweight" PWA — no service worker, just a manifest and an icon.
 * That's enough for Chrome / Edge / Samsung Internet to fire `beforeinstallprompt`, but
 * iOS Safari (no support at all), iOS Chrome (mirrors Safari), and in-app browsers like
 * Telegram never auto-prompt. So we always render the install row on mobile and route
 * the click to whatever path actually works for the detected environment.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface StandaloneNavigator {
  standalone?: boolean;
}

interface TelegramWebviewWindow {
  TelegramWebviewProxy?: unknown;
}

export type InstallPlatform =
  /** Android Chrome (or other browser) where we expect `beforeinstallprompt` eventually. */
  | "android-chrome"
  /** Android in-app webview (Telegram, Instagram, FB…) — must open in real browser first. */
  | "android-webview"
  /** Other Android browser without BIP support — show menu instructions. */
  | "android-other"
  /** iOS Safari — supports the Compartir → "Añadir a pantalla de inicio" flow. */
  | "ios-safari"
  /** iOS Chrome, Telegram, etc. — they can't install; tell the user to open in Safari. */
  | "ios-other"
  /** Desktop browsers — banner hidden. */
  | "desktop"
  | "unknown";

export interface InstallPromptState {
  /** A native install prompt is queued (Chrome/Edge fired `beforeinstallprompt`). */
  canInstall: boolean;
  /** Trigger the queued native prompt. Resolves to "no-prompt" when one isn't available. */
  install: () => Promise<"accepted" | "dismissed" | "no-prompt">;
  /** The page is already running standalone (already installed). */
  isStandalone: boolean;
  /** Coarse platform classification used to pick the right instruction copy. */
  platform: InstallPlatform;
  /** True for any iOS/Android UA — banner should not appear on desktop. */
  isMobile: boolean;
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (window.navigator as Navigator & StandaloneNavigator).standalone === true;
}

function detectPlatform(): { platform: InstallPlatform; isMobile: boolean } {
  if (typeof navigator === "undefined") return { platform: "unknown", isMobile: false };
  const ua = navigator.userAgent;

  // iPadOS 13+ reports as MacIntel; the touch-point check rescues real iPads.
  const isIOSDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  if (isIOSDevice) {
    // Safari has "Safari" but not CriOS/FxiOS/EdgiOS and isn't an in-app webview.
    const isCriOS = /CriOS/.test(ua);
    const isFxOS = /FxiOS/.test(ua);
    const isEdge = /EdgiOS/.test(ua);
    const isInApp = !!(window as Window & TelegramWebviewWindow).TelegramWebviewProxy;
    const isSafari = /Safari/.test(ua) && !isCriOS && !isFxOS && !isEdge && !isInApp;
    return { platform: isSafari ? "ios-safari" : "ios-other", isMobile: true };
  }

  if (isAndroid) {
    const isWebView =
      / wv\)/.test(ua) || !!(window as Window & TelegramWebviewWindow).TelegramWebviewProxy;
    if (isWebView) return { platform: "android-webview", isMobile: true };
    // Treat anything Chromium-based (Chrome, Edge, Samsung, Opera) as "chrome" — BIP works in all of them.
    const isChromium = /Chrome|EdgA|SamsungBrowser|OPR\//.test(ua);
    return { platform: isChromium ? "android-chrome" : "android-other", isMobile: true };
  }

  return { platform: "desktop", isMobile: false };
}

export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(detectStandalone);
  const [{ platform, isMobile }] = useState(detectPlatform);

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferred(null);
      setIsStandalone(true);
    }
    function onDisplayChange(ev: MediaQueryListEvent) {
      if (ev.matches) setIsStandalone(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const mq = window.matchMedia?.("(display-mode: standalone)");
    mq?.addEventListener?.("change", onDisplayChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      mq?.removeEventListener?.("change", onDisplayChange);
    };
  }, []);

  async function install(): Promise<"accepted" | "dismissed" | "no-prompt"> {
    if (!deferred) return "no-prompt";
    try {
      await deferred.prompt();
      const result = await deferred.userChoice;
      setDeferred(null);
      return result.outcome;
    } catch {
      return "dismissed";
    }
  }

  return {
    canInstall: !!deferred,
    install,
    isStandalone,
    platform,
    isMobile,
  };
}
