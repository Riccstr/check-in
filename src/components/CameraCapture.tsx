import { useRef, useEffect, useState, forwardRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  /** Extra classes applied to the trigger button (e.g. to match the calling component's sizing). */
  triggerClassName?: string;
  buttonLabel?: React.ReactNode;
  buttonStyle?: React.CSSProperties;
  buttonClassName?: string;
}

export const CameraCapture = forwardRef<HTMLButtonElement, CameraCaptureProps>(
  function CameraCapture({ onCapture, triggerClassName, buttonLabel, buttonStyle, buttonClassName }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Assign the stream to the video element and start playback once both
  // the overlay is visible AND the stream has been obtained.
  useEffect(() => {
    if (!isOpen || !streamReady) return;
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    video.srcObject = streamRef.current;
    video
      .play()
      .then(() => setReady(true))
      .catch((err) => console.error("[Camera] play() failed:", err));
  }, [isOpen, streamReady]);

  // Stop all tracks when the component unmounts.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /**
   * Called directly from the trigger button's onClick.
   * getUserMedia MUST be the very first expression evaluated here —
   * iOS Safari requires the call to originate synchronously from a user
   * gesture with no async gap before it.
   */
  const openCamera = () => {
    console.log("[Camera] getUserMedia called — direct user gesture...");

    // ← First operation, no state updates before this line.
    const promise = navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });

    // State updates happen AFTER getUserMedia is already in flight.
    setIsOpen(true);
    setStreamReady(false);
    setReady(false);
    setError(null);

    promise
      .then((stream) => {
        console.log("[Camera] getUserMedia succeeded:", stream);
        streamRef.current = stream;
        setStreamReady(true); // triggers the useEffect above
      })
      .catch((err) => {
        console.error("[Camera] getUserMedia failed:", err);
        setError(
          "Camera access denied or unavailable. Please allow camera permissions and try again.",
        );
      });
  };

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsOpen(false);
    setStreamReady(false);
    setReady(false);
    setError(null);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 1. Draw the raw video frame.
    ctx.drawImage(video, 0, 0);

    // 2. Burn the timestamp onto the canvas so it is part of the image data.
    //    Use local time at the exact moment of capture.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp =
      `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Scale font size relative to image width so it stays legible on any
    // resolution — minimum 18 px, roughly 2.5 % of width on a typical photo.
    const fontSize = Math.max(18, Math.round(canvas.width * 0.025));
    ctx.font = `bold ${fontSize}px sans-serif`;

    const padding = Math.round(fontSize * 0.5);
    const textMetrics = ctx.measureText(stamp);
    const textW = textMetrics.width;
    const textH = fontSize; // ascent height approximation

    const rectX = padding;
    const rectY = canvas.height - textH - padding * 2.5;
    const rectW = textW + padding * 2;
    const rectH = textH + padding;

    // Semi-transparent black background so the text is readable on any photo.
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(rectX, rectY, rectW, rectH);

    // White bold text on top of the background rectangle.
    ctx.fillStyle = "#ffffff";
    ctx.fillText(stamp, rectX + padding, rectY + textH);

    // 3. Convert the stamped canvas to a JPEG blob — this is what gets uploaded.
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(blob);
          setTimeout(closeCamera, 0);
        }
      },
      "image/jpeg",
      0.85,
    );
  };

  return (
    <>
      {/* Trigger button — this is where the user gesture originates */}
      <button
        ref={ref}
        type="button"
        style={buttonStyle}
        className={buttonClassName}
        onClick={openCamera}
      >
        {buttonLabel ?? <><Camera className="h-4 w-4 mr-1" /> Take Photo</>}
      </button>

      {/*
       * The overlay div (and the <video> inside it) is ALWAYS in the DOM.
       * When the camera is not active it sits off-screen so the videoRef is
       * never null when we need to assign srcObject.
       * iOS Safari requires playsinline on any video that plays inline.
       */}
      {createPortal(
        <div
          className={
            isOpen
              ? "fixed inset-0 z-50 bg-black flex flex-col pointer-events-auto"
              : "fixed -left-[200vw] -top-[200vh] w-px h-px overflow-hidden pointer-events-none"
          }
          style={isOpen ? {
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
          } : undefined}
        >
          <div className="flex justify-end p-3">
            <button
              type="button"
              onClick={closeCamera}
              className="text-white bg-black/40 rounded-full p-1"
              aria-label="Close camera"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-white text-center px-6 gap-4">
              <p>{error}</p>
              <Button variant="secondary" onClick={closeCamera}>
                Close
              </Button>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                className="flex-1 w-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <div className="p-4 flex justify-center bg-black" style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                <Button
                  type="button"
                  size="lg"
                  disabled={!ready}
                  onClick={capture}
                  className="px-8"
                >
                  <Camera className="h-5 w-5 mr-2" />
                  {ready ? "Capture Photo" : "Starting camera…"}
                </Button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
  }
);
