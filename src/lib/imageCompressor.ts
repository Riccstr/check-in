
/**
 * Burn a timestamp label into the bottom-right corner of an image blob.
 * The text is rendered directly onto the pixels so it cannot be stripped
 * without re-editing the image itself.
 */
export function stampImage(blob: Blob, label: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0);

      const fontSize = Math.max(14, Math.round(img.width * 0.028));
      ctx.font = `bold ${fontSize}px monospace`;

      const padding = Math.round(fontSize * 0.5);
      const metrics = ctx.measureText(label);
      const textW = metrics.width;
      const textH = fontSize;

      const boxX = img.width - textW - padding * 2 - padding;
      const boxY = img.height - textH - padding * 2 - padding;
      const boxW = textW + padding * 2;
      const boxH = textH + padding * 2;

      // Semi-transparent dark background
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(boxX, boxY, boxW, boxH);

      // White text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, boxX + padding, boxY + padding + textH - Math.round(fontSize * 0.15));

      canvas.toBlob(
        (b) => { if (b) resolve(b); else reject(new Error("Stamp failed")); },
        "image/jpeg",
        0.72
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

/**
 * Compress an image file/blob to a target max dimension and quality.
 * Returns a Blob (JPEG).
 */
export function compressImage(
  file: Blob,
  maxDimension = 1000,
  quality = 0.65
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Compression failed"));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

/**
 * Convert a Blob to a base64 data URL for IndexedDB storage.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a base64 data URL back to a Blob.
 */
export function base64ToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
