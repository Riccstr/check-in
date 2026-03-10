import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      if (!videoRef.current) {
        console.log("[Camera] Video ref is null — skipping getUserMedia");
        return;
      }

      console.log("[Camera] Calling getUserMedia...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        console.log("[Camera] getUserMedia succeeded:", stream);

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      } catch (err) {
        console.error("[Camera] getUserMedia failed:", err);
        if (!cancelled) {
          setError("Camera access denied or unavailable. Please allow camera permissions and try again.");
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

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
          // Stop stream before handing off
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
          onCapture(blob);
        }
      },
      "image/jpeg",
      0.85,
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex justify-end p-3">
        <button
          type="button"
          onClick={onClose}
          className="text-white bg-black/40 rounded-full p-1"
          aria-label="Close camera"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white text-center px-6 gap-4">
          <p>{error}</p>
          <Button variant="secondary" onClick={onClose}>Close</Button>
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
  );
}
