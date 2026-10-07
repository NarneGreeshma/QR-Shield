/**
 * Live camera QR scanning — reliability hardening (Phase 1).
 *
 * Guarantees (spec §1, §5):
 *  - never stuck on "starting": getUserMedia and first-frame waits time out
 *    with a real error message instead of hanging
 *  - rear/environment camera preferred, permission requested properly
 *  - continuous auto-detection, no per-scan button
 *  - detection pauses AND releases the camera immediately; duplicate
 *    payloads are suppressed inside a cooldown window
 *  - all MediaStream tracks stopped on stop(), unmount, and tab switches
 *  - distinct errors: denied / unavailable / in-use / unsupported / timeout
 *  - stage logging: [CAMERA] … [QR] … (API stage logged in ScanWorkspace)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { shouldSuppressDuplicate, type LastDetection } from "@/lib/detection";

export type CameraStatus =
  | "idle"
  | "starting"
  | "running"
  | "denied"
  | "unavailable"
  | "in_use"
  | "unsupported"
  | "error";

export interface CameraState {
  status: CameraStatus;
  message: string | null;
}

const DECODE_INTERVAL_MS = 200; // ≤5 decodes/second keeps mobile UIs smooth
const MAX_DIMENSION = 640; // downscale large frames before jsQR
const GUM_TIMEOUT_MS = 20_000; // permission prompt must not hang forever
const FIRST_FRAME_TIMEOUT_MS = 8_000; // stream received but no frames → error

export function useQrCamera(onDetect: (text: string) => void) {
  const [state, setState] = useState<CameraState>({ status: "idle", message: null });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null); // first-frame watchdog
  const lastDecodeRef = useRef(0);
  const pausedRef = useRef(false);
  const sessionRef = useRef(0); // invalidates stale async continuations
  const lastDetectionRef = useRef<LastDetection | null>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Cancel loop, release camera hardware, clear watchdogs. */
  const stop = useCallback(() => {
    sessionRef.current++; // any in-flight start() becomes stale
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    clearTimers();
    const tracks = streamRef.current?.getTracks() ?? [];
    streamRef.current = null;
    for (const t of tracks) {
      try {
        t.stop(); // spec: clean up MediaStream tracks
      } catch (err) {
        console.warn("[CAMERA] track.stop() failed:", err);
      }
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    pausedRef.current = false;
  }, [clearTimers]);

  /** Stop camera and return to the idle overlay (used by Stop button / tab switch). */
  const stopToIdle = useCallback(() => {
    stop();
    setState({ status: "idle", message: null });
  }, [stop]);

  const start = useCallback(async () => {
    // --- capability checks (spec §5.1–5.2) ---
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setState({
        status: "unsupported",
        message:
          "Camera requires HTTPS (or localhost). Open this app over HTTPS, or use image upload / manual input.",
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        status: "unsupported",
        message: "Camera API is not available in this browser. Use image upload or manual input instead.",
      });
      return;
    }

    stop(); // tear down any previous session first
    const session = ++sessionRef.current; // fresh id for this attempt
    console.log("[CAMERA] request: rear camera, timeout", GUM_TIMEOUT_MS, "ms");
    setState({ status: "starting", message: "Requesting camera permission…" });

    // --- getUserMedia with timeout so we never hang on "Requesting…" ---
    let stream: MediaStream;
    try {
      const gum = navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
          GUM_TIMEOUT_MS,
        ),
      );
      stream = await Promise.race([gum, timeout]);
    } catch (err) {
      if (session !== sessionRef.current) return; // superseded by a newer start/stop
      const e = err as DOMException;
      console.error("[CAMERA] getUserMedia failed:", e.name, e.message);
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError" || e.name === "SecurityError") {
        setState({
          status: "denied",
          message:
            "Camera permission was denied. Allow camera access in your browser settings, or use image upload / manual input.",
        });
      } else if (e.name === "NotFoundError" || e.name === "OverconstrainedError" || e.name === "DevicesNotFoundError") {
        setState({
          status: "unavailable",
          message: "No camera was found on this device. Use image upload or manual input instead.",
        });
      } else if (e.name === "NotReadableError" || e.name === "TrackStartError" || e.name === "AbortError") {
        setState({
          status: "in_use",
          message:
            "The camera is already in use by another app. Close other camera apps (video calls, barcode scanners) and try again.",
        });
      } else if (e.name === "TimeoutError") {
        setState({
          status: "error",
          message:
            "Camera permission request timed out. If a permission prompt is open, answer it; otherwise check browser site settings and retry.",
        });
      } else {
        setState({ status: "error", message: `Could not start the camera: ${e.message || e.name || "unknown error"}` });
      }
      stop();
      return;
    }

    if (session !== sessionRef.current) {
      stream.getTracks().forEach((t) => t.stop()); // stale session — release immediately
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      console.error("[CAMERA] video element not mounted at start()");
      setState({ status: "error", message: "Video element is not ready. Try again." });
      stop();
      return;
    }

    // --- attach stream (spec §5.5–5.8) ---
    video.srcObject = stream;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    try {
      await video.play();
    } catch (err) {
      if (session !== sessionRef.current) return;
      console.error("[CAMERA] video.play() failed:", err);
      setState({
        status: "error",
        message: "Video playback was blocked by the browser. Tap the screen or allow autoplay, then retry.",
      });
      stop();
      return;
    }
    if (session !== sessionRef.current) return;

    console.log("[CAMERA] stream attached, waiting for metadata…");
    setState({ status: "running", message: null });
    pausedRef.current = false;

    // --- first-frame watchdog (spec: never stuck on "Scanning…" silently) ---
    clearTimers();
    timerRef.current = window.setTimeout(() => {
      if (session !== sessionRef.current) return;
      const v = videoRef.current;
      if (v && v.videoWidth === 0) {
        console.error("[CAMERA] no frames after", FIRST_FRAME_TIMEOUT_MS, "ms; readyState =", v.readyState);
        setState({
          status: "error",
          message: "The camera produced no video frames. Another app may be using it — close it and retry.",
        });
        stop();
      }
    }, FIRST_FRAME_TIMEOUT_MS);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let loggedDims = false;
    let probeCount = 0;
    if (ctx) {
      // Nearest-neighbour keeps QR module edges crisp when downscaling;
      // bilinear smoothing blurs modules and makes jsQR miss real codes.
      ctx.imageSmoothingEnabled = false;
    }
    console.log("[CAMERA] loop created, ctx:", ctx ? "ok" : "NULL");

    const loop = (ts: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (session !== sessionRef.current) return; // session superseded
      if (pausedRef.current) return;
      if (!ctx) {
        console.warn("[CAMERA] 2d context unavailable — detection disabled");
        return;
      }
      if (ts - lastDecodeRef.current < DECODE_INTERVAL_MS) return;
      lastDecodeRef.current = ts;
      if (video.readyState < 2 || video.videoWidth === 0) {
        if (!loggedDims) console.log("[CAMERA] waiting for frames, readyState:", video.readyState, "videoWidth:", video.videoWidth);
        return;
      }
      if (timerRef.current !== null) {
        // first real frame arrived — watchdog has done its job
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
      const cw = Math.round(video.videoWidth * scale);
      const ch = Math.round(video.videoHeight * scale);
      if (!loggedDims) {
        console.log(`[CAMERA] video dimensions: ${video.videoWidth}x${video.videoHeight} (readyState ${video.readyState})`);
        console.log(`[CAMERA] canvas dimensions: ${cw}x${ch}`);
        loggedDims = true;
      }
      if (canvas.width !== cw) canvas.width = cw; // resize only when changed
      if (canvas.height !== ch) canvas.height = ch;
      ctx.drawImage(video, 0, 0, cw, ch);
      console.log("[QR] frame captured");
      const frame = ctx.getImageData(0, 0, cw, ch);
      console.log(`[QR] imageData generated ${frame.width}x${frame.height}`);
      // Content probe: variance ≈ 0 means nothing was drawn (blank frame).
      if (probeCount < 5 || probeCount % 25 === 0) {
        let sum = 0;
        let sumSq = 0;
        const px = frame.data;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) {
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          sum += lum;
          sumSq += lum * lum;
        }
        const mean = sum / n;
        const variance = sumSq / n - mean * mean;
        console.log(`[QR] frame stats #${probeCount}: mean=${mean.toFixed(1)} variance=${variance.toFixed(1)} alpha=${px[3]}`);
      }
      probeCount++;
      console.log("[QR] jsQR called");
      const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
      console.log("[QR] detection result:", result ? "FOUND" : "null");
      if (result?.data) {
        const now = Date.now();
        if (shouldSuppressDuplicate(result.data, lastDetectionRef.current, now)) {
          // Refresh the sighting: a QR that never leaves the view stays
          // suppressed; only ~8s of absence re-arms it for a deliberate re-scan.
          lastDetectionRef.current = { payload: result.data, at: now };
          console.log("[QR] duplicate suppressed:", result.data);
          return; // keep scanning
        }
        lastDetectionRef.current = { payload: result.data, at: now };
        console.log("[QR] decoded payload:", result.data);
        pausedRef.current = true; // pause scanning immediately
        // Release the camera so the preview unmount can't leak the stream;
        // "Scan another" calls start() again for a fresh session.
        stop();
        setState({ status: "idle", message: null });
        onDetectRef.current(result.data);
        return;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    console.log("[CAMERA] detection loop started");
  }, [stop, clearTimers]);

  /** Resume is only used when the same session is still alive (kept for API compat). */
  const resume = useCallback(() => {
    pausedRef.current = false;
  }, []);

  // Unmount cleanup: cancel loop + release camera (spec §1).
  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  return { ...state, videoRef, start, stop: stopToIdle, resume };
}
