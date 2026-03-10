import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  /** Extra classes applied to the trigger button (e.g. to match the calling component's sizing). */
  triggerClassName?: string;
}

export function CameraCapture({ onCapture, triggerClassName }: CameraCaptureProps) {
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
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          closeCamera();
          onCapture(blob);
        }
      },
      "image/jpeg",
      0.85,
    );
  };

  return (
    <>
      {/* Trigger button — this is where the user gesture originates */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={triggerClassName}
        onClick={openCamera}
      >
        <Camera className="h-4 w-4 mr-1" /> Take Photo
      </Button>

      {/*
       * The overlay div (and the <video> inside it) is ALWAYS in the DOM.
       * When the camera is not active it sits off-screen so the videoRef is
       * never null when we need to assign srcObject.
       * iOS Safari requires playsinline on any video that plays inline.
       */}
      <div
        className={
          isOpen
            ? "fixed inset-0 z-50 bg-black flex flex-col"
            : "fixed -left-[200vw] -top-[200vh] w-px h-px overflow-hidden"
        }
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
            <div className="p-4 flex justify-center bg-black">
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
      </div>
    </>
  );
}
